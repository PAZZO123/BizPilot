import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SaleStatus,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { paginated } from '../../common/dto/pagination.dto';
import { applyBps, clampNonNegative, multiply, sum } from '../../common/utils/money';
import type {
  CreateSaleDto,
  QuerySalesDto,
  RecordSalePaymentDto,
  SaleItemDto,
  VoidSaleDto,
} from './dto/sale.dto';

interface PricedLine {
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: bigint;
  unitCost: bigint;
  discount: bigint;
  total: bigint;
  tracksStock: boolean;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Records a sale: prices every line, checks stock, writes the sale, its
   * items, the stock movements and any payment — all in one transaction so a
   * failure halfway through cannot leave stock decremented for a sale that was
   * never saved.
   */
  async create(businessId: string, userId: string, dto: CreateSaleDto) {
    await this.entitlements.assertWithinMonthlyLimit(businessId, 'sales');

    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { defaultTaxBps: true, receiptPrefix: true, currency: true },
    });

    const number = await this.numbering.next(businessId, 'sale', business.receiptPrefix);

    const sale = await this.prisma.$transaction(
      async (tx) => {
        const lines = await this.priceLines(tx, businessId, dto.items);

        const subtotal = sum(lines.map((line) => line.total));
        const saleDiscount = BigInt(dto.discount ?? 0);
        if (saleDiscount > subtotal) {
          throw new BadRequestException('The discount cannot be more than the sale total.');
        }

        const taxable = subtotal - saleDiscount;
        const taxBps = dto.taxBps ?? business.defaultTaxBps;
        const tax = applyBps(taxable, taxBps);
        const total = taxable + tax;

        const costTotal = sum(lines.map((line) => multiply(line.unitCost, line.quantity)));

        // Cash sales are paid in full by default; anything less has to name the
        // customer, otherwise nobody knows who owes the money.
        const amountPaid = dto.amountPaid !== undefined ? BigInt(dto.amountPaid) : total;
        if (amountPaid > total) {
          throw new BadRequestException(
            'Amount paid is more than the total. Record change given, not an overpayment.',
          );
        }
        const balanceDue = total - amountPaid;
        if (balanceDue > 0n && !dto.customerId) {
          throw new BadRequestException(
            'Choose a customer before recording a sale that is not fully paid.',
          );
        }

        if (dto.customerId) {
          const customer = await tx.customer.findFirst({
            where: { id: dto.customerId, businessId, deletedAt: null },
            select: { id: true },
          });
          if (!customer) throw new NotFoundException('Customer not found.');
        }

        const locationId = dto.locationId ?? (await defaultLocationId(tx, businessId));

        const created = await tx.sale.create({
          data: {
            businessId,
            userId,
            locationId,
            customerId: dto.customerId ?? null,
            number,
            subtotal,
            discount: saleDiscount,
            tax,
            total,
            costTotal,
            amountPaid,
            paymentMethod: dto.paymentMethod ?? PaymentMethod.CASH,
            status: balanceDue > 0n ? SaleStatus.PARTIAL : SaleStatus.COMPLETED,
            note: dto.note,
            soldAt: dto.soldAt ? new Date(dto.soldAt) : new Date(),
            items: {
              create: lines.map((line) => ({
                productId: line.productId,
                name: line.name,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                unitCost: line.unitCost,
                discount: line.discount,
                total: line.total,
              })),
            },
          },
          include: { items: true },
        });

        // Move the stock.
        for (const line of lines) {
          if (!line.productId || !line.tracksStock) continue;
          const updated = await tx.product.update({
            where: { id: line.productId },
            data: { stockQty: { decrement: line.quantity } },
            select: { stockQty: true },
          });
          await tx.stockMovement.create({
            data: {
              businessId,
              productId: line.productId,
              locationId,
              userId,
              type: StockMovementType.SALE,
              quantity: -line.quantity,
              balanceAfter: updated.stockQty,
              reference: created.number,
            },
          });
        }

        if (amountPaid > 0n) {
          await tx.payment.create({
            data: {
              businessId,
              saleId: created.id,
              customerId: dto.customerId ?? null,
              amount: amountPaid,
              currency: business.currency,
              method: dto.paymentMethod ?? PaymentMethod.CASH,
              status: PaymentStatus.SUCCESSFUL,
              paidAt: created.soldAt,
            },
          });
        }

        if (balanceDue > 0n && dto.customerId) {
          await tx.customer.update({
            where: { id: dto.customerId },
            data: { balance: { increment: balanceDue } },
          });
        }

        return created;
      },
      // Pricing plus per-line stock updates can outrun the 5s default on a
      // large basket over a slow connection.
      { timeout: 20_000 },
    );

    await this.entitlements.consume(businessId, 'sales');
    return this.findOne(businessId, sale.id);
  }

  /**
   * Resolves each requested line to a concrete price and cost, and refuses the
   * sale if stock is short. Runs inside the caller's transaction so the stock
   * it checked is the stock it decrements.
   */
  private async priceLines(
    tx: Prisma.TransactionClient,
    businessId: string,
    items: SaleItemDto[],
  ): Promise<PricedLine[]> {
    const productIds = items
      .map((item) => item.productId)
      .filter((id): id is string => Boolean(id));

    const products = productIds.length
      ? await tx.product.findMany({
          where: { id: { in: productIds }, businessId, deletedAt: null },
        })
      : [];
    const byId = new Map(products.map((product) => [product.id, product]));

    // Two lines for the same product must be checked against the combined
    // quantity, or a basket with 3 + 3 of a product with 4 in stock would pass.
    const requestedByProduct = new Map<string, number>();
    for (const item of items) {
      if (!item.productId) continue;
      requestedByProduct.set(
        item.productId,
        (requestedByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }

    for (const [productId, quantity] of requestedByProduct) {
      const product = byId.get(productId);
      if (!product) throw new NotFoundException('One of the products is no longer available.');
      if (product.trackStock && product.stockQty < quantity) {
        throw new BadRequestException(
          `Not enough ${product.name} in stock — ${product.stockQty} left, ${quantity} requested.`,
        );
      }
    }

    return items.map((item) => {
      const product = item.productId ? byId.get(item.productId)! : null;

      const name = product?.name ?? item.name?.trim();
      if (!name) {
        throw new BadRequestException('Every line needs either a product or a name.');
      }

      const unitPrice =
        item.unitPrice !== undefined ? BigInt(item.unitPrice) : (product?.sellPrice ?? 0n);
      const unitCost = product?.costPrice ?? 0n;
      const discount = BigInt(item.discount ?? 0);
      const gross = multiply(unitPrice, item.quantity);

      if (discount > gross) {
        throw new BadRequestException(`The discount on ${name} is more than the line total.`);
      }

      return {
        productId: item.productId ?? null,
        name,
        quantity: item.quantity,
        unitPrice,
        unitCost,
        discount,
        total: clampNonNegative(gross - discount),
        tracksStock: product?.trackStock ?? false,
      };
    });
  }

  async findAll(businessId: string, query: QuerySalesDto) {
    const where: Prisma.SaleWhereInput = {
      businessId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.unpaidOnly ? { status: SaleStatus.PARTIAL } : {}),
      ...dateRange('soldAt', query.from, query.to),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { soldAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          user: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return paginated(items, total, query);
  }

  async findOne(businessId: string, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, businessId },
      include: {
        items: { include: { product: { select: { id: true, name: true, unit: true } } } },
        customer: true,
        user: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        payments: { orderBy: { paidAt: 'desc' } },
        invoice: { select: { id: true, number: true, status: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found.');
    return sale;
  }

  /** Takes a payment against an unpaid or part-paid sale. */
  async recordPayment(businessId: string, id: string, dto: RecordSalePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id, businessId } });
      if (!sale) throw new NotFoundException('Sale not found.');
      if (sale.status === SaleStatus.VOIDED) {
        throw new BadRequestException('This sale was cancelled.');
      }

      const outstanding = sale.total - sale.amountPaid;
      if (outstanding <= 0n) {
        throw new BadRequestException('This sale is already fully paid.');
      }

      const amount = BigInt(dto.amount);
      if (amount > outstanding) {
        throw new BadRequestException(
          'That is more than the outstanding balance on this sale.',
        );
      }

      const updated = await tx.sale.update({
        where: { id },
        data: {
          amountPaid: { increment: amount },
          status: amount === outstanding ? SaleStatus.COMPLETED : SaleStatus.PARTIAL,
        },
      });

      await tx.payment.create({
        data: {
          businessId,
          saleId: id,
          customerId: sale.customerId,
          amount,
          method: dto.method ?? PaymentMethod.CASH,
          status: PaymentStatus.SUCCESSFUL,
          reference: dto.reference,
        },
      });

      if (sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { balance: { decrement: amount } },
        });
      }

      return updated;
    });
  }

  /**
   * Cancels a sale and puts the stock back. The row is kept with a VOIDED
   * status rather than deleted — an audit trail that can be edited is not an
   * audit trail.
   */
  async voidSale(businessId: string, userId: string, id: string, dto: VoidSaleDto) {
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id, businessId },
        include: { items: true },
      });
      if (!sale) throw new NotFoundException('Sale not found.');
      if (sale.status === SaleStatus.VOIDED) {
        throw new BadRequestException('This sale is already cancelled.');
      }

      for (const item of sale.items) {
        if (!item.productId) continue;
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { trackStock: true },
        });
        if (!product?.trackStock) continue;

        const updated = await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { increment: item.quantity } },
          select: { stockQty: true },
        });
        await tx.stockMovement.create({
          data: {
            businessId,
            productId: item.productId,
            userId,
            type: StockMovementType.RETURN,
            quantity: item.quantity,
            balanceAfter: updated.stockQty,
            note: `Sale ${sale.number} cancelled: ${dto.reason}`,
            reference: sale.number,
          },
        });
      }

      // Whatever the customer still owed on this sale is no longer owed.
      const outstanding = sale.total - sale.amountPaid;
      if (sale.customerId && outstanding > 0n) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { balance: { decrement: outstanding } },
        });
      }

      const voided = await tx.sale.update({
        where: { id },
        data: {
          status: SaleStatus.VOIDED,
          voidedAt: new Date(),
          note: sale.note ? `${sale.note}\nCancelled: ${dto.reason}` : `Cancelled: ${dto.reason}`,
        },
      });

      await tx.auditLog.create({
        data: {
          businessId,
          userId,
          action: 'sale.void',
          entityType: 'sale',
          entityId: id,
          metadata: { reason: dto.reason, number: sale.number },
        },
      });

      return voided;
    });
  }
}

/** Builds a Prisma date filter, tolerating either bound being absent. */
export function dateRange(field: string, from?: string, to?: string): Record<string, unknown> {
  if (!from && !to) return {};
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = new Date(from);
  if (to) {
    // An inclusive "to" date means the whole of that day.
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    filter.lte = end;
  }
  return { [field]: filter };
}

async function defaultLocationId(
  tx: Prisma.TransactionClient,
  businessId: string,
): Promise<string | null> {
  const location = await tx.location.findFirst({
    where: { businessId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return location?.id ?? null;
}
