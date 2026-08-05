import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { SmsStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SMS_QUEUE, type SmsJobData } from './sms.service';
import { SMS_PROVIDER, type SmsProvider } from './sms.tokens';

@Processor(SMS_QUEUE)
export class SmsProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
  ) {
    super();
  }

  async process(job: Job<SmsJobData>): Promise<void> {
    const message = await this.prisma.smsMessage.findUnique({
      where: { id: job.data.messageId },
    });

    if (!message) {
      // The business was deleted between queueing and sending. Nothing to do,
      // and throwing would just retry against a row that will never exist.
      this.logger.warn(`SMS ${job.data.messageId} no longer exists; dropping job.`);
      return;
    }
    if (message.status === SmsStatus.SENT || message.status === SmsStatus.DELIVERED) {
      return;
    }

    try {
      const result = await this.provider.send({
        to: message.to,
        body: message.body,
        senderId: this.config.get<string>('SMS_SENDER_ID', 'BizPilot'),
      });

      await this.prisma.smsMessage.update({
        where: { id: message.id },
        data: {
          status: SmsStatus.SENT,
          provider: this.provider.name,
          providerRef: result.providerRef,
          cost: result.cost,
          sentAt: new Date(),
          error: null,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      // Record the failure on every attempt so the owner can see what is going
      // wrong, but only mark it FAILED once BullMQ has given up retrying.
      const exhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.smsMessage.update({
        where: { id: message.id },
        data: {
          status: exhausted ? SmsStatus.FAILED : SmsStatus.QUEUED,
          provider: this.provider.name,
          error: reason.slice(0, 500),
        },
      });

      this.logger.error(`SMS ${message.id} to ${message.to} failed: ${reason}`);
      throw error;
    }
  }
}
