import type { PlanId } from './plans';

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER';

export type BusinessType =
  | 'SHOP'
  | 'PHARMACY'
  | 'RESTAURANT'
  | 'HARDWARE'
  | 'SALON'
  | 'OTHER';

export type PaymentMethod = 'CASH' | 'MOMO' | 'CARD' | 'BANK' | 'CREDIT';

export type SaleStatus = 'COMPLETED' | 'PARTIAL' | 'VOIDED';

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'CANCELLED';

export type StockMovementType = 'PURCHASE' | 'SALE' | 'ADJUSTMENT' | 'RETURN' | 'DAMAGE';

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  businessId: string;
}

export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  business: {
    id: string;
    name: string;
    type: BusinessType;
    currency: string;
    plan: PlanId;
    trialEndsAt: string | null;
    subscriptionStatus: SubscriptionStatus;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardSummary {
  currency: string;
  today: PeriodTotals;
  thisMonth: PeriodTotals;
  /** Products at or below their reorder level. */
  lowStockCount: number;
  /** Invoices past their due date and not fully paid. */
  overdueInvoiceCount: number;
  overdueInvoiceTotal: number;
  /** Revenue for the last 30 days, oldest first. */
  revenueTrend: { date: string; revenue: number; profit: number }[];
  topProducts: { productId: string; name: string; unitsSold: number; revenue: number }[];
}

export interface PeriodTotals {
  revenue: number;
  cost: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  salesCount: number;
}
