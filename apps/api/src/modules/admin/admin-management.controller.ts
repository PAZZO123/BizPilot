import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaymentStatus, SubscriptionStatus, UserRole, type PlanId as PrismaPlanId } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PLAN_ORDER, type PlanId } from '@bizpilot/shared';
import { CurrentUser, type RequestUser } from '../../common/decorators';
import { AdminManagementService } from './admin-management.service';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * Why every one of these takes a reason.
 *
 * These actions are invisible to the person they happen to: a shopkeeper whose
 * account is suspended sees only that they cannot log in. Six months later the
 * only record of why will be this field, so it is required and has a floor on
 * its length — "x" is not a reason. It is the difference between an audit log
 * and a list of timestamps.
 */
class ReasonDto {
  @ApiProperty({ example: 'Chargeback fraud reported by MTN', minLength: 4 })
  @IsString()
  @Length(4, 300)
  reason!: string;
}

export class SuspendAccountDto extends ReasonDto {}

export class SetPlanDto extends ReasonDto {
  @ApiProperty({ enum: PLAN_ORDER, example: 'starter' })
  @IsIn(PLAN_ORDER)
  plan!: PlanId;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;
}

export class ExtendTrialDto extends ReasonDto {
  @ApiProperty({ minimum: 1, maximum: 90 })
  @IsInt()
  @Min(1)
  @Max(90)
  days!: number;
}

export class SetUserActiveDto extends ReasonDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class SetUserRoleDto extends ReasonDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;
}

/**
 * The half of the platform console that changes things.
 *
 * Guarded at the class level like its read-only sibling, and throttled harder
 * than the rest of the API: nothing here is a hot path, and a script hammering
 * these endpoints is not a customer having a busy morning.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('admin')
export class AdminManagementController {
  constructor(private readonly admin: AdminManagementService) {}

  // --- Accounts ------------------------------------------------------------

  @Get('accounts')
  @ApiOperation({ summary: 'Search every account' })
  accounts(
    @Query('search') search?: string,
    @Query('status') status?: SubscriptionStatus,
    @Query('plan') plan?: PrismaPlanId,
    @Query('suspended') suspended?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.accounts({
      search,
      status: enumOrUndefined(SubscriptionStatus, status),
      plan: plan && PLAN_ORDER.includes(plan as PlanId) ? plan : undefined,
      suspended: booleanOrUndefined(suspended),
      limit: clamp(limit, 50, 1, 200),
    });
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: 'Everything about one account' })
  account(@Param('id') id: string) {
    return this.admin.account(id);
  }

  @Post('accounts/:id/suspend')
  @ApiOperation({ summary: 'Lock an account out and end its sessions' })
  suspend(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body() dto: SuspendAccountDto,
  ) {
    return this.admin.suspendAccount(acting(user, ip), id, dto.reason);
  }

  @Post('accounts/:id/restore')
  @ApiOperation({ summary: 'Undo a suspension' })
  restore(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body() dto: SuspendAccountDto,
  ) {
    return this.admin.restoreAccount(acting(user, ip), id, dto.reason);
  }

  @Post('accounts/:id/plan')
  @ApiOperation({ summary: 'Put an account on a plan without charging for it' })
  setPlan(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body() dto: SetPlanDto,
  ) {
    return this.admin.setPlan(acting(user, ip), id, dto.plan, dto.months ?? 1, dto.reason);
  }

  @Post('accounts/:id/trial')
  @ApiOperation({ summary: 'Give a trial more days' })
  extendTrial(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body() dto: ExtendTrialDto,
  ) {
    return this.admin.extendTrial(acting(user, ip), id, dto.days, dto.reason);
  }

  // --- People --------------------------------------------------------------

  @Get('users')
  @ApiOperation({ summary: 'Search everyone, across every account' })
  users(
    @Query('search') search?: string,
    @Query('role') role?: UserRole,
    @Query('active') active?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.users({
      search,
      role: enumOrUndefined(UserRole, role),
      active: booleanOrUndefined(active),
      limit: clamp(limit, 50, 1, 200),
    });
  }

  @Post('users/:id/active')
  @ApiOperation({ summary: 'Deactivate or reactivate somebody' })
  setUserActive(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body() dto: SetUserActiveDto,
  ) {
    return this.admin.setUserActive(acting(user, ip), id, dto.isActive, dto.reason);
  }

  @Post('users/:id/role')
  @ApiOperation({ summary: 'Change what somebody can do in their shop' })
  setUserRole(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body() dto: SetUserRoleDto,
  ) {
    return this.admin.setUserRole(acting(user, ip), id, dto.role, dto.reason);
  }

  @Post('users/:id/sign-out')
  @ApiOperation({ summary: 'End every session this person has' })
  signOut(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.signOutUser(acting(user, ip), id, dto.reason);
  }

  // --- Money and history ---------------------------------------------------

  @Get('payments')
  @ApiOperation({ summary: 'Subscription payments across every account' })
  payments(
    @Query('status') status?: PaymentStatus,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.payments({
      status: enumOrUndefined(PaymentStatus, status),
      search,
      limit: clamp(limit, 50, 1, 200),
    });
  }

  @Post('payments/:reference/recheck')
  @ApiOperation({ summary: 'Ask the provider again what happened to a payment' })
  recheck(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
    @Param('reference') reference: string,
  ) {
    return this.admin.recheckPayment(acting(user, ip), reference);
  }

  @Get('audit')
  @ApiOperation({ summary: 'What admins have done' })
  audit(@Query('limit') limit?: string) {
    return this.admin.auditTrail(clamp(limit, 100, 1, 500));
  }
}

function acting(user: RequestUser, ip: string) {
  return { id: user.id, email: user.email, ip };
}

/** Query strings arrive as text; anything that is not a real member of the enum
 *  is dropped rather than passed to Prisma, where it would throw. */
function enumOrUndefined<T extends Record<string, string>>(
  values: T,
  raw: string | undefined,
): T[keyof T] | undefined {
  if (!raw) return undefined;
  return Object.values(values).includes(raw) ? (raw as T[keyof T]) : undefined;
}

/** Three states, not two: absent means "do not filter", which is different from
 *  filtering on false. */
function booleanOrUndefined(raw: string | undefined): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function clamp(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
