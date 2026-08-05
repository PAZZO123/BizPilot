import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { PlanId } from '@bizpilot/shared';

export interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  businessId: string;
}

/** Marks a route as reachable without a JWT (login, webhooks, public invoices). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the listed roles. OWNER always passes. */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Requires the caller's business to be on `plan` or higher. */
export const REQUIRES_PLAN_KEY = 'requiresPlan';
export const RequiresPlan = (plan: PlanId) => SetMetadata(REQUIRES_PLAN_KEY, plan);

/** Injects the authenticated user, or one of its fields. */
export const CurrentUser = createParamDecorator(
  (field: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);

/** Shorthand for the tenant id, which nearly every service method needs. */
export const BusinessId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
  return request.user?.businessId;
});
