import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BusinessId, Roles } from '../../common/decorators';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Headline numbers for the home screen' })
  dashboard(@BusinessId() businessId: string) {
    return this.reports.dashboard(businessId);
  }

  @Get('profit-loss')
  @Roles(UserRole.MANAGER)
  @ApiQuery({ name: 'from', required: false, description: 'ISO date, defaults to start of month' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date, defaults to today' })
  @ApiOperation({ summary: 'Profit and loss for a period' })
  profitAndLoss(
    @BusinessId() businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.profitAndLoss(businessId, from, to);
  }

  @Get('revenue-trend')
  @ApiQuery({ name: 'days', required: false })
  @ApiOperation({ summary: 'Daily revenue and profit' })
  revenueTrend(@BusinessId() businessId: string, @Query('days') days?: string) {
    const parsed = Number(days);
    const window = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 7), 365) : 30;
    return this.reports.revenueTrend(businessId, window);
  }

  @Get('top-products')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiOperation({ summary: 'Best sellers by revenue' })
  topProducts(
    @BusinessId() businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { start, end } = resolveRange(from, to);
    return this.reports.topProducts(businessId, start, end, 20);
  }

  @Get('dead-stock')
  @Roles(UserRole.MANAGER)
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiOperation({ summary: 'Stock that did not sell in the period' })
  deadStock(
    @BusinessId() businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { start, end } = resolveRange(from, to);
    return this.reports.deadStock(businessId, start, end, 20);
  }

  @Get('cash-up')
  @ApiQuery({ name: 'date', required: false, description: 'ISO date, defaults to today' })
  @ApiOperation({ summary: "End-of-day cash-up — what should be in the drawer" })
  cashUp(@BusinessId() businessId: string, @Query('date') date?: string) {
    return this.reports.cashUp(businessId, date);
  }

  @Get('staff')
  @Roles(UserRole.MANAGER)
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiOperation({ summary: 'Sales, profit and average basket per staff member' })
  staff(@BusinessId() businessId: string, @Query('from') from?: string, @Query('to') to?: string) {
    const { start, end } = resolveRange(from, to);
    return this.reports.salesByUser(businessId, start, end);
  }

  @Get('sales-by-hour')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiOperation({ summary: 'Busiest hours of the day' })
  salesByHour(
    @BusinessId() businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { start, end } = resolveRange(from, to);
    return this.reports.salesByHour(businessId, start, end);
  }
}

/** Defaults to the last 30 days when the caller gives no range. */
function resolveRange(from?: string, to?: string): { start: Date; end: Date } {
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
