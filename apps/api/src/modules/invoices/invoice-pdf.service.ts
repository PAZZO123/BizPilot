import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatMoney } from '@bizpilot/shared';
import { InvoicesService } from './invoices.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

const PAGE_MARGIN = 50;
const ACCENT = '#0F766E';
const INK = '#111827';
const MUTED = '#6B7280';
const RULE = '#E5E7EB';

/**
 * Renders an invoice as a PDF with pdfkit.
 *
 * Deliberately not a headless-browser render: Chromium costs ~300MB of RAM per
 * instance, which on Render's smaller plans is the difference between the API
 * staying up and being OOM-killed while a shop is trying to serve a customer.
 */
@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async render(businessId: string, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.invoices.findOne(businessId, invoiceId);
    const plan = await this.entitlements.planFor(businessId);
    const currency = invoice.business.currency;
    const money = (value: bigint) => formatMoney(Number(value), currency);

    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const pageWidth = doc.page.width - PAGE_MARGIN * 2;

    // --- Header -------------------------------------------------------------
    doc.fillColor(ACCENT).fontSize(22).font('Helvetica-Bold').text(invoice.business.name, PAGE_MARGIN, PAGE_MARGIN);

    const businessLines = [
      invoice.business.address,
      invoice.business.phone,
      invoice.business.email,
      invoice.business.taxId ? `TIN: ${invoice.business.taxId}` : null,
    ].filter(Boolean) as string[];

    doc.fillColor(MUTED).fontSize(9).font('Helvetica');
    businessLines.forEach((line) => doc.text(line, PAGE_MARGIN, doc.y, { width: pageWidth * 0.5 }));

    // Invoice meta, right-aligned against the header block.
    const metaTop = PAGE_MARGIN;
    doc
      .fillColor(INK)
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('INVOICE', PAGE_MARGIN, metaTop, { width: pageWidth, align: 'right' });

    doc.fontSize(10).font('Helvetica').fillColor(MUTED);
    const meta: [string, string][] = [
      ['Invoice no.', invoice.number],
      ['Issued', formatDate(invoice.issueDate)],
      ...(invoice.dueDate ? ([['Due', formatDate(invoice.dueDate)]] as [string, string][]) : []),
      ['Status', invoice.status],
    ];
    let metaY = metaTop + 28;
    for (const [label, value] of meta) {
      doc.fillColor(MUTED).text(label, PAGE_MARGIN, metaY, { width: pageWidth - 110, align: 'right' });
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .text(value, PAGE_MARGIN, metaY, { width: pageWidth, align: 'right' })
        .font('Helvetica');
      metaY += 14;
    }

    // --- Bill to ------------------------------------------------------------
    const billToY = Math.max(doc.y, metaY) + 24;
    doc.fillColor(MUTED).fontSize(9).text('BILL TO', PAGE_MARGIN, billToY);
    doc
      .fillColor(INK)
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(invoice.customer?.name ?? 'Walk-in customer', PAGE_MARGIN, doc.y + 2);

    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    [invoice.customer?.phone, invoice.customer?.email, invoice.customer?.address]
      .filter(Boolean)
      .forEach((line) => doc.text(line as string, PAGE_MARGIN, doc.y));

    // --- Line items ---------------------------------------------------------
    const columns = {
      description: PAGE_MARGIN,
      quantity: PAGE_MARGIN + pageWidth * 0.52,
      unitPrice: PAGE_MARGIN + pageWidth * 0.64,
      total: PAGE_MARGIN + pageWidth * 0.82,
    };
    const columnWidths = {
      description: pageWidth * 0.5,
      quantity: pageWidth * 0.1,
      unitPrice: pageWidth * 0.16,
      total: pageWidth * 0.18,
    };

    let y = doc.y + 24;
    doc.rect(PAGE_MARGIN, y - 6, pageWidth, 22).fill('#F3F4F6');
    doc.fillColor(INK).fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPTION', columns.description + 6, y, { width: columnWidths.description });
    doc.text('QTY', columns.quantity, y, { width: columnWidths.quantity, align: 'right' });
    doc.text('UNIT PRICE', columns.unitPrice, y, { width: columnWidths.unitPrice, align: 'right' });
    doc.text('TOTAL', columns.total, y, { width: columnWidths.total - 6, align: 'right' });

    y += 24;
    doc.font('Helvetica').fontSize(10);

    for (const item of invoice.items) {
      // Start a new page before a row would run off the bottom, and repeat
      // nothing — the totals block below re-anchors to whatever page it lands on.
      if (y > doc.page.height - 180) {
        doc.addPage();
        y = PAGE_MARGIN;
      }

      const descriptionHeight = doc.heightOfString(item.name, { width: columnWidths.description });

      doc.fillColor(INK).text(item.name, columns.description + 6, y, {
        width: columnWidths.description,
      });
      if (item.description) {
        doc
          .fillColor(MUTED)
          .fontSize(8)
          .text(item.description, columns.description + 6, doc.y, {
            width: columnWidths.description,
          })
          .fontSize(10);
      }

      doc.fillColor(INK);
      doc.text(String(item.quantity), columns.quantity, y, {
        width: columnWidths.quantity,
        align: 'right',
      });
      doc.text(money(item.unitPrice), columns.unitPrice, y, {
        width: columnWidths.unitPrice,
        align: 'right',
      });
      doc.text(money(item.total), columns.total, y, {
        width: columnWidths.total - 6,
        align: 'right',
      });

      y = Math.max(doc.y, y + descriptionHeight) + 10;
      doc.moveTo(PAGE_MARGIN, y - 4).lineTo(PAGE_MARGIN + pageWidth, y - 4).strokeColor(RULE).stroke();
    }

    // --- Totals -------------------------------------------------------------
    const balanceDue = invoice.total - invoice.amountPaid;
    const totalsX = PAGE_MARGIN + pageWidth * 0.55;
    const totalsWidth = pageWidth * 0.45;
    let totalsY = y + 10;

    const rows: [string, string, boolean][] = [
      ['Subtotal', money(invoice.subtotal), false],
      ...(invoice.discount > 0n
        ? ([['Discount', `-${money(invoice.discount)}`, false]] as [string, string, boolean][])
        : []),
      ...(invoice.tax > 0n ? ([['Tax', money(invoice.tax), false]] as [string, string, boolean][]) : []),
      ['Total', money(invoice.total), true],
      ...(invoice.amountPaid > 0n
        ? ([['Paid', `-${money(invoice.amountPaid)}`, false]] as [string, string, boolean][])
        : []),
      ['Balance due', money(balanceDue), true],
    ];

    for (const [label, value, emphasis] of rows) {
      doc
        .font(emphasis ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(emphasis ? 11 : 10)
        .fillColor(emphasis ? INK : MUTED)
        .text(label, totalsX, totalsY, { width: totalsWidth * 0.5 });
      doc
        .fillColor(emphasis ? ACCENT : INK)
        .text(value, totalsX, totalsY, { width: totalsWidth, align: 'right' });
      totalsY += emphasis ? 18 : 15;
    }

    // --- Notes and footer ---------------------------------------------------
    let footerY = totalsY + 20;
    if (invoice.notes) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Notes', PAGE_MARGIN, footerY);
      doc.font('Helvetica').fillColor(MUTED).text(invoice.notes, PAGE_MARGIN, doc.y + 2, {
        width: pageWidth * 0.5,
      });
      footerY = doc.y + 10;
    }
    if (invoice.terms) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Terms', PAGE_MARGIN, footerY);
      doc.font('Helvetica').fillColor(MUTED).text(invoice.terms, PAGE_MARGIN, doc.y + 2, {
        width: pageWidth * 0.5,
      });
    }

    // Free-plan invoices carry a small credit line. It is the cheapest
    // acquisition channel this product has: every invoice is seen by another
    // business owner.
    if (!plan.features.removeBranding) {
      doc
        .fontSize(8)
        .fillColor(MUTED)
        .text(
          'Created with BizPilot — free sales and stock tracking for small businesses.',
          PAGE_MARGIN,
          doc.page.height - PAGE_MARGIN - 10,
          { width: pageWidth, align: 'center' },
        );
    }

    doc.end();
    const buffer = await finished;

    return { buffer, filename: `${invoice.number}.pdf` };
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
