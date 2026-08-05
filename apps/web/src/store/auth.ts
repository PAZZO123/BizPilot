import { create } from 'zustand';
import { api, tokenStore } from '../lib/api';

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  businessId: string;
  /** Set from the server's PLATFORM_ADMIN_EMAILS allow-list. Controls whether
   *  the platform nav item renders — never whether the data is served. */
  isPlatformAdmin?: boolean;
}

export interface AuthBusiness {
  id: string;
  name: string;
  type: string;
  currency: string;
  country: string;
  plan: string;
  logoUrl: string | null;
  trialEndsAt: string | null;
  subscriptionStatus: string;
}

interface AuthState {
  user: AuthUser | null;
  business: AuthBusiness | null;
  /** Undefined until the first session check finishes — distinct from "logged out". */
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  setBusiness: (business: Partial<AuthBusiness>) => void;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  businessName: string;
  businessType?: string;
  phone?: string;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  business: null,
  status: 'loading',

  async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.accessToken, data.refreshToken);
    set({ user: data.user, business: data.business, status: 'authenticated' });
  },

  async register(payload) {
    const { data } = await api.post('/auth/register', payload);
    tokenStore.set(data.accessToken, data.refreshToken);
    set({ user: data.user, business: data.business, status: 'authenticated' });
  },

  async logout() {
    const refreshToken = tokenStore.refresh;
    // Best effort: the local session is cleared whether or not the server hears
    // about it, so a network failure cannot trap someone in a session.
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    tokenStore.clear();
    set({ user: null, business: null, status: 'anonymous' });
  },

  async restore() {
    if (!tokenStore.access) {
      set({ status: 'anonymous' });
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, business: data.business, status: 'authenticated' });
    } catch {
      tokenStore.clear();
      set({ user: null, business: null, status: 'anonymous' });
    }
  },

  setBusiness(patch) {
    const current = get().business;
    if (current) set({ business: { ...current, ...patch } });
  },
}));

/** Owner can do anything; manager everything except owner-only settings. */
export function canManage(role: UserRole | undefined): boolean {
  return role === 'OWNER' || role === 'MANAGER';
}

export function isOwner(role: UserRole | undefined): boolean {
  return role === 'OWNER';
}
