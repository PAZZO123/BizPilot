import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentStatus,
  Prisma,
  SubscriptionStatus,
  UserRole,
  type PlanId as PrismaPlanId,
} from '@prisma/client';
import { PLANS, type PlanId } from '@bizpilot/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import { isPlatformAdmin } from './platform-admin.guard';

/** Who is doing this, for the audit trail. */
export interface ActingAdmin {
  id: string;
  email: string;
  ip?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The parts of the platform console that change things.
 *
 * Kept apart from `AdminService`, which only reads: these methods can suspend a
 * business, sign a person out and move money-bearing state, across every tenant
 * at once. Separating them means the dangerous code is a short file that can be
 * read in one sitting, and it makes the rule below hard to lose track of.
 *
 * ## Every mutation is recorded, and every mutation needs a reason
 *
 * Each method here writes an AuditLog row naming the admin, what changed from
 * and to, and why. The reason is required by the DTO rather than optional,
 * because the value of this log is entirely in the six-months-later case where
 * somebody asks why a shop was suspended, and "no reason given" answers nothing.
 *
 * ## Two things an admin may never do
 *
 * They may not act on their own account, and they may not act on another
 * platform admin's. Both exist to keep the console recoverable: a mistake should
 * cost a customer's afternoon, never the ability to sign in and undo it.
 */
@Injectable()
export class AdminManagementService {
  private readonly logger = new Logger(AdminManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly billing: BillingService,
  ) {}

  // --- Accounts ------------------------------------------------------------

