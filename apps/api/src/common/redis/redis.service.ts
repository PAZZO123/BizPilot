import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Thin wrapper over ioredis. Used for response caching, rate-limit counters
 * and short-lived locks. BullMQ owns its own connections — see QueueModule.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`Discarding unparseable cache entry at ${key}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, raw, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, raw);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  /** Delete every key matching a glob, using SCAN so we never block Redis. */
  async delByPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  /**
   * Best-effort mutex. Returns a release function, or null if the lock is held.
   * Callers must tolerate not getting the lock.
   */
  async acquireLock(key: string, ttlSeconds = 30): Promise<(() => Promise<void>) | null> {
    const token = Math.random().toString(36).slice(2);
    const ok = await this.client.set(`lock:${key}`, token, 'EX', ttlSeconds, 'NX');
    if (!ok) return null;
    return async () => {
      // Only release if we still own it, so a lock that expired and was taken
      // by someone else is not deleted out from under them.
      const current = await this.client.get(`lock:${key}`);
      if (current === token) await this.client.del(`lock:${key}`);
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

export const redisClientProvider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.getOrThrow<string>('REDIS_URL');
    const client = new Redis(url, {
      maxRetriesPerRequest: null,
      // Render's managed Redis terminates TLS; the rediss:// scheme turns it on.
      lazyConnect: false,
    });
    client.on('error', (err) => new Logger('Redis').error(err.message));
    return client;
  },
};
