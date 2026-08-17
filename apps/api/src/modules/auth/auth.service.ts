import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus, UserRole, type User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { TRIAL_DAYS } from '@bizpilot/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { isPlatformAdmin } from '../admin/platform-admin.guard';
import type { ChangePasswordDto, InviteUserDto, LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

/**
 * Shown when the whole shop is suspended rather than one person's login.
 *
 * Says who to talk to, because the shopkeeper cannot fix this themselves and a
 * bare "not active" sends them hunting through their own settings for a switch
 * that is not there.
 */
const SUSPENDED_MESSAGE =
  'This shop has been suspended. Please contact BizPilot support to restore it.';

interface SessionContext {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Signing up creates the whole tenant: the business, its first location, the
   * owner account and a trialing subscription. All in one transaction — a
   * half-created business would be worse than a failed signup.
   */
  async register(dto: RegisterDto, ctx: SessionContext) {
    const email = normaliseEmail(dto.email);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists. Try logging in.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const { user } = await this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: dto.businessName,
          type: dto.businessType ?? 'SHOP',
          currency: (dto.currency ?? 'RWF').toUpperCase(),
          country: (dto.country ?? 'RW').toUpperCase(),
          phone: dto.phone,
          email,
          subscriptionStatus: SubscriptionStatus.TRIALING,
          trialEndsAt,
          locations: {
            create: { name: 'Main', isDefault: true },
          },
          subscription: {
            create: {
              plan: 'free',
              status: SubscriptionStatus.TRIALING,
            },
          },
        },
      });

      const created = await tx.user.create({
        data: {
          businessId: business.id,
          email,
          name: dto.name,
          passwordHash,
          phone: dto.phone,
          role: UserRole.OWNER,
        },
      });

      return { user: created };
    });

    return this.issueSession(user, ctx);
  }

  async login(dto: LoginDto, ctx: SessionContext) {
    const email = normaliseEmail(dto.email);
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { business: { select: { deletedAt: true } } },
    });

    // Compare against a dummy hash when the user is missing so the response
    // time does not reveal which emails are registered.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const matches = await bcrypt.compare(dto.password, hash);

    if (!user || !matches) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('This account has been deactivated by the owner.');
    }
    // A suspended shop must not be able to sign in. Checking only the user left
    // suspension purely cosmetic: every member of a suspended business could
    // still log in and keep trading, because nothing on the user row changes
    // when the business is suspended.
    if (user.business.deletedAt) {
      throw new UnauthorizedException(SUSPENDED_MESSAGE);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueSession(user, ctx);
  }

  async refresh(refreshToken: string, ctx: SessionContext) {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { business: { select: { deletedAt: true } } } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Your session has expired. Please log in again.');
    }
    if (!stored.user.isActive || stored.user.deletedAt) {
      throw new UnauthorizedException('This account is no longer active.');
    }
    // Checked on refresh as well as login: access tokens live for fifteen
    // minutes, so without this a suspended shop keeps working until every one
    // of its sessions happens to expire.
    if (stored.user.business.deletedAt) {
      throw new UnauthorizedException(SUSPENDED_MESSAGE);
    }

    // Rotate: the presented token is burned as soon as it is exchanged, so a
    // stolen refresh token is usable at most once.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueSession(stored.user, ctx);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every session for a user — used when changing a password. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ success: true }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('Your current password is incorrect.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS) },
    });
    await this.revokeAllSessions(userId);

    return { success: true };
  }

  /** Owner/manager adds a staff account. Seats are capped by the plan. */
  async inviteUser(businessId: string, dto: InviteUserDto) {
    await this.entitlements.assertCanAddUser(businessId);

    const email = normaliseEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('That email is already used by another account.');
    }
    if (dto.role === UserRole.OWNER) {
      throw new BadRequestException('A business can only have one owner.');
    }

    const user = await this.prisma.user.create({
      data: {
        businessId,
        email,
        name: dto.name,
        phone: dto.phone,
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });

    return user;
  }

  async session(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { business: true },
    });
    return this.serialiseSession(user, user.business);
  }

  // -------------------------------------------------------------------------

  private async issueSession(user: User, ctx: SessionContext) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: user.businessId },
    });

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        businessId: user.businessId,
        role: user.role,
      },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '15m'),
      },
    );

    // Refresh tokens are opaque random strings, not JWTs — they are only ever
    // checked against the database, so there is nothing to forge.
    const refreshToken = randomBytes(48).toString('hex');
    const ttlDays = parseDays(this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'));

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
        userAgent: ctx.userAgent?.slice(0, 250),
        ip: ctx.ip,
      },
    });

    return {
      accessToken,
      refreshToken,
      ...this.serialiseSession(user, business),
    };
  }

  private serialiseSession(
    user: Pick<User, 'id' | 'email' | 'name' | 'role' | 'businessId'>,
    business: {
      id: string;
      name: string;
      type: string;
      currency: string;
      country: string;
      plan: string;
      trialEndsAt: Date | null;
      subscriptionStatus: SubscriptionStatus;
      logoUrl: string | null;
    },
  ) {
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: user.businessId,
        // Only decides whether the web app renders the platform nav item. The
        // API re-checks the allow-list on every /admin request, so editing this
        // in the browser reveals a menu entry and nothing behind it.
        isPlatformAdmin: isPlatformAdmin(this.config, user.email),
      },
      business: {
        id: business.id,
        name: business.name,
        type: business.type,
        currency: business.currency,
        country: business.country,
        plan: business.plan,
        logoUrl: business.logoUrl,
        trialEndsAt: business.trialEndsAt,
        subscriptionStatus: business.subscriptionStatus,
      },
    };
  }
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Accepts "30d", "12h" or a bare number of days. */
function parseDays(value: string): number {
  const match = /^(\d+)([dh])?$/.exec(value.trim());
  if (!match) return 30;
  const amount = Number(match[1]);
  return match[2] === 'h' ? amount / 24 : amount;
}
