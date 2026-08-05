import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Render pings this to decide whether a deploy is live. */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and dependency check' })
  async check() {
    const [database, cache] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`.then(() => 'up' as const)
        .catch(() => 'down' as const),
      this.redis.client
        .ping()
        .then(() => 'up' as const)
        .catch(() => 'down' as const),
    ]);

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      cache,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
