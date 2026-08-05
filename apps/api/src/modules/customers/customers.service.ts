import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paginated } from '../../common/dto/pagination.dto';
import type {
  CreateCustomerDto,
  QueryCustomersDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  create(businessId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        businessId,
        name: dto.name.trim(),
        phone: normalisePhone(dto.phone),
        email: dto.email?.trim().toLowerCase() || null,
        address: dto.address?.trim() || null,
        note: dto.note?.trim() || null,
      },
    });
  }

  async findAll(businessId: string, query: QueryCustomersDto) {
    const where: Prisma.CustomerWhereInput = {
      businessId,
      deletedAt: null,
      ...(query.owingOnly ? { balance: { gt: 0 } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: query.owingOnly ? { balance: 'desc' } : { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginated(items, total, query);
  }

  async findOne(businessId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    return customer;
  }

  async update(businessId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(businessId, id);
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: normalisePhone(dto.phone) } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.trim().toLowerCase() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
      },
    });
  }

  async remove(businessId: string, id: string) {
    await this.findOne(businessId, id);
    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  /** Everything owed and everything bought, for the customer detail screen. */
  async statement(businessId: string, id: string) {
    const customer = await this.findOne(businessId, id);

    const [sales, invoices, payments] = await Promise.all([
      this.prisma.sale.findMany({
        where: { businessId, customerId: id },
        orderBy: { soldAt: 'desc' },
        take: 50,
        select: {
          id: true,
          number: true,
          total: true,
          amountPaid: true,
          status: true,
          soldAt: true,
          paymentMethod: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: { businessId, customerId: id },
        orderBy: { issueDate: 'desc' },
        take: 50,
        select: {
          id: true,
          number: true,
          total: true,
          amountPaid: true,
          status: true,
          issueDate: true,
          dueDate: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { businessId, customerId: id },
        orderBy: { paidAt: 'desc' },
        take: 50,
        select: { id: true, amount: true, method: true, paidAt: true, reference: true },
      }),
    ]);

    const lifetimeValue = sales.reduce((total, sale) => total + sale.total, 0n);

    return { customer, sales, invoices, payments, lifetimeValue };
  }
}

/**
 * Stores phone numbers in a consistent shape so SMS lookups and duplicate
 * checks work. Rwandan local numbers (07xxxxxxxx) get the +250 country code;
 * anything already in international form is left alone.
 */
function normalisePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.replace(/[\s-()]/g, '');
  if (!trimmed) return null;
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('07') && trimmed.length === 10) return `+25${trimmed}`;
  if (trimmed.startsWith('250')) return `+${trimmed}`;
  return trimmed;
}
