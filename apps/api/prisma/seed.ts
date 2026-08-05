/**
 * Seeds a realistic demo business: three months of sales with weekday and
 * time-of-day patterns, real Rwandan retail products and prices, expenses,
 * credit customers and an overdue invoice.
 *
 * This exists so the dashboard, reports and AI assistant have something true
 * to say the first time anyone opens them — an empty product is impossible to
 * evaluate and impossible to demo.
 *
 * Run with: npm run db:seed --workspace=apps/api
 */
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  SaleStatus,
  StockMovementType,
  SubscriptionStatus,
  UserRole,
  type Product,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@bizpilot.rw';
const DEMO_PASSWORD = 'demo1234';
const MONTHS_OF_HISTORY = 3;

/** Prices are in minor units: 1200 RWF is written 120000. */
const CATALOGUE = [
  { name: 'Inyange Milk 1L', category: 'Drinks', cost: 90000, sell: 120000, stock: 48, reorder: 12, unit: 'piece', weight: 9 },
  { name: 'Bralirwa Primus 65cl', category: 'Drinks', cost: 80000, sell: 110000, stock: 96, reorder: 24, unit: 'bottle', weight: 10 },
  { name: 'Coca-Cola 50cl', category: 'Drinks', cost: 40000, sell: 60000, stock: 120, reorder: 24, unit: 'bottle', weight: 12 },
  { name: 'Sugar 1kg', category: 'Groceries', cost: 130000, sell: 160000, stock: 40, reorder: 10, unit: 'kg', weight: 8 },
  { name: 'Rice 5kg', category: 'Groceries', cost: 650000, sell: 780000, stock: 22, reorder: 6, unit: 'bag', weight: 5 },
  { name: 'Cooking Oil 1L', category: 'Groceries', cost: 220000, sell: 270000, stock: 30, reorder: 8, unit: 'bottle', weight: 6 },
  { name: 'Maize Flour 2kg', category: 'Groceries', cost: 180000, sell: 220000, stock: 35, reorder: 10, unit: 'bag', weight: 7 },
  { name: 'Bread (large)', category: 'Bakery', cost: 100000, sell: 140000, stock: 18, reorder: 8, unit: 'loaf', weight: 11 },
  { name: 'Eggs (tray of 30)', category: 'Groceries', cost: 480000, sell: 570000, stock: 14, reorder: 4, unit: 'tray', weight: 6 },
  { name: 'Blue Band 500g', category: 'Groceries', cost: 320000, sell: 390000, stock: 16, reorder: 5, unit: 'tub', weight: 3 },
  { name: 'Omo Detergent 1kg', category: 'Household', cost: 250000, sell: 320000, stock: 24, reorder: 6, unit: 'pack', weight: 4 },
  { name: 'Toilet Paper (4 pack)', category: 'Household', cost: 150000, sell: 200000, stock: 28, reorder: 8, unit: 'pack', weight: 4 },
  { name: 'Bar Soap', category: 'Household', cost: 60000, sell: 90000, stock: 60, reorder: 15, unit: 'piece', weight: 5 },
  { name: 'Matches (10 boxes)', category: 'Household', cost: 30000, sell: 50000, stock: 40, reorder: 10, unit: 'pack', weight: 3 },
  // Deliberately overstocked and slow — gives the AI assistant a real finding.
  { name: 'Imported Olive Oil 750ml', category: 'Groceries', cost: 1200000, sell: 1450000, stock: 18, reorder: 3, unit: 'bottle', weight: 0 },
  { name: 'Airtime top-up', category: 'Services', cost: 95000, sell: 100000, stock: 0, reorder: 0, unit: 'voucher', weight: 9, service: true },
] as const;

const CUSTOMERS = [
  { name: 'Jean Baptiste Nkurunziza', phone: '+250788112233' },
  { name: 'Marie Claire Uwimana', phone: '+250788445566' },
  { name: 'Hotel Kivu Lodge', phone: '+250788778899', email: 'orders@kivulodge.rw' },
  { name: 'Emmanuel Habimana', phone: '+250789334455' },
  { name: "St Joseph's School", phone: '+250788990011', email: 'bursar@stjoseph.rw' },
];

const EXPENSES = [
  { category: 'Rent', amount: 15000000, vendor: 'Landlord', monthly: true },
  { category: 'Salaries', amount: 18000000, vendor: 'Staff (2)', monthly: true },
  { category: 'Electricity', amount: 2200000, vendor: 'REG', monthly: true },
  { category: 'Water', amount: 800000, vendor: 'WASAC', monthly: true },
  { category: 'Airtime & internet', amount: 1500000, vendor: 'MTN', monthly: true },
  { category: 'Transport', amount: 900000, vendor: 'Moto delivery', monthly: false },
  { category: 'Licences & taxes', amount: 5000000, vendor: 'RRA', monthly: false },
  { category: 'Repairs', amount: 1200000, vendor: 'Fridge technician', monthly: false },
];

