import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type DocumentKind = 'sale' | 'invoice';

/**
 * Issues human-readable, per-business sequential document numbers
 * (RCP-2026-0001, INV-2026-0042).
 *
 * Counters live in Redis so two concurrent sales can never be handed the same
 * number — INCR is atomic, unlike "SELECT max() + 1". The counter is seeded
 * from the database the first time it is touched, which also means a flushed
 * Redis recovers by itself rather than restarting numbering at 1.
 */
@Injectable()
export class NumberingService {
  private readonly logger = new Logger(NumberingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async next(businessId: string, kind: DocumentKind, prefix: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const counterKey = `seq:${businessId}:${kind}:${year}`;

    let sequence: number;
    try {
      // SET NX only writes if the key is absent, so exactly one caller seeds it.
      const exists = await this.redis.client.exists(counterKey);
      if (!exists) {
        const seed = await this.highestExisting(businessId, kind, prefix, year);
        await this.redis.client.set(counterKey, String(seed), 'NX');
      }
      sequence = await this.redis.client.incr(counterKey);
      // Counters are per-year; expiring after 400 days keeps Redis tidy without
      // risking an expiry mid-year.
      await this.redis.client.expire(counterKey, 400 * 24 * 60 * 60);
    } catch (error) {
      // Redis being unavailable must not stop a shopkeeper from ringing up a
      // sale. Fall back to the database, accepting the small collision risk —
      // the unique constraint plus caller retry covers it.
      this.logger.warn(
        `Redis counter unavailable, falling back to database numbering: ${(error as Error).message}`,
      );
      sequence = (await this.highestExisting(businessId, kind, prefix, year)) + 1;
    }

    return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
  }

  /** Highest sequence already used this year, or 0 if there is none. */
  private async highestExisting(
    businessId: string,
    kind: DocumentKind,
    prefix: string,
    year: number,
  ): Promise<number> {
    const like = `${prefix}-${year}-%`;
    const row =
      kind === 'sale'
        ? await this.prisma.sale.findFirst({
            where: { businessId, number: { startsWith: `${prefix}-${year}-` } },
            orderBy: { number: 'desc' },
            select: { number: true },
          })
        : await this.prisma.invoice.findFirst({
            where: { businessId, number: { startsWith: `${prefix}-${year}-` } },
            orderBy: { number: 'desc' },
            select: { number: true },
          });

    if (!row) return 0;
    const tail = row.number.slice(like.length - 1);
    const parsed = Number.parseInt(tail, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
