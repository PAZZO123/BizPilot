import PDFDocument from 'pdfkit';

/**
 * A thin layer over pdfkit for documents that are printed, filed and signed.
 *
 * pdfkit is a drawing API — it has no concept of a table, a page break inside a
 * table, or a footer. Every report would otherwise re-implement column maths and
 * get the pagination subtly wrong. This holds that logic once.
 *
 * Deliberately not a headless-browser render: Chromium costs ~300MB of RAM per
 * instance, which on Render's smaller plans is the difference between the API
 * staying up and being OOM-killed while a shop is serving a customer.
 */

export const PAGE_MARGIN = 50;

const ACCENT = '#0F766E';
const INK = '#111827';
const MUTED = '#6B7280';
const RULE = '#E5E7EB';
const HEAD_FILL = '#F3F4F6';
const ZEBRA = '#FAFAFA';

/** Reserved at the bottom of every page for the footer rule and page number. */
const FOOTER_RESERVE = 46;

export type Align = 'left' | 'right' | 'center';

export interface Column {
  header: string;
  /** Share of the table width, 0–1. The builder normalises these. */
  width: number;
  align?: Align;
}

export interface TableOptions {
  columns: Column[];
  rows: (string | { text: string; bold?: boolean })[][];
  /** Rendered in bold above a top rule, e.g. a totals line. */
  totalRow?: (string | { text: string; bold?: boolean })[];
  /** Shown instead of the table when `rows` is empty. */
  emptyText?: string;
  zebra?: boolean;
}

export interface Signatory {
  role: string;
  /** Printed under the line when known — an unnamed slot is filled in by hand. */
  name?: string | null;
}

export class PdfBuilder {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly finished: Promise<Buffer>;