async function main(): Promise<void> {
  console.log('Seeding BizPilot demo data...\n');

  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log('Demo business already exists. Removing it so the seed is repeatable...');
    await prisma.business.delete({ where: { id: existing.businessId } });
  }

  // --- Business, owner, staff --------------------------------------------
  const business = await prisma.business.create({
    data: {
      name: 'Kigali Fresh Market',
      type: 'SHOP',
      currency: 'RWF',
      country: 'RW',
      timezone: 'Africa/Kigali',
      phone: '+250788123456',
      email: DEMO_EMAIL,
      address: 'KN 5 Rd, Nyarugenge, Kigali',
      taxId: '102938475',
      defaultTaxBps: 0,
      plan: 'starter',
      subscriptionStatus: SubscriptionStatus.TRIALING,
      trialEndsAt: daysFromNow(9),
      locations: { create: { name: 'Main shop', isDefault: true, address: 'KN 5 Rd, Kigali' } },
      subscription: { create: { plan: 'free', status: SubscriptionStatus.TRIALING } },
    },
    include: { locations: true },
  });
  const locationId = business.locations[0].id;

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const owner = await prisma.user.create({
    data: {
      businessId: business.id,
      email: DEMO_EMAIL,
      name: 'Aline Mukamana',
      phone: '+250788123456',
      role: UserRole.OWNER,
      passwordHash,
    },
  });
  const cashier = await prisma.user.create({
    data: {
      businessId: business.id,
      email: 'cashier@bizpilot.rw',
      name: 'Eric Nsengimana',
      role: UserRole.CASHIER,
      passwordHash,
    },
  });

  // --- Catalogue ----------------------------------------------------------
  // Annotated because the array is populated from inside the loop that also
  // reads its length; without this TypeScript infers it circularly.
  const products: (Product & { weight: number })[] = [];
  for (const item of CATALOGUE) {
    const product = await prisma.product.create({
      data: {
        businessId: business.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        costPrice: BigInt(item.cost),
        sellPrice: BigInt(item.sell),
        stockQty: item.stock,
        reorderLevel: item.reorder,
        trackStock: !('service' in item && item.service),
        sku: item.name.slice(0, 3).toUpperCase() + '-' + String(products.length + 1).padStart(3, '0'),
      },
    });
    if (product.trackStock && item.stock > 0) {
      await prisma.stockMovement.create({
        data: {
          businessId: business.id,
          productId: product.id,
          userId: owner.id,
          type: StockMovementType.PURCHASE,
          quantity: item.stock,
          balanceAfter: item.stock,
          unitCost: BigInt(item.cost),
          note: 'Opening stock',
        },
      });
    }
    products.push({ ...product, weight: item.weight });
  }
  console.log(`  ${products.length} products`);

  // --- Customers ----------------------------------------------------------
  const customers = [];
  for (const entry of CUSTOMERS) {
    customers.push(
      await prisma.customer.create({
        data: {
          businessId: business.id,
          name: entry.name,
          phone: entry.phone,
          email: 'email' in entry ? entry.email : null,
        },
      }),
    );
  }
  console.log(`  ${customers.length} customers`);

  // --- Sales history ------------------------------------------------------
  const start = new Date();
  start.setMonth(start.getMonth() - MONTHS_OF_HISTORY);
  start.setHours(0, 0, 0, 0);

  // Weighted picker so bread and Coke outsell imported olive oil, the way they
  // would in a real shop.
  const weighted = products.flatMap((product) =>
    Array.from({ length: product.weight }, () => product),
  );

  let saleCounter = 0;
  let receiptNumber = 0;
  const stockLevels = new Map(products.map((product) => [product.id, product.stockQty]));

  for (let day = new Date(start); day <= new Date(); day.setDate(day.getDate() + 1)) {
    const isSunday = day.getDay() === 0;
    const isSaturday = day.getDay() === 6;
    // Saturdays are busy, Sundays are quiet — the busiest-hours report should
    // show something a shopkeeper recognises.
    const salesToday = isSunday ? rand(2, 6) : isSaturday ? rand(14, 22) : rand(8, 16);

    for (let index = 0; index < salesToday; index += 1) {
      const soldAt = new Date(day);
      soldAt.setHours(pickHour(), rand(0, 59), rand(0, 59), 0);

      const lineCount = rand(1, 4);
      const chosen = new Map<string, number>();
      for (let line = 0; line < lineCount; line += 1) {
        const product = weighted[rand(0, weighted.length - 1)];
        chosen.set(product.id, (chosen.get(product.id) ?? 0) + rand(1, 3));
      }

      const items = [];
      let subtotal = 0n;
      let costTotal = 0n;

      for (const [productId, quantity] of chosen) {
        const product = products.find((entry) => entry.id === productId)!;
        const available = stockLevels.get(productId) ?? 0;
        // Restock when the shelf would go negative — a real shop reorders.
        if (product.trackStock && available < quantity) {
          const topUp = 60;
          stockLevels.set(productId, available + topUp);
          await prisma.stockMovement.create({
            data: {
              businessId: business.id,
              productId,
              userId: owner.id,
              type: StockMovementType.PURCHASE,
              quantity: topUp,
              balanceAfter: available + topUp,
              unitCost: product.costPrice,
              note: 'Restock from supplier',
              createdAt: soldAt,
            },
          });
        }

        const lineTotal = product.sellPrice * BigInt(quantity);
        subtotal += lineTotal;
        costTotal += product.costPrice * BigInt(quantity);
        items.push({
          productId,
          name: product.name,
          quantity,
          unitPrice: product.sellPrice,
          unitCost: product.costPrice,
          discount: 0n,
          total: lineTotal,
        });
        if (product.trackStock) {
          stockLevels.set(productId, (stockLevels.get(productId) ?? 0) - quantity);
        }
      }

      // Roughly one sale in twelve is on credit to a known customer.
      const onCredit = Math.random() < 0.08;
      const customer = onCredit ? customers[rand(0, customers.length - 1)] : null;
      const amountPaid = onCredit ? subtotal / 2n : subtotal;
      const method = onCredit
        ? PaymentMethod.CREDIT
        : Math.random() < 0.45
          ? PaymentMethod.MOMO
          : PaymentMethod.CASH;

      receiptNumber += 1;
      const sale = await prisma.sale.create({
        data: {
          businessId: business.id,
          userId: Math.random() < 0.6 ? cashier.id : owner.id,
          locationId,
          customerId: customer?.id ?? null,
          number: `RCP-${soldAt.getFullYear()}-${String(receiptNumber).padStart(4, '0')}`,
          subtotal,
          discount: 0n,
          tax: 0n,
          total: subtotal,
          costTotal,
          amountPaid,
          paymentMethod: method,
          status: amountPaid < subtotal ? SaleStatus.PARTIAL : SaleStatus.COMPLETED,
          soldAt,
          createdAt: soldAt,
          items: { create: items },
        },
      });

      await prisma.payment.create({
        data: {
          businessId: business.id,
          saleId: sale.id,
          customerId: customer?.id ?? null,
          amount: amountPaid,
          currency: 'RWF',
          method,
          status: PaymentStatus.SUCCESSFUL,
          paidAt: soldAt,
        },
      });

      if (customer && amountPaid < subtotal) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { balance: { increment: subtotal - amountPaid } },
        });
      }

      saleCounter += 1;
    }
  }

  // Write the simulated stock levels back so the low-stock report is truthful.
  for (const [productId, quantity] of stockLevels) {
    await prisma.product.update({
      where: { id: productId },
      data: { stockQty: Math.max(quantity, 0) },
    });
  }
  console.log(`  ${saleCounter} sales across ${MONTHS_OF_HISTORY} months`);

  // --- Expenses -----------------------------------------------------------
  let expenseCount = 0;
  for (let month = MONTHS_OF_HISTORY; month >= 0; month -= 1) {
    const when = new Date();
    when.setMonth(when.getMonth() - month);
    // Booked on the 1st. Dating them "some time in the first five days" put
    // rent and salaries on today's date, which is accurate but makes the demo
    // dashboard open on a large negative profit for today.
    when.setDate(1);

    for (const expense of EXPENSES) {
      if (!expense.monthly && Math.random() > 0.5) continue;
      const jitter = 1 + (Math.random() - 0.5) * 0.2;
      await prisma.expense.create({
        data: {
          businessId: business.id,
          userId: owner.id,
          locationId,
          category: expense.category,
          amount: BigInt(Math.round(expense.amount * jitter)),
          vendor: expense.vendor,
          method: PaymentMethod.CASH,
          spentAt: when,
        },
      });
      expenseCount += 1;
    }
  }
  console.log(`  ${expenseCount} expenses`);

  // --- An overdue invoice, so reminders have something to chase ------------
  const hotel = customers[2];
  const invoiceItems = products.slice(0, 3).map((product) => ({
    productId: product.id,
    name: product.name,
    quantity: 10,
    unitPrice: product.sellPrice,
    discount: 0n,
    total: product.sellPrice * 10n,
  }));
  const invoiceTotal = invoiceItems.reduce((acc, item) => acc + item.total, 0n);

  await prisma.invoice.create({
    data: {
      businessId: business.id,
      customerId: hotel.id,
      number: `INV-${new Date().getFullYear()}-0001`,
      status: InvoiceStatus.OVERDUE,
      subtotal: invoiceTotal,
      total: invoiceTotal,
      amountPaid: 0n,
      issueDate: daysFromNow(-40),
      dueDate: daysFromNow(-12),
      sentAt: daysFromNow(-40),
      notes: 'Monthly supply order.',
      terms: 'Payment due within 28 days.',
      items: { create: invoiceItems },
    },
  });
  await prisma.customer.update({
    where: { id: hotel.id },
    data: { balance: { increment: invoiceTotal } },
  });
  console.log('  1 overdue invoice');

  console.log('\nDone.\n');
  console.log('  Log in at http://localhost:5173');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}\n`);
}

/** Shop hours skew to a morning peak and a bigger evening peak. */
function pickHour(): number {
  const buckets = [7, 8, 8, 9, 9, 10, 11, 12, 12, 13, 14, 15, 16, 17, 17, 18, 18, 18, 19, 19, 20];
  return buckets[rand(0, buckets.length - 1)];
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
