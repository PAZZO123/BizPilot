import { Injectable } from '@nestjs/common';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { formatMoney } from '@bizpilot/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { ProductsService } from '../products/products.service';
import { ExpensesService } from '../expenses/expenses.service';

/**
 * Tool schemas are raw JSON Schema rather than Zod: the SDK's Zod helper wants
 * Zod v4 and the rest of the monorepo (and @hookform/resolvers on the web side)
 * is on v3. `betaTool` infers the argument types from the schema, so the run
 * functions stay type-safe either way.
 */
const DATE_RANGE_PROPS = {
  from: {
    type: 'string',
    description: 'Start date, ISO format YYYY-MM-DD. Defaults to the start of this month.',
  },
  to: {
    type: 'string',
    description: 'End date, ISO format YYYY-MM-DD, inclusive. Defaults to today.',
  },
} as const;

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

/**
 * The tools the assistant can call to look at a business's own data.
 *
 * Every tool is a closure over one `businessId`, so there is no path by which a
 * prompt — however it is worded — can reach another business's rows. The tenant
 * is bound in code before the model ever sees the tool.
 *
 * Tools return formatted strings rather than raw JSON: the model reasons about
 * "RWF 45,000" more reliably than about `4500000`, and it removes any chance of
 * it inventing its own conversion from minor units.
 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly products: ProductsService,
    private readonly expenses: ExpensesService,
  ) {}

  async buildTools(businessId: string) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { currency: true },
    });
    const money = (value: bigint | number) =>
      formatMoney(typeof value === 'bigint' ? Number(value) : value, business.currency);

    return [
      betaTool({
        name: 'get_financial_summary',
        description:
          'Revenue, cost of goods, gross profit, expenses and net profit for a period. ' +
          'Use this for any question about profit, sales totals, or how the business is doing.',
        inputSchema: {
          type: 'object',
          properties: DATE_RANGE_PROPS,
          additionalProperties: false,
        },
        run: async ({ from, to }) => {
          const { start, end } = resolveRange(from, to);
          const totals = await this.reports.periodTotals(businessId, start, end);
          const margin =
            totals.revenue > 0n
              ? `${(Number((totals.grossProfit * 1000n) / totals.revenue) / 10).toFixed(1)}%`
              : 'n/a';

          return [
            `Period: ${iso(start)} to ${iso(end)}`,
            `Sales recorded: ${totals.salesCount}`,
            `Revenue: ${money(totals.revenue)}`,
            `Cost of goods sold: ${money(totals.cost)}`,
            `Gross profit: ${money(totals.grossProfit)} (margin ${margin})`,
            `Expenses: ${money(totals.expenses)}`,
            `Net profit: ${money(totals.netProfit)}`,
            `Cash actually collected: ${money(totals.cashCollected)}`,
          ].join('\n');
        },
      }),

      betaTool({
        name: 'get_top_products',
        description:
          'Best-selling products for a period, by revenue, with units sold and profit. ' +
          'Use for "what sells best", "what should I stock more of".',
        inputSchema: {
          type: 'object',
          properties: {
            ...DATE_RANGE_PROPS,
            limit: {
              type: 'number',
              description: 'How many products to return. Maximum 25.',
            },
          },
          additionalProperties: false,
        },
        run: async ({ from, to, limit }) => {
          const { start, end } = resolveRange(from, to);
          const capped = Math.min(Math.max(Math.trunc(limit ?? 10), 1), 25);
          const rows = await this.reports.topProducts(businessId, start, end, capped);
          if (!rows.length) return 'No sales in this period.';

          return rows
            .map(
              (row, index) =>
                `${index + 1}. ${row.name} — ${row.unitsSold} sold, ` +
                `revenue ${money(row.revenue)}, profit ${money(row.profit)}`,
            )
            .join('\n');
        },
      }),

      betaTool({
        name: 'get_low_stock',
        description:
          'Products at or below their reorder level. Use for "what should I restock" ' +
          'and any question about running out.',
        inputSchema: NO_ARGS,
        run: async () => {
          const rows = await this.products.lowStock(businessId);
          if (!rows.length) return 'Nothing is below its reorder level right now.';

          return rows
            .map(
              (row) =>
                `${row.name}: ${row.stockQty} ${row.unit} left ` +
                `(reorder level ${row.reorderLevel})`,
            )
            .join('\n');
        },
      }),

      betaTool({
        name: 'get_dead_stock',
        description:
          'Products holding stock that did not sell at all in the period, with the money ' +
          'tied up in them. Use for "what is not selling", "where is my cash stuck".',
        inputSchema: {
          type: 'object',
          properties: DATE_RANGE_PROPS,
          additionalProperties: false,
        },
        run: async ({ from, to }) => {
          const { start, end } = resolveRange(from, to);
          const rows = await this.reports.deadStock(businessId, start, end, 15);
          if (!rows.length) return 'Every product with stock sold at least once in this period.';

          return rows
            .map(
              (row) =>
                `${row.name}: ${row.stockQty} in stock, ` +
                `${money(row.tiedUpCapital)} tied up, no sales in this period`,
            )
            .join('\n');
        },
      }),

      betaTool({
        name: 'get_expense_breakdown',
        description:
          'Expenses grouped by category for a period. Use for "where is my money going".',
        inputSchema: {
          type: 'object',
          properties: DATE_RANGE_PROPS,
          additionalProperties: false,
        },
        run: async ({ from, to }) => {
          const rows = await this.expenses.byCategory(businessId, from, to);
          if (!rows.length) return 'No expenses recorded in this period.';

          const total = rows.reduce((acc, row) => acc + row.total, 0n);
          return [
            ...rows.map(
              (row) =>
                `${row.category}: ${money(row.total)} across ${row.count} entr${
                  row.count === 1 ? 'y' : 'ies'
                }`,
            ),
            `Total: ${money(total)}`,
          ].join('\n');
        },
      }),

      betaTool({
        name: 'get_receivables',
        description:
          'Customers who currently owe money, and overdue invoices. Use for "who owes me", ' +
          '"how much am I waiting for".',
        inputSchema: NO_ARGS,
        run: async () => {
          const [customers, overdue] = await Promise.all([
            this.prisma.customer.findMany({
              where: { businessId, deletedAt: null, balance: { gt: 0 } },
              orderBy: { balance: 'desc' },
              take: 20,
              select: { name: true, phone: true, balance: true },
            }),
            this.prisma.invoice.findMany({
              where: {
                businessId,
                status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
                dueDate: { lt: new Date() },
              },
              orderBy: { dueDate: 'asc' },
              take: 20,
              select: {
                number: true,
                total: true,
                amountPaid: true,
                dueDate: true,
                customer: { select: { name: true } },
              },
            }),
          ]);

          if (!customers.length && !overdue.length) return 'Nobody currently owes you money.';

          const lines: string[] = [];
          if (customers.length) {
            const total = customers.reduce((acc, row) => acc + row.balance, 0n);
            lines.push(`Customers owing (${money(total)} in total):`);
            lines.push(
              ...customers.map(
                (row) =>
                  `- ${row.name}${row.phone ? ` (${row.phone})` : ''}: ${money(row.balance)}`,
              ),
            );
          }
          if (overdue.length) {
            lines.push('', 'Overdue invoices:');
            lines.push(
              ...overdue.map(
                (row) =>
                  `- ${row.number} to ${row.customer?.name ?? 'unknown'}: ` +
                  `${money(row.total - row.amountPaid)} outstanding, due ${iso(row.dueDate!)}`,
              ),
            );
          }
          return lines.join('\n');
        },
      }),

      betaTool({
        name: 'get_inventory_value',
        description:
          'Total value of stock on hand, at cost and at retail. ' +
          'Use for "how much stock am I holding".',
        inputSchema: NO_ARGS,
        run: async () => {
          const value = await this.products.inventoryValue(businessId);
          return (
            `Stock at cost: ${money(value.costValue)}\n` +
            `Stock at selling price: ${money(value.retailValue)}\n` +
            `Potential profit if all sold: ${money(value.retailValue - value.costValue)}`
          );
        },
      }),

      betaTool({
        name: 'search_products',
        description:
          'Find products by name, SKU or category, with their price, cost and stock level. ' +
          'Use when the owner asks about a specific item.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Part of a product name, SKU or category.',
            },
          },
          required: ['query'],
          additionalProperties: false,
        },
        run: async ({ query }) => {
          const rows = await this.prisma.product.findMany({
            where: {
              businessId,
              deletedAt: null,
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
                { category: { contains: query, mode: 'insensitive' } },
              ],
            },
            take: 15,
            orderBy: { name: 'asc' },
          });
          if (!rows.length) return `No products match "${query}".`;

          return rows
            .map(
              (row) =>
                `${row.name}${row.sku ? ` [${row.sku}]` : ''}: ` +
                `sells at ${money(row.sellPrice)}, costs ${money(row.costPrice)}, ` +
                `${row.trackStock ? `${row.stockQty} ${row.unit} in stock` : 'service, no stock'}`,
            )
            .join('\n');
        },
      }),

      betaTool({
        name: 'get_busiest_hours',
        description: 'Sales volume by hour of day, for staffing and opening-hours questions.',
        inputSchema: {
          type: 'object',
          properties: DATE_RANGE_PROPS,
          additionalProperties: false,
        },
        run: async ({ from, to }) => {
          const { start, end } = resolveRange(from, to);
          const rows = await this.reports.salesByHour(businessId, start, end);
          if (!rows.length) return 'No sales in this period.';

          return rows
            .map(
              (row) =>
                `${String(row.hour).padStart(2, '0')}:00 — ${row.sales} sales, ${money(row.revenue)}`,
            )
            .join('\n');
        },
      }),
    ];
  }
}

/** Defaults to the current calendar month when the model omits a range. */
function resolveRange(from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date();
  const end = to ? new Date(to) : now;
  end.setHours(23, 59, 59, 999);

  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);

  return { start, end };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
