import { ForbiddenException, Injectable } from '@nestjs/common';
import { Business, PlanId as PrismaPlanId, SubscriptionStatus } from '@prisma/client';
import {
  PLANS,
  TRIAL_PLAN,
  type Plan,
  type PlanFeatures,
  type PlanId,
} from '@bizpilot/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

export type UsageMetric = 'sales' | 'sms' | 'ai_messages';

/**
 * Decides what a business is allowed to do right now.
 *
 * The plan stored on the row is what they have *bought*; the effective plan is
 * what they can *use*, which differs during a trial and after a failed payment.
 * Everything that enforces a limit goes through here so the rules live in one
 * place and the pricing page cannot drift from the enforcement.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The plan whose limits actually apply to this business today. */
  effectivePlan(business: Pick<Business, 'plan' | 'subscriptionStatus' | 'trialEndsAt'>): Plan {
    const { plan, subscriptionStatus, trialEndsAt } = business;

    if (subscriptionStatus === SubscriptionStatus.TRIALING) {
      const trialActive = trialEndsAt !== null && trialEndsAt.getTime() > Date.now();
      // An expired trial drops to Free rather than locking the account — the
      // owner's data stays readable and they can keep working, just smaller.
      return trialActive ? PLANS[TRIAL_PLAN] : PLANS.free;
    }

    if (subscriptionStatus === SubscriptionStatus.ACTIVE) {
      return PLANS[plan as PlanId];
    }

    // PAST_DUE keeps paid access for the grace period the billing job enforces;
    // once it flips to EXPIRED or CANCELLED they are on Free.
    if (subscriptionStatus === SubscriptionStatus.PAST_DUE) {
      return PLANS[plan as PlanId];
    }

    return PLANS.free;
  }

  async planFor(businessId: string): Promise<Plan> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { plan: true, subscriptionStatus: true, trialEndsAt: true },
    });
    return this.effectivePlan(business);
  }

  /** Throws unless the business's plan includes `feature`. */
  async assertFeature(businessId: string, feature: keyof PlanFeatures): Promise<void> {
    const plan = await this.planFor(businessId);
    if (!plan.features[feature]) {
      throw new ForbiddenException({
        message: `${humanFeature(feature)} is not included in the ${plan.name} plan.`,
        error: 'PlanUpgradeRequired',
        currentPlan: plan.id,
        feature,
      });
    }
  }

  /** Throws if adding one more product would exceed the plan's catalogue cap. */
  async assertCanAddProduct(businessId: string): Promise<void> {
    const plan = await this.planFor(businessId);
    const limit = plan.limits.products;
    if (limit === null) return;

    const count = await this.prisma.product.count({ where: { businessId, deletedAt: null } });
    if (count >= limit) {
      throw new ForbiddenException({
        message: `The ${plan.name} plan allows ${limit} products. Upgrade to add more.`,
        error: 'PlanLimitReached',
        currentPlan: plan.id,
        limit,
      });
    }
  }

  /** Throws if adding one more staff account would exceed the plan's seat cap. */
  async assertCanAddUser(businessId: string): Promise<void> {
    const plan = await this.planFor(businessId);
    const count = await this.prisma.user.count({ where: { businessId, deletedAt: null } });
    if (count >= plan.limits.users) {
      throw new ForbiddenException({
        message: `The ${plan.name} plan allows ${plan.limits.users} user account(s). Upgrade to add staff.`,
        error: 'PlanLimitReached',
        currentPlan: plan.id,
        limit: plan.limits.users,
      });
    }
  }

  /**
   * Checks a monthly metered limit without consuming it. Call `consume` after
   * the work succeeds so a failed request does not burn the customer's quota.
   */
  async assertWithinMonthlyLimit(businessId: string, metric: UsageMetric): Promise<void> {
    const plan = await this.planFor(businessId);
    const limit = monthlyLimit(plan, metric);
    if (limit === null) return;

    const used = await this.currentUsage(businessId, metric);
    if (used >= limit) {
      throw new ForbiddenException({
        message: limitMessage(metric, plan, limit),
        error: 'PlanLimitReached',
        currentPlan: plan.id,
        metric,
        limit,
        used,
      });
    }
  }

  async currentUsage(businessId: string, metric: UsageMetric): Promise<number> {
    const counter = await this.prisma.usageCounter.findUnique({
      where: {
        businessId_metric_period: { businessId, metric, period: currentPeriod() },
      },
      select: { count: true },
    });
    return counter?.count ?? 0;
  }

  /** Atomically records `amount` units of usage for the current month. */
  async consume(businessId: string, metric: UsageMetric, amount = 1): Promise<void> {
    const period = currentPeriod();
    await this.prisma.usageCounter.upsert({
      where: { businessId_metric_period: { businessId, metric, period } },
      create: { businessId, metric, period, count: amount },
      update: { count: { increment: amount } },
    });
  }

  /** Everything the frontend needs to render usage bars and upgrade prompts. */
  async summary(businessId: string) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { plan: true, subscriptionStatus: true, trialEndsAt: true },
    });
    const plan = this.effectivePlan(business);

    const [sales, sms, ai, products, users] = await Promise.all([
      this.currentUsage(businessId, 'sales'),
      this.currentUsage(businessId, 'sms'),
      this.currentUsage(businessId, 'ai_messages'),
      this.prisma.product.count({ where: { businessId, deletedAt: null } }),
      this.prisma.user.count({ where: { businessId, deletedAt: null } }),
    ]);

    return {
      plan,
      purchasedPlan: business.plan as PrismaPlanId,
      subscriptionStatus: business.subscriptionStatus,
      trialEndsAt: business.trialEndsAt,
      usage: {
        salesThisMonth: { used: sales, limit: plan.limits.salesPerMonth },
        smsThisMonth: { used: sms, limit: plan.limits.smsPerMonth },
        aiMessagesThisMonth: { used: ai, limit: plan.limits.aiMessagesPerMonth },
        products: { used: products, limit: plan.limits.products },
        users: { used: users, limit: plan.limits.users },
      },
    };
  }
}

/** First instant of the current month, UTC — the key usage counters bucket by. */
function currentPeriod(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function monthlyLimit(plan: Plan, metric: UsageMetric): number | null {
  switch (metric) {
    case 'sales':
      return plan.limits.salesPerMonth;
    case 'sms':
      return plan.limits.smsPerMonth;
    case 'ai_messages':
      return plan.limits.aiMessagesPerMonth;
  }
}

function limitMessage(metric: UsageMetric, plan: Plan, limit: number): string {
  switch (metric) {
    case 'sales':
      return `You have recorded ${limit} sales this month, the ${plan.name} plan's limit. Upgrade to keep selling.`;
    case 'sms':
      return `You have used all ${limit} SMS credits included this month.`;
    case 'ai_messages':
      return limit === 0
        ? 'The AI assistant is not included in your current plan.'
        : `You have used all ${limit} AI questions included this month.`;
  }
}

function humanFeature(feature: keyof PlanFeatures): string {
  const labels: Record<keyof PlanFeatures, string> = {
    invoicePdf: 'PDF invoices',
    removeBranding: 'Custom invoice branding',
    onlinePayments: 'Online payments',
    multiLocation: 'Multiple locations',
    dataExport: 'Data export',
    prioritySupport: 'Priority support',
  };
  return labels[feature];
}
