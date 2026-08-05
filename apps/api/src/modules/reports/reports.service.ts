import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { dateRange } from '../sales/sales.service';

export interface PeriodTotals {
  revenue: bigint;
  cost: bigint;
  grossProfit: bigint;
  expenses: bigint;
  netProfit: bigint;
  cashCollected: bigint;
  salesCount: number;
}

/**
 * Reporting is read-only and aggregate-heavy, so it goes through raw SQL where
 * Prisma's query builder would force several round trips.
 *
 * Every SUM is cast back with `::bigint`. Postgres widens SUM(bigint) to
 * `numeric`, which Prisma deserialises as a Decimal object — it would satisfy
 * the TypeScript types here while blowing up at runtime the first time the
 * result met a BigInt operand.
 *
 * Revenue is recognised when the sale is made, not when the cash arrives —
 * that is what makes profit meaningful for a shop that sells on credit.
 * `cashCollected` is reported alongside it so the owner can see the difference.
 * Voided sales are excluded everywhere.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async periodTotals(businessId: string, from: Date, to: Date): Promise<PeriodTotals> {
    const [salesRow, expenseRow] = await Promise.all([
      this.prisma.$queryRaw<
        { revenue: bigint | null; cost: bigint | null; paid: bigint | null; count: bigint }[]
      >`
        SELECT
          COALESCE(SUM(total), 0)::bigint          AS revenue,
          COALESCE(SUM("costTotal"), 0)::bigint    AS cost,
          COALESCE(SUM("amountPaid"), 0)::bigint   AS paid,
          COUNT(*)                                 AS count
        FROM sales
        WHERE "businessId" = ${businessId}
          AND status <> 'VOIDED'
          AND "soldAt" BETWEEN ${from} AND ${to}
      `,
      this.prisma.$queryRaw<{ total: bigint | null }[]>`
        SELECT COALESCE(SUM(amount), 0)::bigint AS total
        FROM expenses
        WHERE "businessId" = ${businessId}
          AND "deletedAt" IS NULL
          AND "spentAt" BETWEEN ${from} AND ${to}
      `,
    ]);

    const revenue = salesRow[0]?.revenue ?? 0n;
    const cost = salesRow[0]?.cost ?? 0n;
    const expenses = expenseRow[0]?.total ?? 0n;
    const grossProfit = revenue - cost;

    return {
      revenue,
      cost,
      grossProfit,
      expenses,
      netProfit: grossProfit - expenses,
      cashCollected: salesRow[0]?.paid ?? 0n,
      salesCount: Number(salesRow[0]?.count ?? 0n),
    };
  }

  /** Revenue and profit per day, for the dashboard chart. */
  async revenueTrend(businessId: string, days = 30) {
    const from = startOfDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));

    const rows = await this.prisma.$queryRaw<
      { day: Date; revenue: bigint; profit: bigint; sales: bigint }[]
    >`
      SELECT
        date_trunc('day', "soldAt")                       AS day,
        COALESCE(SUM(total), 0)::bigint                   AS revenue,
        COALESCE(SUM(total - "costTotal"), 0)::bigint     AS profit,
        COUNT(*)                                          AS sales
      FROM sales
      WHERE "businessId" = ${businessId}
        AND status <> 'VOIDED'
        AND "soldAt" >= ${from}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Days with no sales are absent from the result but must appear on the
    // chart, otherwise a quiet week looks like a missing week.
    const byDay = new Map(
      rows.map((row) => [
        row.day.toISOString().slice(0, 10),
        { revenue: row.revenue, profit: row.profit, sales: Number(row.sales) },
      ]),
    );

    return Array.from({ length: days }, (_, index) => {
      const date = new Date(from.getTime() + index * 24 * 60 * 60 * 1000);
      const key = date.toISOString().slice(0, 10);
      const entry = byDay.get(key);
      return {
        date: key,
        revenue: entry?.revenue ?? 0n,
        profit: entry?.profit ?? 0n,
        sales: entry?.sales ?? 0,
      };
    });
  }

  /** Best sellers by revenue over a period. */
  async topProducts(businessId: string, from: Date, to: Date, limit = 10) {
    return this.prisma.$queryRaw<
      {
        productId: string | null;
        name: string;
        unitsSold: bigint;
        revenue: bigint;
        profit: bigint;
      }[]
    >`
      SELECT
        si."productId"                                        AS "productId",
        MAX(si.name)                                          AS name,
        SUM(si.quantity)::bigint                                      AS "unitsSold",
        SUM(si.total)::bigint                                         AS revenue,
        SUM(si.total - (si."unitCost" * si.quantity))::bigint         AS profit
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s."businessId" = ${businessId}
        AND s.status <> 'VOIDED'
        AND s."soldAt" BETWEEN ${from} AND ${to}
      GROUP BY si."productId"
      ORDER BY revenue DESC
      LIMIT ${limit}
    `;
  }

  /** Products that sold nothing in the period but are sitting on stock. */
  async deadStock(businessId: string, from: Date, to: Date, limit = 10) {
    return this.prisma.$queryRaw<
      { id: string; name: string; stockQty: number; tiedUpCapital: bigint }[]
    >`
      SELECT
        p.id,
        p.name,
        p."stockQty"                        AS "stockQty",
        (p."costPrice" * p."stockQty")::bigint      AS "tiedUpCapital"
      FROM products p
      WHERE p."businessId" = ${businessId}
        AND p."deletedAt" IS NULL
        AND p."isActive" = true
        AND p."trackStock" = true
        AND p."stockQty" > 0
        AND NOT EXISTS (
          SELECT 1
          FROM sale_items si
          JOIN sales s ON s.id = si."saleId"
          WHERE si."productId" = p.id
            AND s.status <> 'VOIDED'
            AND s."soldAt" BETWEEN ${from} AND ${to}
        )
      ORDER BY "tiedUpCapital" DESC
      LIMIT ${limit}
    `;
  }

  /** Sales split by how customers paid — cash vs MoMo vs credit. */
  async paymentMethodBreakdown(businessId: string, from: Date, to: Date) {
    const grouped = await this.prisma.sale.groupBy({
      by: ['paymentMethod'],
      where: {
        businessId,
        status: { not: SaleStatus.VOIDED },
        soldAt: { gte: from, lte: to },
      },
      _sum: { total: true },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      method: row.paymentMethod,
      total: row._sum.total ?? 0n,
      count: row._count._all,
    }));
  }

  /** Which hours of the day the shop is busiest — staffing and stocking hint. */
  async salesByHour(businessId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<{ hour: number; revenue: bigint; sales: bigint }[]>`
      SELECT
        EXTRACT(HOUR FROM "soldAt")::int  AS hour,
        COALESCE(SUM(total), 0)::bigint   AS revenue,
        COUNT(*)                          AS sales
      FROM sales
      WHERE "businessId" = ${businessId}
        AND status <> 'VOIDED'
        AND "soldAt" BETWEEN ${from} AND ${to}
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map((row) => ({ ...row, sales: Number(row.sales) }));
  }

  /** The headline numbers for the home screen. */
  async dashboard(businessId: string) {
    const cacheKey = `dashboard:${businessId}`;
    // 60 seconds is short enough that a shopkeeper sees their own sale appear,
    // and long enough to absorb a page that polls.
    const cached = await this.redis.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonthEnd = new Date(monthStart.getTime() - 1);

    const [
      business,
      today,
      thisMonth,
      lastMonth,
      trend,
      topProducts,
      lowStock,
      overdue,
      receivables,
    ] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { currency: true, name: true },
      }),
      this.periodTotals(businessId, todayStart, now),
      this.periodTotals(businessId, monthStart, now),
      this.periodTotals(businessId, lastMonthStart, lastMonthEnd),
      this.revenueTrend(businessId, 30),
      this.topProducts(businessId, monthStart, now, 5),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count
        FROM products
        WHERE "businessId" = ${businessId}
          AND "deletedAt" IS NULL AND "isActive" = true
          AND "trackStock" = true AND "stockQty" <= "reorderLevel"
      `,
      this.prisma.invoice.aggregate({
        where: {
          businessId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE] },
          dueDate: { lt: now },
        },
        _sum: { total: true, amountPaid: true },
        _count: { _all: true },
      }),
      this.prisma.customer.aggregate({
        where: { businessId, deletedAt: null, balance: { gt: 0 } },
        _sum: { balance: true },
        _count: { _all: true },
      }),
    ]);

    const overdueTotal = (overdue._sum.total ?? 0n) - (overdue._sum.amountPaid ?? 0n);

    const result = {
      currency: business.currency,
      businessName: business.name,
      today,
      thisMonth,
      lastMonth,
      // Percentage change in revenue month on month, for the trend arrow.
      revenueChangePct: percentChange(lastMonth.revenue, thisMonth.revenue),
      revenueTrend: trend,
      topProducts,
      lowStockCount: Number(lowStock[0]?.count ?? 0n),
      overdueInvoiceCount: overdue._count._all,
      overdueInvoiceTotal: overdueTotal,
      customersOwingCount: receivables._count._all,
      totalReceivable: receivables._sum.balance ?? 0n,
    };

    await this.redis.set(cacheKey, result, 60);
    return result;
  }

  /** Profit and loss for an arbitrary period, with the expense breakdown. */
  async profitAndLoss(businessId: string, fromInput?: string, toInput?: string) {
    const to = toInput ? endOfDay(new Date(toInput)) : new Date();
    const from = fromInput
      ? startOfDay(new Date(fromInput))
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

    const [totals, expensesByCategory, topProducts, methods] = await Promise.all([
      this.periodTotals(businessId, from, to),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: { businessId, deletedAt: null, ...dateRange('spentAt', from.toISOString(), to.toISOString()) },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
      this.topProducts(businessId, from, to, 10),
      this.paymentMethodBreakdown(businessId, from, to),
    ]);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      ...totals,
      // Margin as a percentage, guarding against a period with no sales.
      grossMarginPct:
        totals.revenue > 0n ? Number((totals.grossProfit * 10000n) / totals.revenue) / 100 : 0,
      expensesByCategory: expensesByCategory.map((row) => ({
        category: row.category,
        total: row._sum.amount ?? 0n,
      })),
      topProducts,
      paymentMethods: methods,
    };
  }

  /**
   * End-of-day cash-up, the report a shop actually closes on.
   *
   * The number that matters is `cashExpected`: what should physically be in the
   * drawer. It is cash sales only — MoMo and card never touch the till, and a
   * credit sale brings in no money today at all. Cash paid out for expenses is
   * subtracted because that money left the same drawer.
   *
   * Voided sales are excluded from the totals but counted separately: a day with
   * six voids is a day worth asking about.
   */
  async cashUp(businessId: string, dateInput?: string) {
    const day = dateInput ? new Date(dateInput) : new Date();
    const from = startOfDay(day);
    const to = endOfDay(day);

    const [business, totals, byMethod, voided, cashExpenses, byUser, hourly] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { currency: true, name: true },
      }),
      this.periodTotals(businessId, from, to),
      this.paymentMethodBreakdown(businessId, from, to),
      this.prisma.sale.aggregate({
        where: { businessId, status: SaleStatus.VOIDED, soldAt: { gte: from, lte: to } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      // Expenses paid in cash come out of the same drawer as cash takings.
      this.prisma.expense.aggregate({
        where: {
          businessId,
          deletedAt: null,
          method: PaymentMethod.CASH,
          spentAt: { gte: from, lte: to },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.salesByUser(businessId, from, to),
      this.salesByHour(businessId, from, to),
    ]);

    const cashSales =
      byMethod.find((row) => row.method === PaymentMethod.CASH)?.total ?? 0n;
    const cashOut = cashExpenses._sum.amount ?? 0n;
    const creditGiven =
      byMethod.find((row) => row.method === PaymentMethod.CREDIT)?.total ?? 0n;

    return {
      // Not `toISOString().slice(0, 10)`: `from` is local midnight, which in
      // Kigali (UTC+2) is 22:00 the previous day in UTC. A shopkeeper closing
      // up at 8pm would see yesterday's date on today's takings.
      date: localIsoDate(from),
      currency: business.currency,
      businessName: business.name,

      salesCount: totals.salesCount,
      revenue: totals.revenue,
      grossProfit: totals.grossProfit,

      byMethod,
      cashSales,
      cashExpenses: cashOut,
      cashExpenseCount: cashExpenses._count._all,
      /** What should be in the drawer at close. */
      cashExpected: cashSales - cashOut,
      /** Sold today but not paid for today — chase these. */
      creditGiven,

      voidedCount: voided._count._all,
      voidedTotal: voided._sum.total ?? 0n,

      byUser,
      hourly,
    };
  }

  /**
   * Who sold what. Only meaningful once a shop has staff, which is exactly the
   * point at which they need a paid plan — an owner working alone sees one row.
   */
  async salesByUser(businessId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      {
        userId: string | null;
        name: string | null;
        role: string | null;
        sales: bigint;
        revenue: bigint;
        profit: bigint;
        discounts: bigint;
        voided: bigint;
      }[]
    >`
      SELECT
        s."userId"                                                          AS "userId",
        MAX(u.name)                                                         AS name,
        MAX(u.role::text)                                                   AS role,
        COUNT(*) FILTER (WHERE s.status <> 'VOIDED')                        AS sales,
        COALESCE(SUM(s.total)      FILTER (WHERE s.status <> 'VOIDED'), 0)::bigint AS revenue,
        COALESCE(SUM(s.total - s."costTotal")
                                   FILTER (WHERE s.status <> 'VOIDED'), 0)::bigint AS profit,
        COALESCE(SUM(s.discount)   FILTER (WHERE s.status <> 'VOIDED'), 0)::bigint AS discounts,
        COUNT(*) FILTER (WHERE s.status = 'VOIDED')                         AS voided
      FROM sales s
      LEFT JOIN users u ON u.id = s."userId"
      WHERE s."businessId" = ${businessId}
        AND s."soldAt" BETWEEN ${from} AND ${to}
      GROUP BY s."userId"
      ORDER BY revenue DESC
    `;

    return rows.map((row) => {
      const sales = Number(row.sales);
      return {
        userId: row.userId,
        name: row.name ?? 'Removed user',
        role: row.role ?? null,
        sales,
        revenue: row.revenue,
        profit: row.profit,
        discounts: row.discounts,
        voided: Number(row.voided),
        // Average basket is the number that separates a cashier who upsells
        // from one who does not, and it is not visible from a revenue total.
        averageSale: sales > 0 ? row.revenue / BigInt(sales) : 0n,
      };
    });
  }

  /** Invalidates the cached dashboard after a write. */
  async invalidate(businessId: string): Promise<void> {
    await this.redis.del(`dashboard:${businessId}`);
  }
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** YYYY-MM-DD in the server's own timezone, not UTC. */
function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** Percentage change, expressed to one decimal place. */
function percentChange(previous: bigint, current: bigint): number | null {
  if (previous === 0n) return current === 0n ? 0 : null;
  const change = ((current - previous) * 1000n) / previous;
  return Number(change) / 10;
}