  constructor() {
    // bufferPages lets us write "Page 1 of 4" — the total is not knowable until
    // the body is laid out, so footers are stamped at the end.
    this.doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
    this.doc.on('data', (chunk: Buffer) => this.chunks.push(chunk));
    this.finished = new Promise<Buffer>((resolve) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
    });
  }

  get contentWidth(): number {
    return this.doc.page.width - PAGE_MARGIN * 2;
  }

  private get bottomLimit(): number {
    return this.doc.page.height - PAGE_MARGIN - FOOTER_RESERVE;
  }

  /** Starts a new page if `needed` points would overflow into the footer. */
  ensureSpace(needed: number): void {
    if (this.doc.y + needed > this.bottomLimit) {
      this.doc.addPage();
    }
  }

  /**
   * Report masthead: who produced it, what it is, and over what period. The
   * period matters more than it looks — a printed report with no date range on
   * it is unfilable.
   */
  header(options: {
    businessName: string;
    businessLines?: (string | null | undefined)[];
    title: string;
    subtitle?: string;
    meta?: [string, string][];
  }): void {
    const { doc } = this;
    const width = this.contentWidth;

    doc
      .fillColor(ACCENT)
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(options.businessName, PAGE_MARGIN, PAGE_MARGIN, { width: width * 0.55 });

    const lines = (options.businessLines ?? []).filter(Boolean) as string[];
    doc.fillColor(MUTED).fontSize(9).font('Helvetica');
    lines.forEach((line) => doc.text(line, PAGE_MARGIN, doc.y, { width: width * 0.55 }));
    const leftBottom = doc.y;

    doc
      .fillColor(INK)
      .fontSize(15)
      .font('Helvetica-Bold')
      .text(options.title.toUpperCase(), PAGE_MARGIN, PAGE_MARGIN, { width, align: 'right' });

    let metaY = PAGE_MARGIN + 22;
    if (options.subtitle) {
      doc
        .fillColor(MUTED)
        .fontSize(10)
        .font('Helvetica')
        .text(options.subtitle, PAGE_MARGIN, metaY, { width, align: 'right' });
      metaY = doc.y + 4;
    }

    doc.fontSize(9);
    for (const [label, value] of options.meta ?? []) {
      doc.fillColor(MUTED).font('Helvetica').text(`${label}  `, PAGE_MARGIN, metaY, {
        width: width - 130,
        align: 'right',
      });
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .text(value, PAGE_MARGIN, metaY, { width, align: 'right' });
      metaY += 13;
    }

    const y = Math.max(leftBottom, metaY) + 10;
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + width, y).strokeColor(ACCENT).lineWidth(1.5).stroke();
    doc.lineWidth(1);
    doc.y = y + 18;
  }

  sectionTitle(text: string, note?: string): void {
    this.ensureSpace(60);
    const { doc } = this;
    doc.fillColor(INK).fontSize(11).font('Helvetica-Bold').text(text, PAGE_MARGIN, doc.y);
    if (note) {
      doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(note, PAGE_MARGIN, doc.y + 1);
    }
    doc.y += 8;
  }

  /**
   * A table that paginates. The header row is redrawn on every page it spills
   * onto, because a column of numbers with no headings on page three is useless
   * to whoever is reading the printout.
   */
  table(options: TableOptions): void {
    const { doc } = this;
    const width = this.contentWidth;

    if (!options.rows.length) {
      doc
        .fillColor(MUTED)
        .fontSize(10)
        .font('Helvetica-Oblique')
        .text(options.emptyText ?? 'Nothing to report for this period.', PAGE_MARGIN, doc.y);
      doc.y += 12;
      return;
    }

    const total = options.columns.reduce((sum, column) => sum + column.width, 0);
    const widths = options.columns.map((column) => (column.width / total) * width);
    const offsets = widths.reduce<number[]>((acc, columnWidth, index) => {
      acc.push(index === 0 ? PAGE_MARGIN : acc[index - 1] + widths[index - 1]);
      return acc;
    }, []);

    const PAD = 6;
    const drawHead = () => {
      const top = doc.y;
      doc.rect(PAGE_MARGIN, top, width, 20).fill(HEAD_FILL);
      doc.fillColor(INK).fontSize(8.5).font('Helvetica-Bold');
      options.columns.forEach((column, index) => {
        doc.text(column.header.toUpperCase(), offsets[index] + PAD, top + 6, {
          width: widths[index] - PAD * 2,
          align: column.align ?? 'left',
          lineBreak: false,
        });
      });
      doc.y = top + 20;
    };

    this.ensureSpace(60);
    drawHead();

    const cellText = (cell: string | { text: string; bold?: boolean }) =>
      typeof cell === 'string' ? cell : cell.text;
    const cellBold = (cell: string | { text: string; bold?: boolean }) =>
      typeof cell === 'string' ? false : cell.bold === true;

    doc.fontSize(9.5);
    options.rows.forEach((row, rowIndex) => {
      // Measure before drawing so a tall wrapped cell decides the row height,
      // not whichever column happens to be drawn last.
      const heights = row.map((cell, index) =>
        doc
          .font(cellBold(cell) ? 'Helvetica-Bold' : 'Helvetica')
          .heightOfString(cellText(cell), { width: widths[index] - PAD * 2 }),
      );
      const rowHeight = Math.max(...heights, 12) + 9;

      if (doc.y + rowHeight > this.bottomLimit) {
        doc.addPage();
        drawHead();
        doc.fontSize(9.5);
      }

      const top = doc.y;
      if (options.zebra !== false && rowIndex % 2 === 1) {
        doc.rect(PAGE_MARGIN, top, width, rowHeight).fill(ZEBRA);
      }

      row.forEach((cell, index) => {
        doc
          .fillColor(INK)
          .font(cellBold(cell) ? 'Helvetica-Bold' : 'Helvetica')
          .text(cellText(cell), offsets[index] + PAD, top + 5, {
            width: widths[index] - PAD * 2,
            align: options.columns[index]?.align ?? 'left',
          });
      });

      doc.y = top + rowHeight;
      doc
        .moveTo(PAGE_MARGIN, doc.y)
        .lineTo(PAGE_MARGIN + width, doc.y)
        .strokeColor(RULE)
        .stroke();
    });

    if (options.totalRow) {
      const rowHeight = 22;
      if (doc.y + rowHeight > this.bottomLimit) {
        doc.addPage();
        drawHead();
      }
      const top = doc.y;
      doc
        .moveTo(PAGE_MARGIN, top)
        .lineTo(PAGE_MARGIN + width, top)
        .strokeColor(INK)
        .lineWidth(1)
        .stroke();
      doc.fillColor(INK).fontSize(10).font('Helvetica-Bold');
      options.totalRow.forEach((cell, index) => {
        doc.text(cellText(cell), offsets[index] + PAD, top + 6, {
          width: widths[index] - PAD * 2,
          align: options.columns[index]?.align ?? 'left',
        });
      });
      doc.y = top + rowHeight;
    }

    doc.y += 14;
  }

  /** Label/value pairs — a summary block where a table would be overkill. */
  keyValues(rows: [string, string, boolean?][]): void {
    const { doc } = this;
    const width = this.contentWidth;

    for (const [label, value, emphasis] of rows) {
      this.ensureSpace(20);
      const top = doc.y;
      if (emphasis) {
        doc.moveTo(PAGE_MARGIN, top).lineTo(PAGE_MARGIN + width, top).strokeColor(RULE).stroke();
      }
      doc
        .fillColor(emphasis ? INK : MUTED)
        .fontSize(emphasis ? 11 : 10)
        .font(emphasis ? 'Helvetica-Bold' : 'Helvetica')
        .text(label, PAGE_MARGIN, top + (emphasis ? 6 : 2), { width: width * 0.6 });
      doc
        .fillColor(emphasis ? ACCENT : INK)
        .font('Helvetica-Bold')
        .text(value, PAGE_MARGIN, top + (emphasis ? 6 : 2), { width, align: 'right' });
      doc.y = top + (emphasis ? 26 : 17);
    }
    doc.y += 6;
  }

  /**
   * A blank line for something to be written in by hand — a counted cash total,
   * a correction. Printed reports get annotated; leaving room for it is the
   * difference between a report and a form.
   */
  fillInLine(label: string, hint?: string): void {
    this.ensureSpace(34);
    const { doc } = this;
    const width = this.contentWidth;
    const top = doc.y;

    doc.fillColor(INK).fontSize(10).font('Helvetica').text(label, PAGE_MARGIN, top + 4, {
      width: width * 0.45,
    });
    doc
      .moveTo(PAGE_MARGIN + width * 0.5, top + 16)
      .lineTo(PAGE_MARGIN + width, top + 16)
      .strokeColor(INK)
      .stroke();
    if (hint) {
      doc
        .fillColor(MUTED)
        .fontSize(7.5)
        .text(hint, PAGE_MARGIN + width * 0.5, top + 19, { width: width * 0.5 });
    }
    doc.y = top + 32;
  }

  /**
   * Signature blocks, side by side.
   *
   * Kept together on one page on purpose: a signature page with nothing above it
   * proves nothing, and is trivially attached to a different report. If they
   * will not fit under the content, the whole block moves to the next page
   * along with a reminder of which report it belongs to.
   */
  signatures(signatories: Signatory[], reportRef?: string): void {
    const { doc } = this;
    const width = this.contentWidth;
    const blockHeight = 96;

    if (doc.y + blockHeight + 30 > this.bottomLimit) {
      doc.addPage();
      if (reportRef) {
        doc
          .fillColor(MUTED)
          .fontSize(9)
          .font('Helvetica-Oblique')
          .text(`Continued — ${reportRef}`, PAGE_MARGIN, doc.y);
        doc.y += 14;
      }
    } else {
      doc.y += 16;
    }

    const top = doc.y;
    const columnWidth = width / signatories.length;

    signatories.forEach((signatory, index) => {
      const x = PAGE_MARGIN + columnWidth * index;
      const inner = columnWidth - 20;

      doc
        .fillColor(MUTED)
        .fontSize(8.5)
        .font('Helvetica-Bold')
        .text(signatory.role.toUpperCase(), x, top, { width: inner });

      // Name above the rule when we know it, so the signature is attributable
      // even when the handwriting is not.
      doc
        .fillColor(INK)
        .fontSize(10)
        .font('Helvetica')
        .text(signatory.name ?? '', x, top + 16, { width: inner });

      doc.moveTo(x, top + 46).lineTo(x + inner, top + 46).strokeColor(INK).stroke();
      doc.fillColor(MUTED).fontSize(8).text('Signature', x, top + 50, { width: inner });

      doc.moveTo(x, top + 78).lineTo(x + inner, top + 78).strokeColor(INK).stroke();
      doc.fillColor(MUTED).fontSize(8).text('Date', x, top + 82, { width: inner });
    });

    doc.y = top + blockHeight;
  }

  /** Cuts a string to fit `maxWidth` at the current font, ending in an ellipsis. */
  private truncateToWidth(text: string, maxWidth: number): string {
    if (this.doc.widthOfString(text) <= maxWidth) return text;
    let cut = text;
    while (cut.length > 1 && this.doc.widthOfString(`${cut}…`) > maxWidth) {
      cut = cut.slice(0, -1);
    }
    return `${cut.trimEnd()}…`;
  }

  paragraph(text: string, options?: { muted?: boolean; italic?: boolean; size?: number }): void {
    this.ensureSpace(30);
    const { doc } = this;
    doc
      .fillColor(options?.muted ? MUTED : INK)
      .fontSize(options?.size ?? 9.5)
      .font(options?.italic ? 'Helvetica-Oblique' : 'Helvetica')
      .text(text, PAGE_MARGIN, doc.y, { width: this.contentWidth });
    doc.y += 8;
  }

  /**
   * Stamps every page with a footer, then closes the document.
   *
   * "Page 2 of 5" is what makes a printed report auditable — a reader can tell a
   * page is missing. `generatedAt` and the branding line go here too so they are
   * on every sheet, not only the first.
   */
  async finalise(footer: { left: string; generatedAt: Date; branding?: string }): Promise<Buffer> {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    const width = this.contentWidth;

    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      const y = doc.page.height - PAGE_MARGIN - 22;

      doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + width, y).strokeColor(RULE).stroke();
      doc.fillColor(MUTED).fontSize(8).font('Helvetica');

      // All three run on one baseline across the full width, so the left string
      // has to be cut to its third or it draws straight through the centred one.
      const centre = [
        `Generated ${footer.generatedAt.toISOString().slice(0, 16).replace('T', ' ')}`,
        footer.branding,
      ]
        .filter(Boolean)
        .join(' · ');

      doc.text(this.truncateToWidth(footer.left, width / 3 - 8), PAGE_MARGIN, y + 6, {
        width: width / 3,
        lineBreak: false,
      });
      doc.text(centre, PAGE_MARGIN, y + 6, { width, align: 'center', lineBreak: false });
      doc.text(`Page ${index + 1} of ${range.count}`, PAGE_MARGIN, y + 6, {
        width,
        align: 'right',
        lineBreak: false,
      });
    }

    doc.end();
    return this.finished;
  }
}
