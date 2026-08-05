import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SaleStatus,
} from '@prisma/client';
import { formatMoney } from '@bizpilot/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { paginated } from '../../common/dto/pagination.dto';
import { applyBps, clampNonNegative, multiply, sum } from '../../common/utils/money';
import { dateRange } from '../sales/sales.service';
import { SmsService } from '../sms/sms.service';
import type {
  CreateInvoiceDto,
  InvoiceFromSaleDto,
  QueryInvoicesDto,
  RecordInvoicePaymentDto,
  SendInvoiceDto,
} from './dto/invoice.dto';

const OPEN_STATUSES = [InvoiceStatus.SENT, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE];

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  async create(businessId: string, dto: CreateInvoiceDto) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { defaultTaxBps: true, invoicePrefix: true },
    });

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');

    const lines = dto.items.map((item) => {
      const unitPrice = BigInt(item.unitPrice);
      const discount = BigInt(item.discount ?? 0);
      const gross = multiply(unitPrice, item.quantity);
      if (discount > gross) {
        throw new BadRequestException(`The discount on ${item.name} exceeds the line total.`);
      }
      return {
        productId: item.productId ?? null,
        name: item.name.trim(),
        description: item.description?.trim() || null,
        quantity: item.quantity,
        unitPrice,
        discount,
        total: clampNonNegative(gross - discount),
      };
    });

    const subtotal = sum(lines.map((line) => line.total));
    const discount = BigInt(dto.discount ?? 0);
    if (discount > subtotal) {
      throw new BadRequestException('The discount cannot be more than the invoice total.');
    }
    const taxable = subtotal - discount;
    const tax = applyBps(taxable, dto.taxBps ?? business.defaultTaxBps);
    const total = taxable + tax;

    const number = await this.numbering.next(businessId, 'invoice', business.invoicePrefix);

    return this.prisma.invoice.create({
      data: {
        businessId,
        customerId: dto.customerId,
        number,
        status: InvoiceStatus.DRAFT,
        subtotal,
        discount,
        tax,
        total,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes?.trim() || null,
        terms: dto.terms?.trim() || null,
        items: { create: lines },
      },
      include: { items: true, customer: true },
    });
  }

  /**
   * Turns a completed sale into an invoice. The amount already paid on the
   * sale carries across, so an invoice raised for a part-paid credit sale
   * shows the real outstanding balance rather than the full total.
   */
  async createFromSale(businessId: string, dto: InvoiceFromSaleDto) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: dto.saleId, businessId },
      include: { items: true, invoice: { select: { id: true } } },
    });
    if (!sale) throw new NotFoundException('Sale not found.');
    if (sale.status === SaleStatus.VOIDED) {
      throw new BadRequestException('This sale was cancelled and cannot be invoiced.');
    }
    if (sale.invoice) {
      throw new BadRequestException('This sale already has an invoice.');
    }
    if (!sale.customerId) {
      throw new BadRequestException('Add a customer to the sale before invoicing it.');
    }

    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { invoicePrefix: true },
    });
    const number = await this.numbering.next(businessId, 'invoice', business.invoicePrefix);

    const status =
      sale.amountPaid >= sale.total
        ? InvoiceStatus.PAID
        : sale.amountPaid > 0n
          ? InvoiceStatus.PARTIAL
          : InvoiceStatus.SENT;

    return this.prisma.invoice.create({
      data: {
        businessId,
        customerId: sale.customerId,
        saleId: sale.id,
        number,
        status,
        subtotal: sale.subtotal,
        discount: sale.discount,
        tax: sale.tax,
        total: sale.total,
        amountPaid: sale.amountPaid,
        issueDate: sale.soldAt,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes?.trim() || null,
        paidAt: sale.amountPaid >= sale.total ? new Date() : null,
        items: {
          create: sale.items.map((item) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            total: item.total,
          })),
        },
      },
      include: { items: true, customer: true },
    });
  }

  async findAll(businessId: string, query: QueryInvoicesDto) {
    const where: Prisma.InvoiceWhereInput = {
      businessId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.overdueOnly
        ? { status: { in: OPEN_STATUSES }, dueDate: { lt: new Date() } }
        : {}),
      ...dateRange('issueDate', query.from, query.to),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total, outstanding] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { issueDate: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.aggregate({
        where: { ...where, status: { in: OPEN_STATUSES } },
        _sum: { total: true, amountPaid: true },
      }),
    ]);

    return {
      ...paginated(items, total, query),
      outstandingTotal:
        (outstanding._sum.total ?? 0n) - (outstanding._sum.amountPaid ?? 0n),
    };
  }

  async findOne(businessId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, businessId },
      include: {
        items: true,
        customer: true,
        payments: { orderBy: { paidAt: 'desc' } },
        sale: { select: { id: true, number: true } },
        business: {
          select: {
            name: true,
            phone: true,
            email: true,
            address: true,
            logoUrl: true,
            taxId: true,
            currency: true,
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  /**
   * The customer-facing view, reached from the link in the SMS. Deliberately
   * returns only what a payer needs — no internal ids, no cost prices.
   */
  async findByPublicToken(token: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { publicToken: token },
      include: {
        items: { select: { name: true, description: true, quantity: true, unitPrice: true, total: true } },
        customer: { select: { name: true } },
        business: {
          select: { name: true, phone: true, email: true, address: true, logoUrl: true, currency: true },
        },
      },
    });

    if (!invoice || invoice.status === InvoiceStatus.CANCELLED) {
      throw new NotFoundException('This invoice link is not valid.');
    }

    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      tax: invoice.tax,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balanceDue: invoice.total - invoice.amountPaid,
      notes: invoice.notes,
      terms: invoice.terms,
      items: invoice.items,
      customer: invoice.customer,
      business: invoice.business,
      currency: invoice.business.currency,
    };
  }

  async recordPayment(businessId: string, id: string, dto: RecordInvoicePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id, businessId } });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException('This invoice was cancelled.');
      }

      const outstanding = invoice.total - invoice.amountPaid;
      if (outstanding <= 0n) {
        throw new BadRequestException('This invoice is already fully paid.');
      }

      const amount = BigInt(dto.amount);
      if (amount > outstanding) {
        throw new BadRequestException('That is more than the outstanding balance.');
      }

      const fullySettled = amount === outstanding;

      const updated = await tx.invoice.update({
        where: { id },
        data: {
          amountPaid: { increment: amount },
          status: fullySettled ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
          paidAt: fullySettled ? new Date() : null,
        },
      });

      await tx.payment.create({
        data: {
          businessId,
          invoiceId: id,
          customerId: invoice.customerId,
          amount,
          method: dto.method ?? PaymentMethod.CASH,
          status: PaymentStatus.SUCCESSFUL,
          reference: dto.reference,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        },
      });

      if (invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { balance: { decrement: amount } },
        });
      }

      // Keep the originating sale in step, so the sales list does not still
      // show money owed that has since been settled against the invoice.
      if (invoice.saleId) {
        const sale = await tx.sale.update({
          where: { id: invoice.saleId },
          data: { amountPaid: { increment: amount } },
        });
        if (sale.amountPaid >= sale.total && sale.status === SaleStatus.PARTIAL) {
          await tx.sale.update({
            where: { id: sale.id },
            data: { status: SaleStatus.COMPLETED },
          });
        }
      }

      return updated;
    });
  }

  /** Sends the invoice link by SMS and marks it as sent. */
  async send(businessId: string, id: string, dto: SendInvoiceDto) {
    const invoice = await this.findOne(businessId, id);

    const phone = dto.phone ?? invoice.customer?.phone;
    if (!phone) {
      throw new BadRequestException(
        'This customer has no phone number. Add one before sending a reminder.',
      );
    }

    const balanceDue = invoice.total - invoice.amountPaid;
    const link = this.publicLink(invoice.publicToken);
    const body =
      dto.message ??
      `${invoice.business.name}: invoice ${invoice.number} for ` +
        `${formatMoney(Number(balanceDue), invoice.business.currency)} is ready. ` +
        `View and pay: ${link}`;

    const message = await this.sms.queueMessage({
      businessId,
      to: phone,
      body,
      kind: 'invoice_reminder',
      customerId: invoice.customerId,
      invoiceId: invoice.id,
    });

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: invoice.status === InvoiceStatus.DRAFT ? InvoiceStatus.SENT : invoice.status,
        sentAt: invoice.sentAt ?? new Date(),
        lastReminderAt: new Date(),
      },
    });

    return { invoice: updated, sms: message, link };
  }

  async cancel(businessId: string, id: string) {
    const invoice = await this.findOne(businessId, id);
    if (invoice.amountPaid > 0n) {
      throw new BadRequestException(
        'This invoice has payments against it. Refund them before cancelling.',
      );
    }

    return this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
    });
  }

  /** Regenerates the public link, invalidating any that were shared before. */
  async rotatePublicToken(businessId: string, id: string) {
    await this.findOne(businessId, id);
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { publicToken: crypto.randomUUID() },
      select: { publicToken: true },
    });
    return { link: this.publicLink(updated.publicToken) };
  }

  publicLink(token: string): string {
    return `${this.config.get<string>('WEB_URL', '')}/pay/${token}`;
  }

  /**
   * Flags invoices whose due date has passed. Runs hourly rather than being
   * computed on read, so "overdue" is a real state that reminders and reports
   * can both rely on.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async markOverdueInvoices(): Promise<void> {
    const result = await this.prisma.invoice.updateMany({
      where: {
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIAL] },
        dueDate: { lt: new Date() },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} invoice(s) overdue.`);
    }
  }

  /**
   * Nudges customers with overdue invoices once every three days. Sending
   * daily would train people to ignore the messages, and each one costs money.
   */
  @Cron('0 9 * * *', { name: 'invoice-reminders', timeZone: 'Africa/Kigali' })
  async sendOverdueReminders(): Promise<void> {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.OVERDUE,
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: threeDaysAgo } }],
        customer: { phone: { not: null } },
      },
      include: {
        customer: { select: { id: true, phone: true, name: true } },
        business: { select: { name: true, currency: true } },
      },
      take: 200,
    });

    for (const invoice of invoices) {
      if (!invoice.customer?.phone) continue;
      const balanceDue = invoice.total - invoice.amountPaid;

      try {
        await this.sms.queueMessage({
          businessId: invoice.businessId,
          to: invoice.customer.phone,
          body:
            `${invoice.business.name}: a friendly reminder that invoice ${invoice.number} ` +
            `for ${formatMoney(Number(balanceDue), invoice.business.currency)} is overdue. ` +
            `Pay here: ${this.publicLink(invoice.publicToken)}`,
          kind: 'invoice_reminder',
          customerId: invoice.customerId,
          invoiceId: invoice.id,
        });

        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { lastReminderAt: new Date() },
        });
      } catch (error) {
        // One business running out of SMS credit must not stop the reminders
        // for every other business in the loop.
        this.logger.warn(
          `Skipped reminder for invoice ${invoice.number}: ${(error as Error).message}`,
        );
      }
    }
  }
}
