import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type {
  CreateLocationDto,
  UpdateBusinessDto,
  UpdateLocationDto,
  UpdateUserDto,
} from './dto/business.dto';

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  profile(businessId: string) {
    return this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        country: true,
        timezone: true,
        phone: true,
        email: true,
        address: true,
        logoUrl: true,
        taxId: true,
        defaultTaxBps: true,
        invoicePrefix: true,
        receiptPrefix: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true,
      },
    });
  }

  async update(businessId: string, dto: UpdateBusinessDto) {
    // Changing currency after money has been recorded would silently reprice
    // history: a 5,000 RWF sale would start reading as $50.
    if (dto.currency) {
      const salesCount = await this.prisma.sale.count({ where: { businessId } });
      if (salesCount > 0) {
        const current = await this.prisma.business.findUniqueOrThrow({
          where: { id: businessId },
          select: { currency: true },
        });
        if (current.currency !== dto.currency.toUpperCase()) {
          throw new BadRequestException(
            'Currency cannot be changed once sales have been recorded. Contact support if this is wrong.',
          );
        }
      }
    }

    return this.prisma.business.update({
      where: { id: businessId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency.toUpperCase() } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.toLowerCase() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address || null } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl || null } : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId || null } : {}),
        ...(dto.defaultTaxBps !== undefined ? { defaultTaxBps: dto.defaultTaxBps } : {}),
        ...(dto.invoicePrefix !== undefined
          ? { invoicePrefix: dto.invoicePrefix.toUpperCase() }
          : {}),
        ...(dto.receiptPrefix !== undefined
          ? { receiptPrefix: dto.receiptPrefix.toUpperCase() }
          : {}),
      },
    });
  }

  // --- Staff ---------------------------------------------------------------

  listUsers(businessId: string) {
    return this.prisma.user.findMany({
      where: { businessId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async updateUser(businessId: string, actorId: string, userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found.');

    if (user.role === UserRole.OWNER && (dto.role !== undefined || dto.isActive === false)) {
      throw new ForbiddenException('The owner account cannot be demoted or deactivated.');
    }
    if (dto.role === UserRole.OWNER) {
      throw new BadRequestException('A business can only have one owner.');
    }
    // Locking yourself out is always a mistake, never an intent.
    if (userId === actorId && dto.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
      },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
  }

  async removeUser(businessId: string, actorId: string, userId: string) {
    if (userId === actorId) {
      throw new BadRequestException('You cannot remove your own account.');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role === UserRole.OWNER) {
      throw new ForbiddenException('The owner account cannot be removed.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), isActive: false },
    });
    // Any session they still hold dies with the account.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  // --- Locations -----------------------------------------------------------

  listLocations(businessId: string) {
    return this.prisma.location.findMany({
      where: { businessId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createLocation(businessId: string, dto: CreateLocationDto) {
    // A second branch is what the Business plan is for.
    const existing = await this.prisma.location.count({
      where: { businessId, deletedAt: null },
    });
    if (existing >= 1) {
      await this.entitlements.assertFeature(businessId, 'multiLocation');
    }

    return this.prisma.location.create({
      data: {
        businessId,
        name: dto.name.trim(),
        address: dto.address?.trim() || null,
        phone: dto.phone?.trim() || null,
        isDefault: existing === 0,
      },
    });
  }

  async updateLocation(businessId: string, id: string, dto: UpdateLocationDto) {
    const location = await this.prisma.location.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found.');

    return this.prisma.location.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.address !== undefined ? { address: dto.address || null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
      },
    });
  }

  async removeLocation(businessId: string, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found.');
    if (location.isDefault) {
      throw new BadRequestException('The main location cannot be removed.');
    }

    await this.prisma.location.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }
}
