import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";

/**
 * Turning a described document into a PDF.
 *
 * Deliberately split from *what* goes in the report. This file knows about
 * pages, fonts and columns; the caller knows about money and periods. When the
 * required format arrives, it changes there and nothing here moves — and if
 * PDFKit is ever swapped for something else, the reverse holds.
 *
 * PDFKit rather than headless Chrome: the API runs on a small instance, and a
 * Chromium download per deploy to render one page of figures is a poor trade.
 * Vector text and shapes also come out sharp at any zoom, which a screenshot
 * of a web page does not.
 */

export type PdfBlock =
  | { kind: "heading"; text: string }
  | { kind: "note"; text: string }
  | {
      /** Three or four figures across, the way the screen shows them. */
      kind: "stats";
      items: Array<{ label: string; value: string; hint?: string }>;
    }
  | {
      kind: "table";
      columns: Array<{
        header: string;
        width: number;
        align?: "left" | "right";
      }>;
      rows: string[][];
      total?: string[];
    }
  | {
      /** Horizontal bars — a shape, not a chart library. */
      kind: "bars";
      items: Array<{ label: string; value: string; fraction: number }>;
    }
  | { kind: "spacer"; height: number };

export type PdfDocumentSpec = {
  title: string;
  subtitle: string[];
  /** Bottom-left of every page. Says who generated it and when. */
  footer: string;
  blocks: PdfBlock[];
};

const PAGE = { size: "A4" as const, margin: 42 };

/**
 * PDFKit's built-in fonts are Latin-1. Anything outside it — the taka sign,
 * the typographic minus this app uses everywhere, a Bengali word that came
 * through in a description — renders as mojibake rather than failing, which is
 * worse: "৳18,700 not yet deposited" came out as "Y3bÃ3 à v—F††VÆB".
 *
 * Every string drawn goes through here, in the drawing code rather than at the
 * call sites, so a new block type cannot reintroduce it.
 */
