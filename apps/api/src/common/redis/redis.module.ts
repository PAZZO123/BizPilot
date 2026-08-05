import { Global, Module } from '@nestjs/common';
import { RedisService, redisClientProvider } from './redis.service';

@Global()
@Module({
  providers: [redisClientProvider, RedisService],
  exports: [RedisService, redisClientProvider],
})
export class RedisModule {}
