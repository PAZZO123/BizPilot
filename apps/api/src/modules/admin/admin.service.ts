import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { PLANS, type PlanId } from '@bizpilot/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { platformAdminEmails } from './platform-admin.guard';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The platform's own numbers: what BizPilot earns, what it costs to serve, and
 * which shops are about to decide whether to pay.
 *
 * Everything here reads across every tenant, which is the exact opposite of the
 * rule the rest of the API follows. That is why it sits behind its own guard and
 * its own module rather than being a flag on the reports service — the blast
 * radius of a mistake is every customer's turnover, so the code that can do it
 * is kept small and separate.
 *
 * Money is in RWF minor units throughout, like everywhere else.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async overview() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const sevenDaysAhead = new Date(now.getTime() + 7 * DAY_MS);

    const [
      byStatus,
      payingByPlan,
      trialsEndingSoon,
      newThisMonth,
      churnedLast30,
      collectedThisMonth,
      collectedAllTime,
      smsCostThisMonth,
      aiMessagesThisMonth,
      aiTokensThisMonth,
      aiUnmeteredCount,
      activeShopsLast30,
      totalShops,
    ] = await Promise.all([
      this.prisma.business.groupBy({
        by: ['subscriptionStatus'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.business.groupBy({
        by: ['plan'],
        where: { deletedAt: null, subscriptionStatus: SubscriptionStatus.ACTIVE },
        _count: { _all: true },
      }),
      this.prisma.business.count({
        where: {
          deletedAt: null,
          subscriptionStatus: SubscriptionStatus.TRIALING,
          trialEndsAt: { gte: now, lte: sevenDaysAhead },
        },
      }),
      this.prisma.business.count({
        where: { deletedAt: null, createdAt: { gte: monthStart } },
      }),
      this.prisma.business.count({
        where: {
          deletedAt: null,
          subscriptionStatus: { in: [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED] },
          updatedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.sumCollected({ gte: monthStart }),
      this.sumCollected(undefined),
      this.prisma.smsMessage.aggregate({
        where: { createdAt: { gte: monthStart }, cost: { not: null } },
        _sum: { cost: true },
      }),
      this.prisma.usageCounter.aggregate({
        where: { metric: 'ai_messages', period: monthStart },
        _sum: { count: true },
      }),
      // Real token counts, recorded on every assistant reply. These price the
      // AI line from what was actually consumed instead of a per-message guess.
      this.prisma.aiMessage.aggregate({
        where: { role: 'assistant', createdAt: { gte: monthStart } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      // Replies from before token metering existed (or from a provider that
      // reports no usage) have NULL counts. They still cost something, so they
      // are priced by the old per-message estimate rather than counted as free.
      this.prisma.aiMessage.count({
        where: { role: 'assistant', createdAt: { gte: monthStart }, inputTokens: null },
      }),
      // A shop that recorded a sale in the last 30 days is a shop that has not
      // quietly stopped using the product — the number that predicts churn
      // before the subscription status does.
      this.prisma.sale
        .findMany({
          where: { soldAt: { gte: thirtyDaysAgo } },
          distinct: ['businessId'],
          select: { businessId: true },
        })
        .then((rows) => rows.length),
      this.prisma.business.count({ where: { deletedAt: null } }),
    ]);

    const statusCounts = Object.fromEntries(
      byStatus.map((row) => [row.subscriptionStatus, row._count._all]),
    ) as Record<SubscriptionStatus, number | undefined>;

    // MRR is computed from the plan catalogue rather than from what was last
    // charged, so a price change is reflected the moment it deploys.
    const planCounts = payingByPlan.map((row) => ({
      plan: row.plan as PlanId,
      name: PLANS[row.plan as PlanId].name,
      shops: row._count._all,
      priceRwf: PLANS[row.plan as PlanId].priceRwf,
      mrrMinor: PLANS[row.plan as PlanId].priceRwf * 100 * row._count._all,
    }));

    const mrr = planCounts.reduce((total, row) => total + row.mrrMinor, 0);
    const payingShops = planCounts.reduce((total, row) => total + row.shops, 0);

    const aiCount = aiMessagesThisMonth._sum.count ?? 0;
    const aiInputTokens = aiTokensThisMonth._sum.inputTokens ?? 0;
    const aiOutputTokens = aiTokensThisMonth._sum.outputTokens ?? 0;

    // Metered replies are priced from real token counts at the configured
    // per-million rates; unmetered ones (older rows, or a provider that reports
    // no usage) fall back to the per-message estimate. Rates are whole RWF per
    // million tokens; the result is minor units like every other money figure.
    const inputRate = this.config.get<number>('AI_INPUT_RWF_PER_MTOK', 7250);
    const outputRate = this.config.get<number>('AI_OUTPUT_RWF_PER_MTOK', 36250);
    const meteredCost = Math.round(
      ((aiInputTokens * inputRate + aiOutputTokens * outputRate) / 1_000_000) * 100,
    );
    const aiCost =
      meteredCost + aiUnmeteredCount * this.config.get<number>('AI_COST_PER_MESSAGE_RWF', 1500);
    const smsCost = Number(smsCostThisMonth._sum.cost ?? 0n);

    return {
      mrr,
      arr: mrr * 12,
      payingShops,
      totalShops,
      planCounts,

      trialing: statusCounts.TRIALING ?? 0,
      trialsEndingSoon,
      pastDue: statusCounts.PAST_DUE ?? 0,
      churnedLast30,
      newThisMonth,

      /** Shops that recorded at least one sale in the last 30 days. */
      activeShopsLast30,
      /** Of every shop that ever existed, the share now paying. */
      paidConversionRate: totalShops ? payingShops / totalShops : 0,

      collectedThisMonth,
      collectedAllTime,

      // Revenue is what we bill; these are what serving it costs us. The gap is
      // the only number that decides whether the price is right.
      costs: {
        smsThisMonth: smsCost,
        aiMessagesThisMonth: aiCount,
        aiInputTokensThisMonth: aiInputTokens,
        aiOutputTokensThisMonth: aiOutputTokens,
        /** Replies with no recorded usage, priced by the per-message estimate. */
        aiUnmeteredThisMonth: aiUnmeteredCount,
        aiCostThisMonth: aiCost,
        totalThisMonth: smsCost + aiCost,
      },
      grossMarginThisMonth: collectedThisMonth - (smsCost + aiCost),
    };
  }

  /** Cash actually collected, by calendar month, for the last `months`. */
  async revenueByMonth(months = 12) {
    const rows = await this.prisma.$queryRaw<
      { month: Date; collected: bigint; payments: bigint }[]
    >`
      SELECT
        date_trunc('month', "createdAt")        AS month,
        COALESCE(SUM(amount), 0)::bigint        AS collected,
        COUNT(*)                                AS payments
      FROM billing_transactions
      WHERE status = 'SUCCESSFUL'
        AND "createdAt" >= date_trunc('month', now()) - (${months - 1} || ' months')::interval
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((row) => ({
      month: row.month.toISOString().slice(0, 7),
      collected: Number(row.collected),
      payments: Number(row.payments),
    }));
  }

  /** New shops per week for the last `weeks` — is the funnel filling up? */
  async signupsByWeek(weeks = 12) {
    const rows = await this.prisma.$queryRaw<{ week: Date; signups: bigint }[]>`
      SELECT
        date_trunc('week', "createdAt") AS week,
        COUNT(*)                       AS signups
      FROM businesses
      WHERE "deletedAt" IS NULL
        AND "createdAt" >= date_trunc('week', now()) - (${weeks - 1} || ' weeks')::interval
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((row) => ({
      week: row.week.toISOString().slice(0, 10),
      signups: Number(row.signups),
    }));
  }

  /**
   * The account list, ordered by how much they are worth and how alive they
   * are. This is the call list: a trial ending in two days with 200 sales
   * recorded is a customer, and a paying shop that has not sold anything in a
   * month is about to cancel.
   */
  async shops(limit = 100) {
    const businesses = await this.prisma.business.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      select: {
        id: true,
        name: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true,
        currency: true,
        _count: { select: { users: true, products: true } },
      },
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const ids = businesses.map((business) => business.id);

    const [salesRows, lastSaleRows] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ['businessId'],
        where: { businessId: { in: ids }, soldAt: { gte: thirtyDaysAgo }, status: { not: 'VOIDED' } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.sale.groupBy({
        by: ['businessId'],
        where: { businessId: { in: ids } },
        _max: { soldAt: true },
      }),
    ]);

    const salesByBusiness = new Map(salesRows.map((row) => [row.businessId, row]));
    const lastSaleByBusiness = new Map(lastSaleRows.map((row) => [row.businessId, row._max.soldAt]));

    return businesses.map((business) => {
      const sales = salesByBusiness.get(business.id);
      return {
        id: business.id,
        name: business.name,
        plan: business.plan,
        status: business.subscriptionStatus,
        currency: business.currency,
        trialEndsAt: business.trialEndsAt,
        createdAt: business.createdAt,
        users: business._count.users,
        products: business._count.products,
        salesLast30: sales?._count._all ?? 0,
        turnoverLast30: Number(sales?._sum.total ?? 0n),
        lastSaleAt: lastSaleByBusiness.get(business.id) ?? null,
        /** What we bill them each month, from the plan catalogue. */
        mrrMinor:
          business.subscriptionStatus === SubscriptionStatus.ACTIVE
            ? PLANS[business.plan as PlanId].priceRwf * 100
            : 0,
      };
    });
  }

  /**
   * What this installation is actually wired to.
   *
   * Half the support questions in a self-run SaaS are "is the thing switched
   * on?" — payments, the assistant, SMS. Reading that off a screen beats
   * shelling into the host to grep environment variables, and it is the first
   * place to look when a customer says a feature does nothing.
   *
   * Names and on/off only. No key, or part of a key, is ever returned.
   */
  system() {
    const paymentProvider = this.config.get<string>('PAYMENT_PROVIDER', 'flutterwave');
    const momoEnvironment = this.config.get<string>('MOMO_TARGET_ENVIRONMENT', 'sandbox');

    return {
      payments: {
        provider: paymentProvider,
        configured:
          paymentProvider === 'mtn-momo'
            ? Boolean(
                this.config.get<string>('MOMO_SUBSCRIPTION_KEY') &&
                  this.config.get<string>('MOMO_API_USER') &&
                  this.config.get<string>('MOMO_API_KEY'),
              )
            : Boolean(this.config.get<string>('FLUTTERWAVE_SECRET_KEY')),
        environment: paymentProvider === 'mtn-momo' ? momoEnvironment : 'live',
        /** Sandbox takes no real money — worth saying plainly on the screen. */
        takesRealMoney: paymentProvider !== 'mtn-momo' || momoEnvironment === 'production',
        callbackSecretSet: Boolean(this.config.get<string>('MOMO_CALLBACK_SECRET')),
      },
      assistant: {
        provider: this.config.get<string>('AI_PROVIDER', 'anthropic'),
        model: this.config.get<string>('ANTHROPIC_MODEL', 'claude-opus-5'),
        configured: Boolean(
          this.config.get<string>('ANTHROPIC_API_KEY') || this.config.get<string>('AI_API_KEY'),
        ),
      },
      sms: {
        configured: Boolean(this.config.get<string>('SMS_API_KEY')),
        sender: this.config.get<string>('SMS_SENDER_ID', ''),
      },
      platformAdmins: platformAdminEmails(this.config).length,
      environment: this.config.get<string>('NODE_ENV', 'development'),
      startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)),
    };
  }

  private async sumCollected(createdAt: { gte: Date } | undefined): Promise<number> {
    const result = await this.prisma.billingTransaction.aggregate({
      where: { status: PaymentStatus.SUCCESSFUL, ...(createdAt ? { createdAt } : {}) },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0n);
  }
}
