import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paginated } from '../../common/dto/pagination.dto';
import { dateRange } from '../sales/sales.service';
import { COMMON_EXPENSE_CATEGORIES } from './dto/expense.dto';
import type {
  CreateExpenseDto,
  QueryExpensesDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  create(businessId: string, userId: string, dto: CreateExpenseDto) {
    return this.prisma.expense.create({
      data: {
        businessId,
        userId,
        locationId: dto.locationId ?? null,
        category: dto.category.trim(),
        amount: BigInt(dto.amount),
        note: dto.note?.trim() || null,
        vendor: dto.vendor?.trim() || null,
        method: dto.method ?? 'CASH',
        receiptUrl: dto.receiptUrl || null,
        spentAt: dto.spentAt ? new Date(dto.spentAt) : new Date(),
      },
    });
  }

  async findAll(businessId: string, query: QueryExpensesDto) {
    const where: Prisma.ExpenseWhereInput = {
      businessId,
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...dateRange('spentAt', query.from, query.to),
      ...(query.search
        ? {
            OR: [
              { note: { contains: query.search, mode: 'insensitive' } },
              { vendor: { contains: query.search, mode: 'insensitive' } },
              { category: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total, totals] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: { spentAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        include: { user: { select: { id: true, name: true } } },
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      ...paginated(items, total, query),
      // The total for the whole filtered set, not just this page — the number
      // the owner actually wants to see.
      totalAmount: totals._sum.amount ?? 0n,
    };
  }

  async findOne(businessId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!expense) throw new NotFoundException('Expense not found.');
    return expense;
  }

  async update(businessId: string, id: string, dto: UpdateExpenseDto) {
    await this.findOne(businessId, id);
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
        ...(dto.amount !== undefined ? { amount: BigInt(dto.amount) } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(dto.vendor !== undefined ? { vendor: dto.vendor?.trim() || null } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.receiptUrl !== undefined ? { receiptUrl: dto.receiptUrl || null } : {}),
        ...(dto.spentAt !== undefined ? { spentAt: new Date(dto.spentAt) } : {}),
      },
    });
  }

  async remove(businessId: string, id: string) {
    await this.findOne(businessId, id);
    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** Spend per category over a period — the pie chart on the reports page. */
  async byCategory(businessId: string, from?: string, to?: string) {
    const grouped = await this.prisma.expense.groupBy({
      by: ['category'],
      where: { businessId, deletedAt: null, ...dateRange('spentAt', from, to) },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    return grouped.map((row) => ({
      category: row.category,
      total: row._sum.amount ?? 0n,
      count: row._count._all,
    }));
  }

  /** Categories already used, followed by the suggested defaults. */
  async categories(businessId: string): Promise<string[]> {
    const rows = await this.prisma.expense.findMany({
      where: { businessId, deletedAt: null },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });

    const used = rows.map((row) => row.category);
    const suggested = COMMON_EXPENSE_CATEGORIES.filter((name) => !used.includes(name));
    return [...used, ...suggested];
  }
}
