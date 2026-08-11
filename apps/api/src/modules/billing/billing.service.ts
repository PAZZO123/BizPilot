import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  PlanId as PrismaPlanId,
  SaleStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PLANS, toGatewayAmount, type PlanId } from '@bizpilot/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type VerifiedPayment,
} from './payment-provider';

/** How long a business keeps paid access after a failed renewal. */
const GRACE_PERIOD_DAYS = 5;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    private readonly entitlements: EntitlementsService,
  ) {}

  // --- Subscriptions -------------------------------------------------------

  /**
   * Starts an upgrade. Creates a PENDING transaction first so the webhook has
   * something to match against even if the owner closes the tab mid-payment.
   */
  async startSubscriptionCheckout(businessId: string, userId: string, plan: PlanId) {
    if (plan === 'free') {
      throw new BadRequestException('The Free plan does not need a payment.');
    }

    const [business, user] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { id: true, name: true, currency: true, country: true, email: true, phone: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, name: true, phone: true },
      }),
    ]);

    const definition = PLANS[plan];
    // Rwandan businesses are billed in francs; everyone else in dollars, since
    // that is what a foreign card will actually clear.
    const useLocal = business.currency === 'RWF';
    const currency = useLocal ? 'RWF' : 'USD';
    const amountMinor = BigInt(
      Math.round((useLocal ? definition.priceRwf : definition.priceUsd) * 100),
    );

    const subscription = await this.prisma.subscription.upsert({
      where: { businessId },
      create: { businessId, plan: 'free', status: SubscriptionStatus.TRIALING },
      update: {},
    });

    const reference = this.payments.buildReference('bp-sub');

    await this.prisma.billingTransaction.create({
      data: {
        subscriptionId: subscription.id,
        plan: plan as PrismaPlanId,
        amount: amountMinor,
        currency,
        status: PaymentStatus.PENDING,
        reference,
      },
    });

    const checkout = await this.payments.createCheckout({
      reference,
      amount: toGatewayAmount(Number(amountMinor), currency),
      currency,
      returnUrl: `${this.config.get<string>('WEB_URL')}/billing/callback`,
      customer: {
        email: user.email,
        name: user.name,
        phone: user.phone ?? business.phone ?? undefined,
      },
      title: 'BizPilot subscription',
      description: `${definition.name} plan — ${business.name}`,
      meta: { kind: 'subscription', businessId, plan },
    });

    // `checkout` is a union: a redirect carries a url, a push carries the number
    // it was sent to. The caller has to look at `kind` — which is the point.
    return { checkout, reference, amount: Number(amountMinor), currency };
  }

  /** Current subscription, plan limits and payment history. */
  async overview(businessId: string) {
    const [entitlements, subscription] = await Promise.all([
      this.entitlements.summary(businessId),
      this.prisma.subscription.findUnique({
        where: { businessId },
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 24,
            select: {
              id: true,
              plan: true,
              amount: true,
              currency: true,
              status: true,
              periodStart: true,
              periodEnd: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    return {
      ...entitlements,
      subscription,
      paymentsConfigured: this.payments.isConfigured,
      // The screen needs both: which channels to advertise, and whether to
      // expect a redirect or a phone prompt.
      paymentProvider: this.payments.name,
      paymentChannels: this.payments.channels,
    };
  }

  /**
   * Cancels at the end of the paid period rather than immediately — they paid
   * for the month, they keep the month.
   */
  async cancelSubscription(businessId: string) {
    const subscription = await this.prisma.subscription.findUnique({ where: { businessId } });
    if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('There is no active subscription to cancel.');
    }

    const updated = await this.prisma.subscription.update({
      where: { businessId },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    });

    return {
      subscription: updated,
      message: updated.currentPeriodEnd
        ? `Your plan stays active until ${updated.currentPeriodEnd.toISOString().slice(0, 10)}.`
        : 'Your plan has been cancelled.',
    };
  }

  async resumeSubscription(businessId: string) {
    const subscription = await this.prisma.subscription.findUnique({ where: { businessId } });
    if (!subscription?.cancelAtPeriodEnd) {
      throw new BadRequestException('This subscription is not scheduled to end.');
    }

    return this.prisma.subscription.update({
      where: { businessId },
      data: { cancelAtPeriodEnd: false, cancelledAt: null },
    });
  }

  // --- Customer payments on invoices ---------------------------------------

  /**
   * Creates a checkout for a customer paying one of the business's invoices.
   * Reached from the public link, so it takes a token rather than an id and
   * never exposes anything but the amount owed.
   */
  async startInvoiceCheckout(token: string, payer: { email: string; name?: string; phone?: string }) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { publicToken: token },
      include: {
        business: { select: { id: true, name: true, currency: true, logoUrl: true } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    if (!invoice || invoice.status === InvoiceStatus.CANCELLED) {
      throw new NotFoundException('This invoice link is not valid.');
    }

    await this.entitlements.assertFeature(invoice.businessId, 'onlinePayments');

    const balanceDue = invoice.total - invoice.amountPaid;
    if (balanceDue <= 0n) {
      throw new BadRequestException('This invoice is already paid in full.');
    }

    const reference = this.payments.buildReference('bp-inv');

    await this.prisma.payment.create({
      data: {
        businessId: invoice.businessId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: balanceDue,
        currency: invoice.business.currency,
        method: PaymentMethod.MOMO,
        status: PaymentStatus.PENDING,
        // Whoever is actually taking the money — reconciling a MoMo payment
        // against a row labelled "flutterwave" is a bad afternoon.
        provider: this.payments.name,
        reference,
      },
    });

    const checkout = await this.payments.createCheckout({
      reference,
      amount: toGatewayAmount(Number(balanceDue), invoice.business.currency),
      currency: invoice.business.currency,
      returnUrl: `${this.config.get<string>('WEB_URL')}/pay/${token}/callback`,
      customer: {
        email: payer.email || invoice.customer?.email || 'customer@bizpilot.app',
        name: payer.name ?? invoice.customer?.name,
        phone: payer.phone ?? invoice.customer?.phone ?? undefined,
      },
      title: invoice.business.name,
      description: `Invoice ${invoice.number}`,
      logoUrl: invoice.business.logoUrl ?? undefined,
      meta: { kind: 'invoice', invoiceId: invoice.id, businessId: invoice.businessId },
    });

    return { checkout, reference, amount: Number(balanceDue) };
  }

  // --- Settlement ----------------------------------------------------------

  /**
   * The single place a payment is confirmed, whether the news arrives by
   * webhook or by the browser coming back from the checkout page.
   *
   * Both paths verify with Flutterwave and both are idempotent, so a webhook
   * that arrives twice — or races the redirect — cannot double-credit anything.
   */
  async settleTransaction(transactionId: string | number) {
    const verified = await this.payments.verifyPayment(String(transactionId));

    if (verified.status !== 'successful') {
      await this.markFailed(verified.reference);
      return { settled: false, reason: `Payment ${verified.status}` };
    }

    const kind = String(verified.meta?.kind ?? '') || (await this.resolveKind(verified.reference));
    if (kind === 'subscription') {
      return this.settleSubscription(verified);
    }
    if (kind === 'invoice') {
      return this.settleInvoicePayment(verified);
    }

    this.logger.warn(`Transaction ${verified.reference} has no recognised kind; ignoring.`);
    return { settled: false, reason: 'Unrecognised payment type' };
  }

  /**
   * Works out what a payment was for when the provider does not hand our
   * metadata back.
   *
   * Flutterwave echoes `meta` on verification, so the kind rides along with the
   * payment. MTN has nowhere to put it — Request to Pay carries an amount, a
   * phone number and two short strings shown on the handset, and none of them
   * survive as structured data. Reading `meta.kind` and giving up when it is
   * missing meant no MoMo payment could ever settle: money would leave the
   * payer's wallet and the plan would stay unpaid.
   *
   * So fall back to the one thing every provider does preserve — our own
   * reference — and ask our own database what we created it for. A subscription
   * attempt writes a billingTransaction; an invoice payment writes a payment.
   * Both are keyed by reference, so exactly one of them can match.
   */
  private async resolveKind(reference: string): Promise<'subscription' | 'invoice' | ''> {
    const [subscriptionAttempt, invoiceAttempt] = await Promise.all([
      this.prisma.billingTransaction.findUnique({ where: { reference }, select: { id: true } }),
      this.prisma.payment.findUnique({ where: { reference }, select: { id: true } }),
    ]);

    if (subscriptionAttempt) return 'subscription';
    if (invoiceAttempt) return 'invoice';
    return '';
  }

  private async settleSubscription(verified: VerifiedPayment) {
    const { reference, providerRef, raw } = verified;

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.billingTransaction.findUnique({
        where: { reference },
        include: { subscription: true },
      });
      if (!transaction) {
        this.logger.warn(`No billing transaction for reference ${reference}`);
        return { settled: false, reason: 'Unknown reference' };
      }
      // Already processed — a duplicate webhook, or the redirect beat it here.
      if (transaction.status === PaymentStatus.SUCCESSFUL) {
        return { settled: true, alreadyProcessed: true };
      }

      // A successful payment is not the same as the *right* payment. Without
      // this, anything the gateway calls successful upgrades the plan — pay 100
      // francs, get the 20,000-franc tier. Compare against what we asked for.
      const mismatch = this.checkAmount(verified, transaction.amount, transaction.currency);
      if (mismatch) {
        this.logger.error(`Refusing to settle subscription ${reference}: ${mismatch}`);
        return { settled: false, reason: mismatch };
      }

      const periodStart = new Date();
      const periodEnd = addMonths(periodStart, 1);
      const plan = transaction.plan;

      await tx.billingTransaction.update({
        where: { id: transaction.id },
        data: {
          status: PaymentStatus.SUCCESSFUL,
          providerRef,
          providerMeta: raw as object,
          periodStart,
          periodEnd,
        },
      });

      await tx.subscription.update({
        where: { id: transaction.subscriptionId },
        data: {
          plan,
          status: SubscriptionStatus.ACTIVE,
          provider: 'flutterwave',
          providerRef,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
        },
      });

      // The business row carries the plan too, so every request can check
      // entitlements without joining the subscription table.
      await tx.business.update({
        where: { id: transaction.subscription.businessId },
        data: {
          plan,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          trialEndsAt: null,
        },
      });

      this.logger.log(
        `Business ${transaction.subscription.businessId} is now on the ${plan} plan.`,
      );
      return { settled: true, plan, periodEnd };
    });
  }

  private async settleInvoicePayment(verified: VerifiedPayment) {
    const { reference, providerRef, raw } = verified;

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { reference },
        include: { invoice: true },
      });
      if (!payment) {
        this.logger.warn(`No payment row for reference ${reference}`);
        return { settled: false, reason: 'Unknown reference' };
      }
      if (payment.status === PaymentStatus.SUCCESSFUL) {
        return { settled: true, alreadyProcessed: true };
      }

      // Everything below credits `payment.amount` — the figure we invoiced, not
      // the figure the gateway says arrived. If those disagree the shop would be
      // told a debt was cleared by money it never received, so stop and let a
      // human look rather than guess which number is right.
      const mismatch = this.checkAmount(verified, payment.amount, payment.currency);
      if (mismatch) {
        this.logger.error(`Refusing to settle invoice payment ${reference}: ${mismatch}`);
        return { settled: false, reason: mismatch };
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCESSFUL,
          providerRef,
          providerMeta: raw as object,
          paidAt: new Date(),
        },
      });

      if (payment.invoice) {
        const amountPaid = payment.invoice.amountPaid + payment.amount;
        const settled = amountPaid >= payment.invoice.total;

        await tx.invoice.update({
          where: { id: payment.invoice.id },
          data: {
            amountPaid,
            status: settled ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
            paidAt: settled ? new Date() : null,
          },
        });

        if (payment.customerId) {
          await tx.customer.update({
            where: { id: payment.customerId },
            data: { balance: { decrement: payment.amount } },
          });
        }

        // Keep the originating sale in step so the sales list stops showing
        // money that has now been collected.
        if (payment.invoice.saleId) {
          const sale = await tx.sale.update({
            where: { id: payment.invoice.saleId },
            data: { amountPaid: { increment: payment.amount } },
          });
          if (sale.amountPaid >= sale.total && sale.status === SaleStatus.PARTIAL) {
            await tx.sale.update({
              where: { id: sale.id },
              data: { status: SaleStatus.COMPLETED },
            });
          }
        }
      }

      return { settled: true, amount: Number(payment.amount) };
    });
  }

  /**
   * Confirms the payment that arrived is the payment we asked for.
   *
   * Flutterwave's verify endpoint tells us the amount and currency actually
   * charged. Checking `status === 'successful'` and stopping there is the
   * classic way to lose money: a successful payment of the wrong amount is
   * still a successful payment, and the gateway will happily report it.
   *
   * Returns a reason string when something is wrong, or null when it is safe to
   * credit. Overpayment is allowed through — the payer is out of pocket, not us,
   * and refusing would strand their money — but it is logged, because it should
   * not happen and usually means a price changed mid-checkout.
   */
  private checkAmount(
    verified: VerifiedPayment,
    expectedMinor: bigint,
    expectedCurrency: string,
  ): string | null {
    if (verified.currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
      // MTN's sandbox settles everything in EUR regardless of what was asked
      // for, so in sandbox a currency mismatch is expected and blocking on it
      // would make the whole flow untestable. `isSandbox` is false for every
      // production configuration, so this branch cannot run against real money.
      if (!this.payments.isSandbox) {
        return `expected ${expectedCurrency}, was paid ${verified.currency}`;
      }
      this.logger.warn(
        `Sandbox ${this.payments.name}: accepting ${verified.currency} for a ${expectedCurrency} charge.`,
      );
    }

    // Our side is minor units; the gateway's is major. Convert ours the same way
    // the checkout did, so rounding cannot make an exact payment look short.
    const expectedMajor = toGatewayAmount(Number(expectedMinor), expectedCurrency);
    // The adapter already resolves "what actually left the payer" to `amount`.
    const paidMajor = verified.amount;

    // A hair of tolerance for float representation, not for real shortfalls.
    if (paidMajor + 0.001 < expectedMajor) {
      return `expected ${expectedMajor} ${expectedCurrency}, was paid ${paidMajor}`;
    }
    if (paidMajor > expectedMajor + 0.001) {
      this.logger.warn(
        `Overpayment on ${verified.reference}: expected ${expectedMajor} ${expectedCurrency}, received ${paidMajor}. Crediting as paid.`,
      );
    }
    return null;
  }

  private async markFailed(reference: string): Promise<void> {
    await Promise.all([
      this.prisma.billingTransaction.updateMany({
        where: { reference, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      }),
      this.prisma.payment.updateMany({
        where: { reference, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      }),
    ]);
  }

  // --- Lifecycle -----------------------------------------------------------

  /**
   * Moves subscriptions through their end-of-period states once a day.
   *
   * Renewals are not charged automatically: Flutterwave tokenised billing needs
   * separate onboarding, and silently charging a card is worse than asking. A
   * business whose period ends is given a grace window, then dropped to Free —
   * their data is never touched, only their limits change.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'subscription-lifecycle' })
  async runSubscriptionLifecycle(): Promise<void> {
    const now = new Date();

    // 1. Trials that have run out.
    const expiredTrials = await this.prisma.business.updateMany({
      where: {
        subscriptionStatus: SubscriptionStatus.TRIALING,
        trialEndsAt: { lt: now },
      },
      data: { subscriptionStatus: SubscriptionStatus.EXPIRED, plan: 'free' },
    });

    // 2. Paid periods that have ended: cancelled ones stop, the rest get a
    //    grace window in which they keep working.
    const ended = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { lt: now },
      },
      select: { id: true, businessId: true, cancelAtPeriodEnd: true },
    });

    for (const subscription of ended) {
      const nextStatus = subscription.cancelAtPeriodEnd
        ? SubscriptionStatus.CANCELLED
        : SubscriptionStatus.PAST_DUE;

      await this.prisma.$transaction([
        this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: nextStatus },
        }),
        this.prisma.business.update({
          where: { id: subscription.businessId },
          data: {
            subscriptionStatus: nextStatus,
            ...(nextStatus === SubscriptionStatus.CANCELLED ? { plan: 'free' as const } : {}),
          },
        }),
      ]);
    }

    // 3. Grace period exhausted — down to Free.
    const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const lapsed = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        currentPeriodEnd: { lt: graceCutoff },
      },
      select: { id: true, businessId: true },
    });

    for (const subscription of lapsed) {
      await this.prisma.$transaction([
        this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SubscriptionStatus.EXPIRED },
        }),
        this.prisma.business.update({
          where: { id: subscription.businessId },
          data: { subscriptionStatus: SubscriptionStatus.EXPIRED, plan: 'free' },
        }),
      ]);
    }

    if (expiredTrials.count || ended.length || lapsed.length) {
      this.logger.log(
        `Subscription sweep: ${expiredTrials.count} trial(s) expired, ` +
          `${ended.length} period(s) ended, ${lapsed.length} lapsed to Free.`,
      );
    }
  }
}

/** Adds calendar months, clamping to the last valid day (31 Jan + 1 = 28 Feb). */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetDay = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() < targetDay) {
    result.setDate(0);
  }
  return result;
}