  /**
   * The account list, searchable. This is the screen someone lives in when a
   * customer emails asking why something is wrong, so it searches the things a
   * customer will quote at you: their shop name, their email, their phone.
   */
  async accounts(params: {
    search?: string;
    status?: SubscriptionStatus;
    plan?: PrismaPlanId;
    suspended?: boolean;
    limit: number;
  }) {
    const search = params.search?.trim();
    const where: Prisma.BusinessWhereInput = {
      // `suspended` is a three-state filter: undefined means everything, which
      // is what you want when hunting for an account you have just suspended.
      ...(params.suspended === undefined
        ? {}
        : params.suspended
          ? { deletedAt: { not: null } }
          : { deletedAt: null }),
      ...(params.status ? { subscriptionStatus: params.status } : {}),
      ...(params.plan ? { plan: params.plan } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { users: { some: { email: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.business.count({ where }),
      this.prisma.business.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          plan: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          createdAt: true,
          deletedAt: true,
          currency: true,
          _count: { select: { users: true, products: true, sales: true } },
        },
      }),
    ]);

    return {
      total,
      shown: rows.length,
      accounts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        plan: row.plan,
        status: row.subscriptionStatus,
        suspended: row.deletedAt !== null,
        suspendedAt: row.deletedAt,
        trialEndsAt: row.trialEndsAt,
        createdAt: row.createdAt,
        currency: row.currency,
        users: row._count.users,
        products: row._count.products,
        sales: row._count.sales,
        mrrMinor:
          row.subscriptionStatus === SubscriptionStatus.ACTIVE
            ? PLANS[row.plan as PlanId].priceRwf * 100
            : 0,
      })),
    };
  }

  /** Everything about one account, for the detail panel. */
  async account(id: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        email: true,
        phone: true,
        address: true,
        currency: true,
        country: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true,
        deletedAt: true,
        users: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        subscription: {
          select: {
            plan: true,
            status: true,
            provider: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            cancelledAt: true,
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 20,
              select: {
                id: true,
                plan: true,
                amount: true,
                currency: true,
                status: true,
                provider: true,
                reference: true,
                providerRef: true,
                createdAt: true,
                periodEnd: true,
              },
            },
          },
        },
        _count: { select: { products: true, customers: true, invoices: true } },
      },
    });

    if (!business) throw new NotFoundException('No such account.');

    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const [sales, lastSale, smsThisMonth, auditTrail] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { businessId: id, soldAt: { gte: thirtyDaysAgo }, status: { not: 'VOIDED' } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.sale.findFirst({
        where: { businessId: id },
        orderBy: { soldAt: 'desc' },
        select: { soldAt: true },
      }),
      this.prisma.smsMessage.count({
        where: { businessId: id, createdAt: { gte: monthStart() } },
      }),
      // What the platform has done to this account, so the person picking up a
      // complaint can see it was suspended last Tuesday and by whom.
      this.prisma.auditLog.findMany({
        where: { businessId: id, action: { startsWith: 'admin.' } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          metadata: true,
          createdAt: true,
          user: { select: { email: true } },
        },
      }),
    ]);

    return {
      ...business,
      suspended: business.deletedAt !== null,
      subscription: business.subscription
        ? {
            ...business.subscription,
            transactions: business.subscription.transactions.map((transaction) => ({
              ...transaction,
              amount: Number(transaction.amount),
            })),
          }
        : null,
      usage: {
        salesLast30: sales._count._all,
        turnoverLast30: Number(sales._sum.total ?? 0n),
        lastSaleAt: lastSale?.soldAt ?? null,
        smsThisMonth,
        products: business._count.products,
        customers: business._count.customers,
        invoices: business._count.invoices,
      },
      adminHistory: auditTrail,
    };
  }

  /**
   * Suspends an account: nobody from it can sign in, and everyone signed in is
   * signed out. Reversible — nothing is deleted, and `restoreAccount` puts it
   * back exactly as it was.
   */
  async suspendAccount(admin: ActingAdmin, id: string, reason: string) {
    const business = await this.requireAccount(id);
    if (business.deletedAt) {
      throw new BadRequestException('That account is already suspended.');
    }
    await this.assertNoPlatformAdminInside(id);

    const userIds = business.users.map((user) => user.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.business.update({ where: { id }, data: { deletedAt: new Date() } });
      // Without this they keep working until every access token expires, and a
      // suspension that takes fifteen minutes to bite is not a suspension.
      await tx.refreshToken.updateMany({
        where: { userId: { in: userIds }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.record(admin, id, 'admin.account.suspend', { reason, name: business.name });
    this.logger.warn(`${admin.email} suspended ${business.name} (${id}): ${reason}`);
    return { suspended: true, sessionsRevoked: userIds.length };
  }

  async restoreAccount(admin: ActingAdmin, id: string, reason: string) {
    const business = await this.requireAccount(id);
    if (!business.deletedAt) {
      throw new BadRequestException('That account is not suspended.');
    }

    await this.prisma.business.update({ where: { id }, data: { deletedAt: null } });
    await this.record(admin, id, 'admin.account.restore', { reason, name: business.name });
    this.logger.log(`${admin.email} restored ${business.name} (${id}): ${reason}`);
    return { suspended: false };
  }

  /**
   * Puts an account on a plan without taking payment.
   *
   * The honest name for this is a comp: a pilot shop, a support gesture, a
   * customer whose payment failed for a reason that was ours. It bills nothing,
   * which is exactly why it is worth logging loudly — this is the one control
   * here that can quietly give away the product.
   */
  async setPlan(admin: ActingAdmin, id: string, plan: PlanId, months: number, reason: string) {
    const business = await this.requireAccount(id);
    const free = plan === 'free';
    const now = new Date();
    const periodEnd = free ? null : new Date(now.getTime() + months * 30 * DAY_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id },
        data: {
          plan: plan as PrismaPlanId,
          subscriptionStatus: free ? SubscriptionStatus.EXPIRED : SubscriptionStatus.ACTIVE,
        },
      });
      await tx.subscription.upsert({
        where: { businessId: id },
        create: {
          businessId: id,
          plan: plan as PrismaPlanId,
          status: free ? SubscriptionStatus.EXPIRED : SubscriptionStatus.ACTIVE,
          currentPeriodStart: free ? null : now,
          currentPeriodEnd: periodEnd,
          provider: 'manual',
        },
        update: {
          plan: plan as PrismaPlanId,
          status: free ? SubscriptionStatus.EXPIRED : SubscriptionStatus.ACTIVE,
          currentPeriodStart: free ? null : now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          // Marked so the revenue figures can tell a comp from a sale. Counting
          // these as income would overstate MRR with money nobody paid.
          provider: 'manual',
        },
      });
    });

    await this.record(admin, id, 'admin.account.plan', {
      reason,
      from: business.plan,
      to: plan,
      months,
      granted: true,
    });
    this.logger.warn(
      `${admin.email} granted ${business.name} the ${plan} plan for ${months} month(s): ${reason}`,
    );
    return { plan, periodEnd };
  }

  /** Buys a shop more time to decide. Extends from whichever is later — now, or
   *  the trial they already have — so it never shortens one by accident. */
  async extendTrial(admin: ActingAdmin, id: string, days: number, reason: string) {
    const business = await this.requireAccount(id);
    const from =
      business.trialEndsAt && business.trialEndsAt.getTime() > Date.now()
        ? business.trialEndsAt
        : new Date();
    const trialEndsAt = new Date(from.getTime() + days * DAY_MS);

    await this.prisma.business.update({
      where: { id },
      data: { trialEndsAt, subscriptionStatus: SubscriptionStatus.TRIALING },
    });

    await this.record(admin, id, 'admin.account.trial', {
      reason,
      days,
      // ISO strings, because the column is JSON and a Date is not a JSON value.
      from: business.trialEndsAt?.toISOString() ?? null,
      to: trialEndsAt.toISOString(),
    });
    return { trialEndsAt };
  }

  // --- People --------------------------------------------------------------

  async users(params: { search?: string; role?: UserRole; active?: boolean; limit: number }) {
    const search = params.search?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(params.role ? { role: params.role } : {}),
      ...(params.active === undefined ? {} : { isActive: params.active }),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { business: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit,
        // Selected field by field rather than by exclusion, so a column added
        // to the user table later cannot leak here by default. passwordHash is
        // the one that matters.
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          business: { select: { id: true, name: true, deletedAt: true } },
        },
      }),
    ]);

    const admins = new Set(
      this.config
        .get<string>('PLATFORM_ADMIN_EMAILS', '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );

    return {
      total,
      shown: rows.length,
      users: rows.map((user) => ({
        ...user,
        business: { id: user.business.id, name: user.business.name },
        businessSuspended: user.business.deletedAt !== null,
        /** Flagged so the console can grey out actions that will be refused. */
        platformAdmin: admins.has(user.email.toLowerCase()),
      })),
    };
  }

  async setUserActive(admin: ActingAdmin, id: string, isActive: boolean, reason: string) {
    const user = await this.requireUser(id);
    this.assertNotSelf(admin, user.id);
    if (!isActive) this.assertNotPlatformAdmin(user.email);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive } });
      if (!isActive) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    await this.record(admin, user.businessId, 'admin.user.active', {
      reason,
      userId: id,
      email: user.email,
      from: user.isActive,
      to: isActive,
    });
    return { isActive };
  }

  /**
   * Changes what someone can do inside their own shop.
   *
   * Refuses to remove the last owner: a shop with no owner has nobody who can
   * invite staff, change the plan or delete anything, and the only way back is
   * an admin noticing and undoing it.
   */
  async setUserRole(admin: ActingAdmin, id: string, role: UserRole, reason: string) {
    const user = await this.requireUser(id);
    this.assertNotSelf(admin, user.id);
    this.assertNotPlatformAdmin(user.email);

    if (user.role === UserRole.OWNER && role !== UserRole.OWNER) {
      const owners = await this.prisma.user.count({
        where: {
          businessId: user.businessId,
          role: UserRole.OWNER,
          deletedAt: null,
          isActive: true,
        },
      });
      if (owners <= 1) {
        throw new BadRequestException(
          'That is the only owner of this shop. Make somebody else an owner first.',
        );
      }
    }

    await this.prisma.user.update({ where: { id }, data: { role } });
    await this.record(admin, user.businessId, 'admin.user.role', {
      reason,
      userId: id,
      email: user.email,
      from: user.role,
      to: role,
    });
    return { role };
  }

  /** Ends every session a person has, without changing anything else. The
   *  answer to "my phone was stolen" and to a support session left open. */
  async signOutUser(admin: ActingAdmin, id: string, reason: string) {
    const user = await this.requireUser(id);
    await this.auth.revokeAllSessions(id);
    await this.record(admin, user.businessId, 'admin.user.signout', {
      reason,
      userId: id,
      email: user.email,
    });
    return { signedOut: true };
  }

  // --- Money ---------------------------------------------------------------

  /** Subscription payments across every account, newest first. */
  async payments(params: { status?: PaymentStatus; search?: string; limit: number }) {
    const search = params.search?.trim();
    const rows = await this.prisma.billingTransaction.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(search
          ? {
              OR: [
                { reference: { contains: search, mode: 'insensitive' } },
                { providerRef: { contains: search, mode: 'insensitive' } },
                {
                  subscription: {
                    business: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      select: {
        id: true,
        plan: true,
        amount: true,
        currency: true,
        status: true,
        provider: true,
        reference: true,
        providerRef: true,
        createdAt: true,
        periodEnd: true,
        subscription: { select: { business: { select: { id: true, name: true } } } },
      },
    });

    return rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      business: row.subscription.business,
      subscription: undefined,
    }));
  }

  /**
   * Asks the payment provider again what happened to one payment.
   *
   * For the case where a customer's money left their wallet but the callback
   * never arrived — a webhook lost, an instance asleep, a network that dropped
   * at the wrong second. It re-verifies with the provider and settles if the
   * provider says it succeeded, so it can only ever confirm a real payment, not
   * invent one.
   */
  async recheckPayment(admin: ActingAdmin, reference: string) {
    const transaction = await this.prisma.billingTransaction.findUnique({
      where: { reference },
      select: { id: true, subscription: { select: { businessId: true } } },
    });
    if (!transaction) throw new NotFoundException('No payment with that reference.');

    const result = await this.billing.settleTransaction(reference);
    await this.record(admin, transaction.subscription.businessId, 'admin.payment.recheck', {
      reference,
      result: result as unknown as Prisma.JsonObject,
    });
    return result;
  }

  // --- The log itself ------------------------------------------------------

  /** What admins have done, across every account. */
  async auditTrail(limit: number) {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { startsWith: 'admin.' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        metadata: true,
        ip: true,
        createdAt: true,
        user: { select: { email: true, name: true } },
        business: { select: { id: true, name: true } },
      },
    });
    return rows;
  }

  // --- Guard rails ---------------------------------------------------------

  private async requireAccount(id: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        plan: true,
        deletedAt: true,
        trialEndsAt: true,
        users: { where: { deletedAt: null }, select: { id: true, email: true } },
      },
    });
    if (!business) throw new NotFoundException('No such account.');
    return business;
  }

  private async requireUser(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, email: true, role: true, isActive: true, businessId: true },
    });
    if (!user) throw new NotFoundException('No such person.');
    return user;
  }

  /** An admin acting on their own account can lock themselves out of the very
   *  console they would need to undo it. */
  private assertNotSelf(admin: ActingAdmin, userId: string): void {
    if (admin.id === userId) {
      throw new ForbiddenException('You cannot do that to your own account.');
    }
  }

  private assertNotPlatformAdmin(email: string): void {
    if (isPlatformAdmin(this.config, email)) {
      throw new ForbiddenException(
        'That account belongs to a platform admin. Change PLATFORM_ADMIN_EMAILS first.',
      );
    }
  }

  /** Suspending the shop an admin belongs to would lock them out sideways —
   *  their user survives, but every request they make is refused. */
  private async assertNoPlatformAdminInside(businessId: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { businessId, deletedAt: null },
      select: { email: true },
    });
    for (const user of users) {
      if (isPlatformAdmin(this.config, user.email)) {
        throw new ForbiddenException(
          'A platform admin belongs to that account, so suspending it would lock them out.',
        );
      }
    }
  }

  /**
   * One audit row per change.
   *
   * Written against the affected business, not the admin's own, so the history
   * shows up on the account it happened to — which is where anyone looking into
   * a complaint will start.
   */
  private async record(
    admin: ActingAdmin,
    businessId: string,
    action: string,
    metadata: Prisma.JsonObject,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        businessId,
        userId: admin.id,
        action,
        entityType: 'platform',
        entityId: businessId,
        ip: admin.ip,
        metadata: { ...metadata, adminEmail: admin.email },
      },
    });
  }
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
