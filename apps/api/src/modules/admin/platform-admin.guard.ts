import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RequestUser } from '../../common/decorators';

/**
 * Gate for the platform dashboard — BizPilot's own books, not a shop's.
 *
 * The allow-list comes from `PLATFORM_ADMIN_EMAILS` rather than a column on the
 * user table. Anyone who can read this data can see every customer's turnover,
 * so the decision of who that is belongs in the deploy environment, where
 * changing it requires access to the host. A compromised owner account cannot
 * escalate into it, and there is no in-product screen that could be tricked
 * into granting it.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user) return false;

    if (!isPlatformAdmin(this.config, user.email)) {
      // Deliberately the same message a shop owner would get for any other
      // forbidden route: no hint that a platform dashboard exists at all.
      throw new ForbiddenException('Your role does not allow this action.');
    }
    return true;
  }
}

export function platformAdminEmails(config: ConfigService): string[] {
  return config
    .get<string>('PLATFORM_ADMIN_EMAILS', '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(config: ConfigService, email: string): boolean {
  const allowed = platformAdminEmails(config);
  // An empty list means nobody, not everybody. Forgetting to set the variable
  // must fail closed.
  if (!allowed.length) return false;
  return allowed.includes(email.trim().toLowerCase());
}
