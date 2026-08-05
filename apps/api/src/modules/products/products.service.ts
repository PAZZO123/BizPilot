import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { paginated, type PaginationDto } from '../../common/dto/pagination.dto';
import type {
  AdjustStockDto,
  CreateProductDto,
  QueryProductsDto,
  UpdateProductDto,
} from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(businessId: string, userId: string, dto: CreateProductDto) {
    await this.entitlements.assertCanAddProduct(businessId);

    const openingStock = dto.stockQty ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          businessId,
          name: dto.name.trim(),
          sku: dto.sku?.trim() || null,
          barcode: dto.barcode?.trim() || null,
          category: dto.category?.trim() || null,
          description: dto.description?.trim() || null,
          unit: dto.unit?.trim() || 'piece',
          costPrice: BigInt(dto.costPrice),
          sellPrice: BigInt(dto.sellPrice),
          stockQty: openingStock,
          reorderLevel: dto.reorderLevel ?? 0,
          trackStock: dto.trackStock ?? true,
          imageUrl: dto.imageUrl || null,
        },
      });

      // Opening stock is a real movement — without it the ledger would not
      // explain where the first units came from.
      if (openingStock > 0 && product.trackStock) {
        await tx.stockMovement.create({
          data: {
            businessId,
            productId: product.id,
            userId,
            type: StockMovementType.PURCHASE,
            quantity: openingStock,
            balanceAfter: openingStock,
            unitCost: BigInt(dto.costPrice),
            note: 'Opening stock',
          },
        });
      }

      return product;
    });
  }

  async findAll(businessId: string, query: QueryProductsDto) {
    const where: Prisma.ProductWhereInput = {
      businessId,
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { barcode: { contains: query.search, mode: 'insensitive' } },
              { category: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // "At or below reorder level" compares two columns, which Prisma's filter
    // syntax cannot express, so the low-stock view goes through raw SQL for the
    // id set and then reuses the normal query for consistent shaping.
    if (query.lowStockOnly) {
      const lowStockIds = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM products
        WHERE "businessId" = ${businessId}
          AND "deletedAt" IS NULL
          AND "isActive" = true
          AND "trackStock" = true
          AND "stockQty" <= "reorderLevel"
      `;
      where.id = { in: lowStockIds.map((row) => row.id) };
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginated(items, total, query);
  }

  async findOne(businessId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  /** Barcode scan at the till: exact match, active products only. */
  async findByBarcode(businessId: string, barcode: string) {
    const product = await this.prisma.product.findFirst({
      where: { businessId, barcode, deletedAt: null, isActive: true },
    });
    if (!product) throw new NotFoundException('No product matches that barcode.');
    return product;
  }

  async update(businessId: string, id: string, dto: UpdateProductDto) {
    await this.findOne(businessId, id);

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku?.trim() || null } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode?.trim() || null } : {}),
        ...(dto.category !== undefined ? { category: dto.category?.trim() || null } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit?.trim() || 'piece' } : {}),
        ...(dto.costPrice !== undefined ? { costPrice: BigInt(dto.costPrice) } : {}),
        ...(dto.sellPrice !== undefined ? { sellPrice: BigInt(dto.sellPrice) } : {}),
        ...(dto.reorderLevel !== undefined ? { reorderLevel: dto.reorderLevel } : {}),
        ...(dto.trackStock !== undefined ? { trackStock: dto.trackStock } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    // stockQty is deliberately not settable here — stock only moves through
    // adjustStock, so the ledger always explains the current balance.
  }

  /**
   * Soft delete. Sales reference products, and a shop that deletes a product
   * still needs last month's profit report to make sense.
   */
  async remove(businessId: string, id: string) {
    await this.findOne(businessId, id);
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true };
  }

  /** Records a stock movement and moves the running balance with it. */
  async adjustStock(businessId: string, userId: string, productId: string, dto: AdjustStockDto) {
    if (dto.quantity === 0) {
      throw new BadRequestException('Quantity must not be zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, businessId, deletedAt: null },
      });
      if (!product) throw new NotFoundException('Product not found.');
      if (!product.trackStock) {
        throw new BadRequestException(`${product.name} is a service and does not carry stock.`);
      }

      const balanceAfter = product.stockQty + dto.quantity;
      if (balanceAfter < 0) {
        throw new BadRequestException(
          `Cannot remove ${Math.abs(dto.quantity)} — only ${product.stockQty} in stock.`,
        );
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          stockQty: balanceAfter,
          // A restock at a new price updates what the product costs going
          // forward. Historical margins are untouched: sale items snapshot the
          // cost at the time of sale.
          ...(dto.type === StockMovementType.PURCHASE && dto.unitCost
            ? { costPrice: BigInt(dto.unitCost) }
            : {}),
        },
      });

      await tx.stockMovement.create({
        data: {
          businessId,
          productId,
          userId,
          type: dto.type,
          quantity: dto.quantity,
          balanceAfter,
          unitCost: dto.unitCost !== undefined ? BigInt(dto.unitCost) : null,
          note: dto.note,
          reference: dto.reference,
        },
      });

      return updated;
    });
  }

  async stockMovements(businessId: string, productId: string, pagination: PaginationDto) {
    const where: Prisma.StockMovementWhereInput = { businessId, productId };
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: { user: { select: { id: true, name: true } } },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paginated(items, total, pagination);
  }

  /** Products at or below their reorder level — drives the dashboard alert. */
  async lowStock(businessId: string) {
    return this.prisma.$queryRaw<
      { id: string; name: string; stockQty: number; reorderLevel: number; unit: string }[]
    >`
      SELECT id, name, "stockQty", "reorderLevel", unit
      FROM products
      WHERE "businessId" = ${businessId}
        AND "deletedAt" IS NULL
        AND "isActive" = true
        AND "trackStock" = true
        AND "stockQty" <= "reorderLevel"
      ORDER BY ("stockQty" - "reorderLevel") ASC, name ASC
      LIMIT 100
    `;
  }

  async categories(businessId: string): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { businessId, deletedAt: null, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return rows.map((row) => row.category!).filter(Boolean);
  }

  /** Total value of stock on hand, valued at cost. */
  async inventoryValue(businessId: string): Promise<{ costValue: number; retailValue: number }> {
    const rows = await this.prisma.$queryRaw<{ cost: bigint | null; retail: bigint | null }[]>`
      SELECT
        COALESCE(SUM("costPrice" * "stockQty"), 0)::bigint AS cost,
        COALESCE(SUM("sellPrice" * "stockQty"), 0)::bigint AS retail
      FROM products
      WHERE "businessId" = ${businessId}
        AND "deletedAt" IS NULL
        AND "trackStock" = true
        AND "stockQty" > 0
    `;
    return {
      costValue: Number(rows[0]?.cost ?? 0),
      retailValue: Number(rows[0]?.retail ?? 0),
    };
  }
}
