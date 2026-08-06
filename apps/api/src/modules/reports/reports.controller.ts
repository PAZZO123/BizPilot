import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { BusinessId, CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ReportsService } from './reports.service';
import { ReportPdfService } from './report-pdf.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly pdf: ReportPdfService,
  ) {}

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

  // --- Printable, signable reports -----------------------------------------
  //
  // `attachment` rather than `inline`: these are meant to be saved and printed,
  // and a browser tab is not a filing cabinet. The filename carries the period
  // so a folder of them sorts correctly.

  @Get('profit-loss.pdf')
  @Roles(UserRole.MANAGER)
  @ApiProduces('application/pdf')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiOperation({ summary: 'Profit & loss as a signable PDF' })
  async profitAndLossPdf(
    @BusinessId() businessId: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const { buffer, filename } = await this.pdf.profitAndLoss(businessId, user, from, to);
    sendPdf(res, buffer, filename);
  }

  @Get('cash-up.pdf')
  @ApiProduces('application/pdf')
  @ApiQuery({ name: 'date', required: false })
  @ApiOperation({ summary: 'Daily cash-up sheet as a PDF, with room to write the counted total' })
  async cashUpPdf(
    @BusinessId() businessId: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
    @Query('date') date?: string,
  ): Promise<void> {
    const { buffer, filename } = await this.pdf.cashUp(businessId, user, date);
    sendPdf(res, buffer, filename);
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

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length.toString(),
  });
  res.end(buffer);
}

/** Defaults to the last 30 days when the caller gives no range. */
function resolveRange(from?: string, to?: string): { start: Date; end: Date } {
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
