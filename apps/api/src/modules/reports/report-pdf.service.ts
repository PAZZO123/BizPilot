import { Injectable } from '@nestjs/common';
import { formatMoney } from '@bizpilot/shared';
import { PdfBuilder } from '../../common/pdf/pdf-builder';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { ReportsService } from './reports.service';

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MOMO: 'Mobile money',
  CARD: 'Card',
  BANK: 'Bank transfer',
  CREDIT: 'On credit',
};

interface Requester {
  id: string;
  name: string;
  role: string;
}

/**
 * Printable reports.
 *
 * These exist to be printed, filed in a folder, and signed — a shop being asked
 * for figures by a landlord, a co-operative, a microfinance loan officer or the
 * RRA needs paper with a name on it, not a screenshot. So every document here
 * states the period it covers, who produced it, and carries signature blocks.
 *
 * The numbers come from the same `ReportsService` the screens use. There is no
 * second calculation of profit that could disagree with what the owner saw.
 */
@Injectable()
export class ReportPdfService {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Profit and loss for a period, with the supporting breakdowns behind it.
   *
   * Signed by whoever produced it and countersigned by the owner: the point of
   * the second signature is that the owner has seen the figures, which is what
   * a lender or a co-operative is actually asking for.
   */
  async profitAndLoss(
    businessId: string,
    requester: Requester,
    from?: string,
    to?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.entitlements.assertFeature(businessId, 'dataExport');

    const [business, plan, data, staff] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          name: true, address: true, phone: true, email: true, taxId: true, currency: true,
        },
      }),
      this.entitlements.planFor(businessId),
      this.reports.profitAndLoss(businessId, from, to),
      this.reports.salesByUser(
        businessId,
        from ? startOfDay(new Date(from)) : startOfMonth(),
        to ? endOfDay(new Date(to)) : new Date(),
      ),
    ]);

    const owner = await this.prisma.user.findFirst({
      where: { businessId, role: 'OWNER', deletedAt: null },
      select: { name: true },
    });

    const currency = business.currency;
    const money = (value: number | bigint) => formatMoney(Number(value), currency);
    // `data.from` is an ISO string, and slicing it would print the UTC calendar
    // date. In Kigali (UTC+2) local midnight on the 1st is 22:00 on the previous
    // day in UTC, so a report requested for July would be titled — and filed —
    // as starting 30 June.
    const periodFrom = localIsoDate(new Date(data.from));
    const periodTo = localIsoDate(new Date(data.to));
    const generatedAt = new Date();

    const pdf = new PdfBuilder();

    pdf.header({
      businessName: business.name,
      businessLines: [
        business.address,
        business.phone,
        business.email,
        business.taxId ? `TIN: ${business.taxId}` : null,
      ],
      title: 'Profit & loss',
      subtitle: `${periodFrom} to ${periodTo}`,
      meta: [
        ['Prepared by', requester.name],
        ['Sales in period', String(data.salesCount)],
        ['Currency', currency],
      ],
    });

    // --- The statement itself ------------------------------------------------
    pdf.sectionTitle('Statement', 'Revenue is counted when a sale is made, not when the cash arrives.');
    pdf.keyValues([
      ['Sales revenue', money(data.revenue)],
      ['Cost of goods sold', `(${money(data.cost)})`],
      ['Gross profit', money(data.grossProfit), true],
      [`Gross margin`, `${data.grossMarginPct.toFixed(2)}%`],
      ['Running costs', `(${money(data.expenses)})`],
      ['Net profit', money(data.netProfit), true],
    ]);

    pdf.paragraph(
      `Of ${money(data.revenue)} in sales, ${money(data.cashCollected)} has actually been collected. ` +
        `The difference of ${money(Number(data.revenue) - Number(data.cashCollected))} is owed by customers ` +
        `who bought on credit.`,
      { muted: true },
    );

    // --- Expenses ------------------------------------------------------------
    pdf.sectionTitle('Running costs by category');
    const expenseTotal = data.expensesByCategory.reduce(
      (sum, row) => sum + Number(row.total),
      0,
    );
    pdf.table({
      columns: [
        { header: 'Category', width: 0.55 },
        { header: 'Amount', width: 0.25, align: 'right' },
        { header: 'Share', width: 0.2, align: 'right' },
      ],
      rows: data.expensesByCategory.map((row) => [
        row.category,
        money(row.total),
        expenseTotal > 0 ? `${((Number(row.total) / expenseTotal) * 100).toFixed(1)}%` : '—',
      ]),
      totalRow: ['Total', money(data.expenses), '100%'],
      emptyText: 'No expenses were recorded in this period.',
    });

    // --- Products ------------------------------------------------------------
    pdf.sectionTitle('Best sellers by profit');
    pdf.table({
      columns: [
        { header: 'Product', width: 0.44 },
        { header: 'Units', width: 0.14, align: 'right' },
        { header: 'Revenue', width: 0.21, align: 'right' },
        { header: 'Profit', width: 0.21, align: 'right' },
      ],
      rows: data.topProducts.map((row) => [
        row.name,
        String(Number(row.unitsSold)),
        money(row.revenue),
        money(row.profit),
      ]),
      emptyText: 'No sales were recorded in this period.',
    });

    // --- How customers paid --------------------------------------------------
    pdf.sectionTitle('How customers paid');
    pdf.table({
      columns: [
        { header: 'Method', width: 0.46 },
        { header: 'Sales', width: 0.18, align: 'right' },
        { header: 'Value', width: 0.36, align: 'right' },
      ],
      rows: data.paymentMethods.map((row) => [
        METHOD_LABELS[row.method] ?? row.method,
        String(row.count),
        money(row.total),
      ]),
      emptyText: 'No sales were recorded in this period.',
    });

    // Only worth a page of paper once there is more than one person selling.
    if (staff.length > 1) {
      pdf.sectionTitle('Sales by staff member');
      pdf.table({
        columns: [
          { header: 'Name', width: 0.3 },
          { header: 'Role', width: 0.16 },
          { header: 'Sales', width: 0.12, align: 'right' },
          { header: 'Revenue', width: 0.21, align: 'right' },
          { header: 'Average', width: 0.21, align: 'right' },
        ],
        rows: staff.map((row) => [
          row.name,
          (row.role ?? '').toLowerCase(),
          String(row.sales),
          money(row.revenue),
          money(row.averageSale),
        ]),
      });
    }

    const reference = `Profit & loss · ${business.name} · ${periodFrom} to ${periodTo}`;

    pdf.sectionTitle('Declaration');
    pdf.paragraph(
      'The figures above are taken directly from the sales, stock and expense records held in ' +
        'BizPilot for the period stated. They have not been adjusted by hand.',
      { muted: true },
    );

    pdf.signatures(
      [
        { role: 'Prepared by', name: `${requester.name} (${requester.role.toLowerCase()})` },
        { role: 'Approved by — owner', name: owner?.name ?? null },
      ],
      reference,
    );

    const buffer = await pdf.finalise({
      left: reference,
      generatedAt,
      branding: plan.features.removeBranding ? undefined : 'BizPilot',
    });

    return {
      buffer,
      filename: `profit-and-loss-${periodFrom}-to-${periodTo}.pdf`,
    };
  }

  /**
   * The end-of-day cash-up sheet.
   *
   * Unlike the P&L this is a **form**: the counted total is written on it by
   * hand, at the till, before it is signed. That is the whole point — a figure
   * typed into a screen by the person holding the money is not a control. Two
   * signatures: the person who counted, and the person who took the money off
   * them.
   */
  async cashUp(
    businessId: string,
    requester: Requester,
    date?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.entitlements.assertFeature(businessId, 'dataExport');

    const [business, plan, data] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { name: true, address: true, phone: true, currency: true },
      }),
      this.entitlements.planFor(businessId),
      this.reports.cashUp(businessId, date),
    ]);

    const owner = await this.prisma.user.findFirst({
      where: { businessId, role: 'OWNER', deletedAt: null },
      select: { name: true },
    });

    const currency = business.currency;
    const money = (value: number | bigint) => formatMoney(Number(value), currency);
    const generatedAt = new Date();

    const pdf = new PdfBuilder();

    pdf.header({
      businessName: business.name,
      businessLines: [business.address, business.phone],
      title: 'Daily cash-up',
      subtitle: data.date,
      meta: [
        ['Counted by', requester.name],
        ['Sales', String(data.salesCount)],
        ['Currency', currency],
      ],
    });

    // --- The drawer ----------------------------------------------------------
    pdf.sectionTitle(
      'The drawer',
      'Cash only. Mobile money and card never enter the till, and credit sales bring in nothing today.',
    );
    pdf.keyValues([
      ['Cash sales', money(data.cashSales)],
      [
        `Cash paid out${data.cashExpenseCount ? ` (${data.cashExpenseCount} expenses)` : ''}`,
        `(${money(data.cashExpenses)})`,
      ],
      ['Cash expected in drawer', money(data.cashExpected), true],
    ]);

    // Written in at the till, by hand, by the person counting.
    pdf.fillInLine('Cash counted', 'Write the counted total here');
    pdf.fillInLine('Difference (over / short)', 'Counted minus expected');
    pdf.fillInLine('Reason, if short or over', 'Explain any difference');

    // --- Takings -------------------------------------------------------------
    pdf.sectionTitle('Takings by payment method');
    pdf.table({
      columns: [
        { header: 'Method', width: 0.46 },
        { header: 'Sales', width: 0.18, align: 'right' },
        { header: 'Value', width: 0.36, align: 'right' },
      ],
      rows: data.byMethod.map((row) => [
        METHOD_LABELS[row.method] ?? row.method,
        String(row.count),
        money(row.total),
      ]),
      totalRow: ['Total takings', String(data.salesCount), money(data.revenue)],
      emptyText: 'No sales were recorded on this day.',
    });

    if (Number(data.creditGiven) > 0) {
      pdf.paragraph(
        `${money(data.creditGiven)} was given on credit today and is not part of the drawer total. ` +
          `It is owed by customers and should be chased.`,
        { muted: true },
      );
    }

    // --- Who served ----------------------------------------------------------
    if (data.byUser.length) {
      pdf.sectionTitle('Who served');
      pdf.table({
        columns: [
          { header: 'Name', width: 0.34 },
          { header: 'Sales', width: 0.14, align: 'right' },
          { header: 'Takings', width: 0.2, align: 'right' },
          { header: 'Average', width: 0.18, align: 'right' },
          { header: 'Voided', width: 0.14, align: 'right' },
        ],
        rows: data.byUser.map((row) => [
          row.name,
          String(row.sales),
          money(row.revenue),
          money(row.averageSale),
          row.voided > 0 ? { text: String(row.voided), bold: true } : '—',
        ]),
      });
    }

    if (data.voidedCount > 0) {
      pdf.paragraph(
        `${data.voidedCount} sale${data.voidedCount === 1 ? '' : 's'} worth ` +
          `${money(data.voidedTotal)} were voided on this day. Voided sales are excluded from ` +
          `every figure above.`,
        { muted: true },
      );
    }

    const reference = `Daily cash-up · ${business.name} · ${data.date}`;

    pdf.signatures(
      [
        { role: 'Counted by', name: `${requester.name} (${requester.role.toLowerCase()})` },
        { role: 'Received by', name: owner?.name ?? null },
      ],
      reference,
    );

    const buffer = await pdf.finalise({
      left: reference,
      generatedAt,
      branding: plan.features.removeBranding ? undefined : 'BizPilot',
    });

    return { buffer, filename: `cash-up-${data.date}.pdf` };
  }
}

/** YYYY-MM-DD in the server's own timezone, not UTC. */
function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}