function latin(text: string): string {
  const swaps: Record<string, string> = {
    "−": "-", // minus sign
    "–": "-", // en dash
    "—": "-", // em dash
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "৳": "", // taka sign; the currency is stated in the heading
  };

  let out = "";
  for (const character of text) {
    const swapped = swaps[character];
    if (swapped !== undefined) {
      out += swapped;
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    // Printable Latin-1 is all Helvetica can draw. Anything else becomes a
    // space rather than a wrong glyph.
    out += code >= 0x20 && code <= 0xff ? character : " ";
  }

  return out.replace(/\s+/g, " ").trim();
}

/**
 * Cut to fit the space actually available, measured in the font about to draw
 * it.
 *
 * PDFKit's own `ellipsis` option only applies when it decides the text
 * overflows, which it does not always do with `lineBreak: false` — the result
 * was "Hardware & equipment" spilling onto a second line and overlapping the
 * row beneath it. Counting characters is not enough either: at 8.5pt Helvetica
 * a run of capitals is half again as wide as the same number of lowercase.
 */
function fit(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;

  let cut = text;
  while (cut.length > 1 && doc.widthOfString(cut + "..") > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut.trimEnd() + "..";
}

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const ACCENT = "#4f46e5";
const POSITIVE = "#047857";
const NEGATIVE = "#b91c1c";

@Injectable()
export class PdfService {
  /** Resolves to the finished file. */
  build(spec: PdfDocumentSpec): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        ...PAGE,
        bufferPages: true,
        info: { Title: spec.title, Creator: "ShareViral Finance Management" },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const width = doc.page.width - PAGE.margin * 2;

      /* --- masthead ---------------------------------------------------- */
      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor(INK)
        .text(latin(spec.title), { width });

      for (const line of spec.subtitle) {
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor(MUTED)
          .text(latin(line), { width });
      }

      doc
        .moveDown(0.6)
        .moveTo(PAGE.margin, doc.y)
        .lineTo(PAGE.margin + width, doc.y)
        .lineWidth(0.8)
        .strokeColor(ACCENT)
        .stroke()
        .moveDown(0.8);

      /* --- body -------------------------------------------------------- */
      for (const block of spec.blocks) {
        this.renderBlock(doc, block, width);
      }

      /* --- footer on every page ---------------------------------------- */
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        // Writing below the bottom margin makes PDFKit start a new page — and
        // then that page needs a footer too. Four blank pages came from
        // exactly this.
        doc.page.margins.bottom = 0;
        const y = doc.page.height - PAGE.margin + 8;
        doc
          .font("Helvetica")
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(latin(spec.footer), PAGE.margin, y, {
            width: width * 0.75,
            lineBreak: false,
          })
          .text(`${i + 1} of ${range.count}`, PAGE.margin + width * 0.75, y, {
            width: width * 0.25,
            align: "right",
          });
      }

      doc.end();
    });
  }

  /* ---------------------------------------------------------------------- */

  private renderBlock(
    doc: PDFKit.PDFDocument,
    block: PdfBlock,
    width: number,
  ): void {
    switch (block.kind) {
      case "spacer":
        doc.moveDown(block.height);
        return;

      case "heading":
        this.keepTogether(doc, 40);
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor(INK)
          .text(latin(block.text), PAGE.margin, doc.y, { width })
          .moveDown(0.35);
        return;

      case "note":
        doc
          .font("Helvetica-Oblique")
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(latin(block.text), PAGE.margin, doc.y, { width })
          .moveDown(0.5);
        return;

      case "stats":
        this.renderStats(doc, block.items, width);
        return;

      case "table":
        this.renderTable(doc, block, width);
        return;

      case "bars":
        this.renderBars(doc, block.items, width);
        return;
    }
  }

  /**
   * Figures in boxes, four across.
   *
   * Boxed rather than listed because this is the part somebody reads first and
   * a run of same-weight lines has no first.
   */
  private renderStats(
    doc: PDFKit.PDFDocument,
    items: Extract<PdfBlock, { kind: "stats" }>["items"],
    width: number,
  ): void {
    const perRow = 4;
    const gap = 8;
    const boxWidth = (width - gap * (perRow - 1)) / perRow;
    const boxHeight = 52;

    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow);
      this.keepTogether(doc, boxHeight + 10);
      const top = doc.y;

      row.forEach((item, column) => {
        const x = PAGE.margin + column * (boxWidth + gap);

        doc
          .roundedRect(x, top, boxWidth, boxHeight, 4)
          .lineWidth(0.7)
          .strokeColor(RULE)
          .stroke();

        doc
          .font("Helvetica")
          .fontSize(7)
          .fillColor(MUTED)
          .text(latin(item.label).toUpperCase(), x + 8, top + 8, {
            width: boxWidth - 16,
            characterSpacing: 0.4,
          });

        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor(
            item.value.trim().startsWith("−") ||
              item.value.trim().startsWith("-")
              ? NEGATIVE
              : INK,
          )
          .text(fit(doc, latin(item.value), boxWidth - 16), x + 8, top + 21, {
            width: boxWidth - 16,
            lineBreak: false,
            ellipsis: true,
          });

        if (item.hint) {
          doc
            .font("Helvetica")
            .fontSize(7)
            .fillColor(MUTED)
            .text(fit(doc, latin(item.hint), boxWidth - 16), x + 8, top + 38, {
              width: boxWidth - 16,
              lineBreak: false,
              ellipsis: true,
            });
        }
      });

      doc.y = top + boxHeight + gap;
    }

    doc.x = PAGE.margin;
    doc.moveDown(0.4);
  }

  private renderTable(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfBlock, { kind: "table" }>,
    width: number,
  ): void {
    const totalUnits = block.columns.reduce((sum, c) => sum + c.width, 0);
    const widths = block.columns.map((c) => (c.width / totalUnits) * width);
    const rowHeight = 16;

    const header = () => {
      const top = doc.y;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
      let x = PAGE.margin;
      block.columns.forEach((column, i) => {
        doc.text(
          fit(doc, latin(column.header).toUpperCase(), widths[i] - 6),
          x,
          top,
          {
            width: widths[i] - 6,
            align: column.align ?? "left",
            lineBreak: false,
            ellipsis: true,
          },
        );
        x += widths[i];
      });
      doc
        .moveTo(PAGE.margin, top + 11)
        .lineTo(PAGE.margin + width, top + 11)
        .lineWidth(0.6)
        .strokeColor(RULE)
        .stroke();
      doc.y = top + 15;
    };

    this.keepTogether(doc, rowHeight * 3);
    header();

    for (const row of block.rows) {
      // A row split across a page break is a row nobody can read. Start the
      // next page and repeat the headings instead.
      if (doc.y + rowHeight > doc.page.height - PAGE.margin - 14) {
        doc.addPage();
        header();
      }

      const top = doc.y;
      doc.font("Helvetica").fontSize(8.5).fillColor(INK);
      let x = PAGE.margin;
      row.forEach((cell, i) => {
        const value = cell ?? "";
        doc
          .fillColor(
            value.trim().startsWith("−") || value.trim().startsWith("-")
              ? NEGATIVE
              : INK,
          )
          .text(fit(doc, latin(value), widths[i] - 6), x, top, {
            width: widths[i] - 6,
            align: block.columns[i]?.align ?? "left",
            lineBreak: false,
            ellipsis: true,
          });
        x += widths[i];
      });
      doc.y = top + rowHeight;
    }

    if (block.total) {
      const top = doc.y;
      doc
        .moveTo(PAGE.margin, top)
        .lineTo(PAGE.margin + width, top)
        .lineWidth(0.6)
        .strokeColor(RULE)
        .stroke();

      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK);
      let x = PAGE.margin;
      block.total.forEach((cell, i) => {
        doc.text(fit(doc, latin(cell ?? ""), widths[i] - 6), x, top + 5, {
          width: widths[i] - 6,
          align: block.columns[i]?.align ?? "left",
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[i];
      });
      doc.y = top + 5 + rowHeight;
    }

    doc.x = PAGE.margin;
    doc.moveDown(0.6);
  }

  private renderBars(
    doc: PDFKit.PDFDocument,
    items: Array<{ label: string; value: string; fraction: number }>,
    width: number,
  ): void {
    const labelWidth = width * 0.34;
    const valueWidth = width * 0.2;
    const barWidth = width - labelWidth - valueWidth - 12;

    for (const item of items) {
      this.keepTogether(doc, 20);
      const top = doc.y;

      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(INK)
        .text(fit(doc, latin(item.label), labelWidth - 6), PAGE.margin, top, {
          width: labelWidth - 6,
          lineBreak: false,
          ellipsis: true,
        });

      const barX = PAGE.margin + labelWidth;
      doc
        .roundedRect(barX, top + 2, barWidth, 6, 3)
        .fillColor(RULE)
        .fill();

      const filled = Math.max(
        2,
        Math.min(barWidth, barWidth * Math.max(0, Math.min(1, item.fraction))),
      );
      doc
        .roundedRect(barX, top + 2, filled, 6, 3)
        .fillColor(ACCENT)
        .fill();

      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor(INK)
        .text(latin(item.value), barX + barWidth + 12, top, {
          width: valueWidth,
          align: "right",
          lineBreak: false,
        });

      doc.y = top + 16;
    }

    doc.x = PAGE.margin;
    doc.moveDown(0.4);
  }

  /** Starts a new page rather than orphaning a heading at the bottom of one. */
  private keepTogether(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed > doc.page.height - PAGE.margin - 14) {
      doc.addPage();
    }
  }
}

export { POSITIVE as PDF_POSITIVE, NEGATIVE as PDF_NEGATIVE };
