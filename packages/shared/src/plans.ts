/**
 * Plan catalogue. This is the single source of truth for what each tier costs
 * and what it unlocks — the API enforces the limits and the web app renders
 * the pricing page from the same object.
 *
 * Prices are in RWF (Rwandan franc) with a USD reference. Flutterwave charges
 * in the currency you specify at checkout; we bill local customers in RWF and
 * anyone else in USD.
 */

export type PlanId = 'free' | 'starter' | 'business';

export interface PlanLimits {
  /** Max products in the catalogue. null = unlimited. */
  products: number | null;
  /** Max sales recordable per calendar month. null = unlimited. */
  salesPerMonth: number | null;
  /** Max staff accounts (including the owner). */
  users: number;
  /** SMS credits included each month. */
  smsPerMonth: number;
  /** AI assistant messages per month. 0 disables the feature. */
  aiMessagesPerMonth: number;
}

export interface PlanFeatures {
  invoicePdf: boolean;
  removeBranding: boolean;
  onlinePayments: boolean;
  multiLocation: boolean;
  dataExport: boolean;
  prioritySupport: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in RWF. */
  priceRwf: number;
  /** Monthly price in USD, for non-Rwandan customers. */
  priceUsd: number;
  limits: PlanLimits;
  features: PlanFeatures;
  /** Bullet points shown on the pricing page. */
  highlights: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Replace the notebook. No card needed.',
    priceRwf: 0,
    priceUsd: 0,
    limits: {
      products: 30,
      salesPerMonth: 100,
      users: 1,
      smsPerMonth: 0,
      aiMessagesPerMonth: 15,
    },
    features: {
      invoicePdf: true,
      removeBranding: false,
      onlinePayments: false,
      multiLocation: false,
      dataExport: false,
      prioritySupport: false,
    },
    highlights: [
      'Up to 30 products',
      '100 sales per month',
      'Invoices with BizPilot branding',
      '15 AI questions per month',
      '1 user',
    ],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'For a growing shop with staff.',
    priceRwf: 7000,
    priceUsd: 6,
    limits: {
      products: 500,
      salesPerMonth: null,
      users: 3,
      smsPerMonth: 100,
      aiMessagesPerMonth: 300,
    },
    features: {
      invoicePdf: true,
      removeBranding: true,
      onlinePayments: true,
      multiLocation: false,
      dataExport: true,
      prioritySupport: false,
    },
    highlights: [
      'Up to 500 products',
      'Unlimited sales',
      '3 staff accounts',
      '100 SMS reminders per month',
      'Accept MoMo & card payments',
      'Your logo on invoices',
      'Export to Excel',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    tagline: 'Multiple branches, full AI, priority support.',
    priceRwf: 20000,
    priceUsd: 17,
    limits: {
      products: null,
      salesPerMonth: null,
      users: 15,
      smsPerMonth: 500,
      aiMessagesPerMonth: 2000,
    },
    features: {
      invoicePdf: true,
      removeBranding: true,
      onlinePayments: true,
      multiLocation: true,
      dataExport: true,
      prioritySupport: true,
    },
    highlights: [
      'Unlimited products & sales',
      '15 staff accounts',
      '500 SMS reminders per month',
      'Multiple branches',
      'Unlimited practical AI usage',
      'Priority WhatsApp support',
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'business'];

/** Length of the automatic trial granted at signup. */
export const TRIAL_DAYS = 14;

/** During the trial every business gets Starter-level access. */
export const TRIAL_PLAN: PlanId = 'starter';

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

/** True when `candidate` is the same tier or higher than `required`. */
export function planAtLeast(candidate: PlanId, required: PlanId): boolean {
  return PLAN_ORDER.indexOf(candidate) >= PLAN_ORDER.indexOf(required);
}
