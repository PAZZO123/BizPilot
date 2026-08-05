import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { SmsStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { paginated, type PaginationDto } from '../../common/dto/pagination.dto';

export const SMS_QUEUE = 'sms';

export interface SmsJobData {
  messageId: string;
}

export interface QueueSmsInput {
  businessId: string;
  to: string;
  body: string;
  kind?: string;
  customerId?: string | null;
  invoiceId?: string | null;
  /** Delay before sending, in milliseconds. */
  delayMs?: number;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    @InjectQueue(SMS_QUEUE) private readonly queue: Queue<SmsJobData>,
  ) {}

  /**
   * Persists the message first, then queues a job that only carries its id.
   * If Redis loses the job the record is still there to retry; if the process
   * dies mid-send there is no message that was sent but never recorded.
   */
  async queueMessage(input: QueueSmsInput) {
    const to = normalisePhone(input.to);
    if (!to) {
      throw new BadRequestException('A valid phone number is required to send an SMS.');
    }

    await this.entitlements.assertWithinMonthlyLimit(input.businessId, 'sms');

    const message = await this.prisma.smsMessage.create({
      data: {
        businessId: input.businessId,
        customerId: input.customerId ?? null,
        invoiceId: input.invoiceId ?? null,
        to,
        body: input.body.slice(0, 480),
        kind: input.kind ?? 'manual',
        status: SmsStatus.QUEUED,
      },
    });

    await this.queue.add(
      'send',
      { messageId: message.id },
      {
        delay: input.delayMs,
        attempts: 3,
        // A gateway hiccup should not cost the customer their reminder, but
        // hammering it makes things worse — back off exponentially.
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    // The quota is consumed at queue time, not send time, so a customer cannot
    // queue 10,000 messages against a 100-message allowance and have them all
    // go out before the counter catches up.
    await this.entitlements.consume(input.businessId, 'sms');

    return message;
  }

  async findAll(businessId: string, pagination: PaginationDto) {
    const where = { businessId };
    const [items, total] = await Promise.all([
      this.prisma.smsMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          customer: { select: { id: true, name: true } },
          invoice: { select: { id: true, number: true } },
        },
      }),
      this.prisma.smsMessage.count({ where }),
    ]);
    return paginated(items, total, pagination);
  }
}

/**
 * Rwandan mobile numbers are written locally as 07XXXXXXXX. Gateways need
 * E.164, so normalise before storing — a number stored two ways is a customer
 * who gets two reminders.
 */
export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned) return null;
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  if (/^07\d{8}$/.test(cleaned)) return `+25${cleaned}`;
  if (/^250\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\d{8,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}
