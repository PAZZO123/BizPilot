import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * BizPilot's own dashboard, not a shop's.
 *
 * `PlatformAdminGuard` is applied at the controller level rather than per route
 * so a future endpoint added here cannot accidentally ship unguarded.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'MRR, trials, churn and cost to serve' })
  overview() {
    return this.admin.overview();
  }

  @Get('revenue')
  @ApiQuery({ name: 'months', required: false })
  @ApiOperation({ summary: 'Cash collected by month' })
  revenue(@Query('months') months?: string) {
    return this.admin.revenueByMonth(clamp(months, 12, 1, 36));
  }

  @Get('signups')
  @ApiQuery({ name: 'weeks', required: false })
  @ApiOperation({ summary: 'New shops by week' })
  signups(@Query('weeks') weeks?: string) {
    return this.admin.signupsByWeek(clamp(weeks, 12, 4, 52));
  }

  @Get('shops')
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'Every account, with usage and what it is worth' })
  shops(@Query('limit') limit?: string) {
    return this.admin.shops(clamp(limit, 100, 1, 500));
  }
}

function clamp(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
