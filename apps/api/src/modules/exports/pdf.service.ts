import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Injectable, Logger } from "@nestjs/common";
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
 *
 * There are two documents in here, sharing the drawing primitives:
 *
 * `build` produces the plain internal report — a masthead, then blocks flowing
 * down as many pages as they need. `buildPages` produces the *statement*, which
 * is a designed document: each page is composed rather than flowed, the cover
 * and the closing page are full-bleed, and only the ledgers are allowed to run
 * on. The two share `drawable`, `fit`, the palettes and the footer pass; they
 * do not share a block vocabulary, because a section heading in one is an 11pt
 * bold line and in the other is a 28pt numeral beside tracked small caps.
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

/* ========================================================================== */
/*  The face                                                                   */
/* ========================================================================== */

/**
 * The document's typeface, bundled with the API.
 *
 * PDFKit's fourteen built-in fonts are Latin-1, and the one character a
 * Bangladeshi financial report cannot do without — ৳ — is not in it. Neither is
 * the typographic minus (U+2212) that `formatMoney` writes. Drawn in Helvetica
 * they came out as mojibake: "৳18,700 not yet deposited" printed as
 * "Y3bÃ3 à v—F††VÆB". Stripping them instead, which is what this file used to
 * do, printed a company's accounts with no currency symbol at all.
 *
 * So the face is embedded. **Noto Sans Bengali**, SIL Open Font License 1.1 —
 * redistributable, and `OFL.txt` sits beside the files. A Windows system font
 * (Nirmala UI, Vrinda) would be neither: the API deploys to Linux, where they
 * do not exist, and their licence does not permit shipping them.
 *
 * Two weights, subset to what the reports draw — Latin, Latin-1, Latin
 * Extended-A, the typographic punctuation, ৳ and −. 36 KB each, against 180 KB
 * for the full upstream files. Rebuild them with:
 *
 *     pyftsubset NotoSansBengali-Regular.ttf \
 *       --output-file=NotoSansBengali-Regular.ttf \
 *       --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013,U+2014,\
 *         U+2018-201A,U+201C-201E,U+2022,U+2026,U+2030,U+2039,U+203A,U+2044,\
 *         U+2212,U+20AC,U+09F3" \
 *       --layout-features='*' --name-IDs='*' --name-legacy --notdef-outline
 *
 * and then reset `hhea`/`OS/2` to Helvetica's vertical metrics — ascender 718,
 * descender −207, line gap 231. That last step is not cosmetic. PDFKit places
 * a baseline at `y + ascender × size`, so a face whose ascender is 917 (Noto's,
 * sized for Bengali headroom this subset no longer carries) drops every figure
 * on every composed page by a fifth of its point size and opens the leading of
 * every paragraph by 15%. Matching the metrics the layout was drawn against
 * keeps the geometry and changes only the glyphs.
 */
const FONT_DIR = "fonts";
const FONT_FILES = {
  regular: "NotoSansBengali-Regular.ttf",
  bold: "NotoSansBengali-Bold.ttf",
} as const;

/** What the drawing code asks for; what they resolve to is decided below. */
const BODY = "sfm-body";
const BOLD = "sfm-bold";

/**
 * Where the files are, in dev and in production.
 *
 * `__dirname` is `src/modules/exports` under ts-node and `dist/modules/exports`
 * after `nest build`, so the same relative path answers both — *provided* the
 * build copies them, which is what the `assets` entry in `nest-cli.json` is
 * for. The second candidate is the belt to that braces: if the assets step is
 * ever dropped, the built server still finds the face in the source tree rather
 * than silently printing a report with no currency on it.
 */
const FONT_CANDIDATES = [
  join(__dirname, FONT_DIR),
  join(__dirname, "..", "..", "..", "src", "modules", "exports", FONT_DIR),
];

type Faces = { regular: Buffer; bold: Buffer };

function loadFaces(): Faces | null {
  for (const directory of FONT_CANDIDATES) {
    try {
      return {
        regular: readFileSync(join(directory, FONT_FILES.regular)),
        bold: readFileSync(join(directory, FONT_FILES.bold)),
      };
    } catch {
      continue;
    }
  }

  new Logger("PdfService").error(
    `No report face found in ${FONT_CANDIDATES.join(" or ")} — reports will ` +
      `fall back to Helvetica and print amounts without the taka sign. Check ` +
      `the assets entry in nest-cli.json copied the fonts into dist.`,
  );
  return null;
}

const FACES = loadFaces();

/**
 * Turns false, for the rest of the process, if the bundled face cannot be used.
 *
 * A missing or unreadable font must not take the export down with it: the
 * document falls back to Helvetica and to stripping what Helvetica cannot draw,
 * which is a worse report but still a true one.
 */
let embedded = FACES !== null;

/** "0020-007E A0-A3 09F3" — hex code points, singly or in ranges. */
function ranges(spec: string): ReadonlyArray<readonly [number, number]> {
  return spec.split(" ").map((part) => {
    const [from, to] = part.split("-");
    return [parseInt(from, 16), parseInt(to ?? from, 16)] as const;
  });
}

/**
 * What the bundled subset can actually draw, read off its own cmap.
 *
 * Not the list asked for above: `pyftsubset` keeps what it is asked for *and
 * finds*, and Noto Sans Bengali's Latin is not a complete Latin Extended-A.
 * Stating the real coverage rather than the request is what makes an uncovered
 * code point come out as a space instead of an empty box — so if the subset is
 * ever rebuilt, regenerate this from the built files, not from the argument.
 */
const COVERED = ranges(
  "0020-007E A0-A3 A5 A7-AB AE-B0 B4 B6-B8 BA-BB BF-0107 010A-0113 " +
    "0116-011B 011E-0123 0126-0127 012A-012B 012E-0131 0136-0137 0139-013E " +
    "0141-0148 0150-0155 0158-015B 015E-0161 0164-0165 016A-016B 016E-017E " +
    "09F3 2013-2014 2018-201A 201C-201E 2022 2026 2039-203A 20AC 2212",
);

/** Printable Latin-1 — all a built-in font can draw, when it comes to that. */
const LATIN1 = ranges("0020-00FF");

/**
 * The last resort for a code point the face in use genuinely lacks.
 *
 * With the subset embedded none of these are reached — it has ৳, −, the dashes
 * and the curly quotes. They are what the Helvetica fallback uses, and they are
 * kept for it: a hyphen for a minus reads as a minus, where `−` in Helvetica
 * reads as garbage.
 */
const SUBSTITUTES: Record<string, string> = {
  /*
   * The subset has no arrow, and an undrawable character becomes a SPACE — so
   * "05/05/2026 → 05/09/2026" printed as "05/05/2026 05/09/2026" on every
   * bank statement, a range with nothing between its ends. A hyphen rather
   * than an en dash because this map's output is emitted as-is: the Helvetica
   * fallback is Latin-1 and has no en dash either.
   */
  "→": "-", // rightwards arrow
  "−": "-", // minus sign
  "–": "-", // en dash
  "—": "-", // em dash
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "৳": "", // taka sign; the currency is stated in the heading instead
};

/**
 * Every string drawn goes through here, in the drawing code rather than at the
 * call sites, so a new block type cannot reintroduce mojibake.
 */
function drawable(text: string): string {
  const covered = embedded ? COVERED : LATIN1;

  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (covered.some(([from, to]) => code >= from && code <= to)) {
      out += character;
      continue;
    }
    // Anything the face cannot draw becomes its substitute, or a space —
    // never a wrong glyph and never an empty box.
    out += SUBSTITUTES[character] ?? " ";
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
 * row beneath it. Counting characters is not enough either: at 8.5pt a run of
 * capitals is half again as wide as the same number of lowercase.
 */
function fit(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number,
  options?: { characterSpacing?: number },
): string {
  if (doc.widthOfString(text, options) <= maxWidth) return text;

  let cut = text;
  while (cut.length > 1 && doc.widthOfString(cut + "..", options) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut.trimEnd() + "..";
}

/**
 * The largest size at which the text still fits, down to a floor.
 *
 * A label may be cut; an amount may not. "৳3,162,2.." on a closing balance is
 * not a shortened figure, it is a wrong one, and a reader has no way to tell
 * which digits went missing. Money is set smaller instead — which is what the
 * ৳ sign cost the widest figures when it went back on them.
 *
 * Advance widths scale linearly with point size, so the fitting size is one
 * division rather than a search. Sets the size on the document and returns it;
 * the font must already be selected, or the measurement is of the wrong face.
 */
function sized(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number,
  size: number,
  /**
   * Two thirds, because a complete figure at 11pt beats a cut one at 16.5pt.
   * Only the closing position — bank and card in one cell — ever goes near it.
   */
  floor = size * 0.66,
): number {
  doc.fontSize(size);
  const width = doc.widthOfString(text);
  if (width <= maxWidth || width <= 0) return size;

  const fitted = Math.max(floor, (size * maxWidth) / width);
  doc.fontSize(fitted);
  return fitted;
}

/**
 * One size for a row of figures, so they share a baseline.
 *
 * Shrinking each cell to its own width would step the figures against each
 * other, and a ruled row of numbers at three different sizes reads as three
 * different kinds of number.
 */
function sharedScale(
  doc: PDFKit.PDFDocument,
  items: Array<{ text: string; size: number; width: number }>,
  floor = 0.72,
): number {
  let scale = 1;
  for (const item of items) {
    doc.fontSize(item.size);
    const width = doc.widthOfString(item.text);
    if (width > item.width) scale = Math.min(scale, item.width / width);
  }
  return Math.max(floor, scale);
}

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const ACCENT = "#4f46e5";
const POSITIVE = "#047857";
const NEGATIVE = "#b91c1c";

/* ========================================================================== */
/*  The statement                                                              */
/* ========================================================================== */

/**
 * The statement's two grounds.
 *
 * Read off the document this replaces rather than invented: the cover and the
 * closing page are printed on the dark green, everything between on the cream.
 * A block does not know which it is on — it asks the palette — so the same
 * table renders correctly on either.
 */
export type PdfTheme = "cream" | "dark";

type Palette = {
  page: string;
  panel: string;
  /** Headlines and figures. */
  ink: string;
  /** Running prose. */
  body: string;
  /** Detail lines under a label. */
  muted: string;
  /** Tracked small caps: eyebrows, column headings, footers. */
  faint: string;
  rule: string;
  panelRule: string;
  /** Money coming in, and money going out. */
  in: string;
  out: string;
};

const PALETTES: Record<PdfTheme, Palette> = {
  cream: {
    page: "#efede4",
    panel: "#fbfaf5",
    ink: "#123026",
    body: "#43433a",
    muted: "#6f6c61",
    faint: "#8c8a7d",
    rule: "#dcd9cc",
    panelRule: "#e3e1d6",
    in: "#1e4a37",
    out: "#b08968",
  },
  dark: {
    page: "#123026",
    panel: "#17392c",
    ink: "#efede4",
    body: "#dfe6dd",
    muted: "#93ab9e",
    faint: "#8aa295",
    rule: "#415c50",
    panelRule: "#38534a",
    in: "#9dc0a7",
    out: "#cfa482",
  },
};

/** The chart ramp, darkest first — the order shares are drawn in. */
const SERIES = [
  "#1e4a37",
  "#3e7d5a",
  "#5e8b6f",
  "#8cae97",
  "#b9cfbe",
  "#d3e0d5",
];

/* --- the sheet, in points -------------------------------------------------- */

const SHEET = { width: 595.28, height: 841.89 };
const MARGIN = 61;
const CONTENT = SHEET.width - MARGIN * 2;
/** Two boxes across, with the gap the sample uses. */
const BOX_GAP = 11.4;
const BOX_WIDTH = (CONTENT - BOX_GAP) / 2;

/**
 * The signature grid on the closing page: two across, two down, four in all —
 * which is the most signatories a statement may carry.
 */
const SIGN_GRID = { columns: 2, rows: 2 };

/**
 * Where the parts of one signature box sit, measured from its own top.
 *
 * Named rather than sprinkled through the renderer because the numbers are
 * load-bearing: `rule` has to be identical in every box for the block to read
 * as a grid, and two `height`s plus `rowGap` have to clear the big figures
 * anchored 182pt off the foot of the page. The closing page pays for the
 * second row out of the gap above the block; see `buildStatementReport`.
 */
const SIGN_BOX = {
  height: 112,
  /** Between the two rows. Tighter than the gap between the columns, and it
   * has to be: at 11.4 the second row of four signatories ran 9.8pt into the
   * figures below it — measured off the drawing operators, because two boxes
   * overlapping by a tenth of an inch is invisible in a diff and obvious on
   * paper. */
  rowGap: 8,
  pad: 14,
  caps: 14,
  plateTop: 25,
  plateHeight: 36,
  rule: 68,
  name: 76,
  title: 96,
};

/**
 * The paper a signature is drawn on — the cream sheet's own panel colour, so
 * the slip reads as paper laid on the page rather than as a white box.
 */
const SIGNATURE_PLATE = "#fbfaf5";

const EYEBROW_Y = 62;
/** Where a page's composed content starts, under the eyebrow. */
const HEAD_BOTTOM = 85;
/** Nothing in the flow may be drawn below this; the footer lives under it. */
const BODY_BOTTOM = 752;
/** What a closing-balance row needs under the last rule of a ledger. */
const TOTAL_ROW = 40;
/** Right-aligned cells stand off the column to their left by this much. */
const CELL_GUTTER = 10;
const FOOTER_RULE_Y = 764;
const FOOTER_TEXT_Y = 775;

const SIZE = {
  eyebrow: 7.5,
  caps: 7.5,
  lede: 12,
  ledeCover: 12.5,
  sectionOrdinal: 28,
  sectionTitle: 9.5,
  tableHead: 7.5,
  rowLabel: 10.5,
  rowDetail: 8,
  money: 12.5,
  moneySecondary: 8,
  moneyLarge: 16.5,
  bigFigure: 32,
  bigSecondary: 8.5,
  boxFigure: 28,
  panelTitle: 14,
  panelSubtitle: 8.5,
  note: 9,
};

/** Tracking for small caps, which is most of the document's furniture. */
const TRACK = 1.4;

export type PdfPagedSpec = {
  title: string;
  pages: PdfPage[];
};

export type PdfPage = {
  theme?: PdfTheme;
  eyebrowLeft?: string;
  eyebrowRight?: string;
  footer?: {
    left: string;
    /** Appended after "PAGE n OF N", or used alone when there is no number. */
    right?: string;
    /** Off for the cover, which carries its own bottom furniture. */
    pageNumber?: boolean;
    rule?: boolean;
  };
  blocks: PdfPagedBlock[];
};

export type PdfTone = "in" | "out" | "plain";

/** One cell of a ledger row. Money stacks ৳ over $, which is the whole point. */
export type PdfStackCell =
  | { kind: "label"; text: string; detail?: string | null }
  | { kind: "caps"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "money";
      primary: string;
      secondary?: string | null;
      tone?: PdfTone;
      large?: boolean;
    }
  | { kind: "pill"; text: string; tone: PdfTone }
  | { kind: "empty" };

export type PdfStackColumn = {
  header: string;
  /** Share of the content width. */
  width: number;
  align?: "left" | "right" | "center";
};

export type PdfWaterfallStep = {
  label: string;
  /** Signed, already formatted. Blank for the opening and closing pillars. */
  delta: string;
  deltaSecondary: string;
  /** Where the balance stands after this step — the top of the pillar. */
  balance: number;
  balanceLabel: string;
  balanceSecondary: string;
  kind: "opening" | "in" | "out" | "closing";
};

export type PdfPagedBlock =
  /** Absolute vertical space, in points. */
  | { kind: "gap"; height: number }
  /** Jump to a fixed distance above the foot of the sheet. */
  | { kind: "anchor"; fromBottom: number }
  | { kind: "rule"; weight?: number }
  | { kind: "capsRow"; left: string; right?: string }
  | {
      /** The very large headline. The bold weight stands in for the serif. */
      kind: "display";
      eyebrow?: string;
      lines: string[];
      size: number;
    }
  | { kind: "lede"; text: string; size?: number; width?: number }
  | { kind: "sectionHead"; ordinal: string; title: string; right?: string }
  | { kind: "periodMark"; ordinal: string; label: string; right: string }
  | {
      /** Two bordered figure boxes across — the cover's headline numbers. */
      kind: "figureBoxes";
      items: Array<{
        label: string;
        primary: string;
        secondary: string;
        source: string;
      }>;
      /** Caps the figure. Omitted, the document's own scale decides. */
      size?: number;
      /** The box. Shrink it with the figure or the type floats in it. */
      height?: number;
    }
  | {
      kind: "bigFigures";
      items: Array<{
        value: string;
        secondary?: string;
        label: string;
        align?: "left" | "right";
        /** A word rather than a figure — "Reconciled". */
        word?: boolean;
      }>;
      /** Caps the figures. Omitted, the document's own scale decides. */
      size?: number;
      /** The band's height, which the figure sits inside. */
      height?: number;
    }
  | {
      kind: "stackTable";
      columns: PdfStackColumn[];
      rows: PdfStackCell[][];
      total?: PdfStackCell[];
      /**
       * Multiplies every type size and row height in this table.
       *
       * Per table rather than per document, so a ledger of five columns and a
       * ledger of nine can each be set at the size its own widest figure needs
       * without the other three reports moving. 1 is what every existing
       * caller gets.
       */
      scale?: number;
    }
  | {
      kind: "waterfall";
      title: string;
      subtitle: string;
      steps: PdfWaterfallStep[];
    }
  | {
      kind: "donut";
      title: string;
      subtitle: string;
      centreLabel: string;
      centreValue: string;
      slices: Array<{ label: string; share: number; color?: string | null }>;
    }
  | { kind: "notes"; items: string[] }
  | {
      kind: "signatures";
      items: Array<{
        name: string;
        title: string;
        /**
         * PNG or JPEG bytes of this person's own hand, drawn over the rule.
         *
         * The bytes rather than a file id or a URL: a PDF is one file that has
         * to open on a laptop with no session, so a signature it fetches is a
         * signature that is missing everywhere it matters.
         */
        image?: Buffer | null;
      }>;
    };

/** What the footer pass needs to know about a physical page. */
type PageChrome = {
  theme: PdfTheme;
  footer?: PdfPage["footer"];
};

/** Everything a block needs that is not the block itself. */
type Flow = {
  palette: Palette;
  /** Continues this page's chrome onto a fresh sheet. */
  next: () => void;
};

@Injectable()
export class PdfService {
  private static readonly logger = new Logger(PdfService.name);

  /**
   * Points `BODY` and `BOLD` at the bundled face, or at Helvetica if it cannot
   * be had.
   *
   * `registerFont` only records the source, so the face is asked for straight
   * away: a truncated or corrupt file has to fail here, before a single string
   * is drawn, or the fallback would come too late for `drawable` to know it is
   * back to Latin-1. It is called once per document, before anything is drawn.
   * A face that failed once is not tried again — the file will not have fixed
   * itself, and every export after it would log the same error.
   */
  private useFaces(doc: PDFKit.PDFDocument): void {
    if (FACES && embedded) {
      try {
        doc.registerFont(BODY, FACES.regular);
        doc.registerFont(BOLD, FACES.bold);
        doc.font(BODY);
        doc.font(BOLD);
        return;
      } catch (error) {
        embedded = false;
        PdfService.logger.error(
          `Bundled report face unusable, falling back to Helvetica — amounts ` +
            `will print without the taka sign: ${String(error)}`,
        );
      }
    }

    doc.registerFont(BODY, "Helvetica");
    doc.registerFont(BOLD, "Helvetica-Bold");
  }

  /** Resolves to the finished file. */
  build(spec: PdfDocumentSpec): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        ...PAGE,
        bufferPages: true,
        info: { Title: spec.title, Creator: "ShareViral Finance Management" },
      });
      this.useFaces(doc);

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const width = doc.page.width - PAGE.margin * 2;

      /* --- masthead ---------------------------------------------------- */
      doc
        .font(BOLD)
        .fontSize(18)
        .fillColor(INK)
        .text(drawable(spec.title), { width });

      for (const line of spec.subtitle) {
        doc
          .font(BODY)
          .fontSize(9.5)
          .fillColor(MUTED)
          .text(drawable(line), { width });
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
          .font(BODY)
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(drawable(spec.footer), PAGE.margin, y, {
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
  /*  The statement                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * A composed document: one sheet per page spec, plus continuation sheets
   * wherever a ledger runs longer than one.
   *
   * A continuation inherits the page's whole chrome — ground, eyebrows, footer
   * — so a quarter's ledger reads as more of the same page rather than as a
   * different document that lost its heading.
   */
  buildPages(spec: PdfPagedSpec): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margin: MARGIN,
        bufferPages: true,
        info: { Title: spec.title, Creator: "ShareViral Finance Management" },
      });
      this.useFaces(doc);

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const chrome: PageChrome[] = [];

      spec.pages.forEach((page, index) => {
        if (index > 0) doc.addPage();
        this.paintPage(doc, page, chrome);

        const flow: Flow = {
          palette: PALETTES[page.theme ?? "cream"],
          next: () => {
            doc.addPage();
            this.paintPage(doc, page, chrome);
          },
        };

        for (const block of page.blocks) {
          this.renderPaged(doc, block, flow);
        }
      });

      this.writeFooters(doc, chrome);
      doc.end();
    });
  }

  /** Ground, eyebrows, and the starting position for the flow. */
  private paintPage(
    doc: PDFKit.PDFDocument,
    page: PdfPage,
    chrome: PageChrome[],
  ): void {
    const theme = page.theme ?? "cream";
    const palette = PALETTES[theme];
    chrome.push({ theme, footer: page.footer });

    // Full bleed: the sheet is the colour, not a panel drawn inside margins.
    doc.save();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(palette.page);
    doc.restore();

    if (page.eyebrowLeft) {
      this.caps(doc, page.eyebrowLeft, {
        x: MARGIN,
        y: EYEBROW_Y,
        width: CONTENT * 0.45,
        color: palette.muted,
      });
    }
    if (page.eyebrowRight) {
      this.caps(doc, page.eyebrowRight, {
        x: MARGIN + CONTENT * 0.45,
        y: EYEBROW_Y,
        width: CONTENT * 0.55,
        color: palette.muted,
        align: "right",
      });
    }

    doc.x = MARGIN;
    doc.y = HEAD_BOTTOM;
  }

  /**
   * Page numbers can only be written once the count is known, so the footer is
   * a second pass over the buffered pages.
   */
  private writeFooters(doc: PDFKit.PDFDocument, chrome: PageChrome[]): void {
    const range = doc.bufferedPageRange();

    for (let i = 0; i < range.count; i++) {
      const sheet = chrome[i];
      if (!sheet?.footer) continue;

      doc.switchToPage(range.start + i);
      // Writing below the bottom margin makes PDFKit start a new page — and
      // then that page needs a footer too. Four blank pages came from exactly
      // this.
      doc.page.margins.bottom = 0;

      const palette = PALETTES[sheet.theme];
      const { left, right, pageNumber = true, rule = true } = sheet.footer;

      if (rule) {
        doc
          .moveTo(MARGIN, FOOTER_RULE_Y)
          .lineTo(MARGIN + CONTENT, FOOTER_RULE_Y)
          .lineWidth(0.8)
          .strokeColor(palette.rule)
          .stroke();
      }

      const tail = pageNumber
        ? `Page ${i + 1} of ${range.count}${right ? ` · ${right}` : ""}`
        : (right ?? "");

      // The two halves are measured against each other rather than given a
      // fixed split, so a long company name shortens itself instead of running
      // into the page number.
      doc.font(BOLD).fontSize(SIZE.caps);
      const tailWidth = tail
        ? Math.min(
            CONTENT * 0.62,
            doc.widthOfString(drawable(tail).toUpperCase(), {
              characterSpacing: TRACK,
            }) + 3,
          )
        : 0;

      this.caps(doc, left, {
        x: MARGIN,
        y: FOOTER_TEXT_Y,
        width: CONTENT - tailWidth - 12,
        color: palette.muted,
      });

      if (tail) {
        this.caps(doc, tail, {
          x: MARGIN + CONTENT - tailWidth,
          y: FOOTER_TEXT_Y,
          width: tailWidth,
          color: palette.muted,
          align: "right",
        });
      }
    }
  }

  /* --- primitives -------------------------------------------------------- */

  /**
   * Tracked small caps — the document's entire furniture vocabulary.
   *
   * Measured two points short of the space available: PDFKit charges the
   * tracking after the final character when it *draws* but not always when it
   * *measures*, and a heading one point too wide wraps onto a second line that
   * lands on top of whatever is beneath it.
   */
  private caps(
    doc: PDFKit.PDFDocument,
    text: string,
    options: {
      x: number;
      y: number;
      width: number;
      color: string;
      size?: number;
      align?: "left" | "right" | "center";
      spacing?: number;
      /** Column headings wrap rather than truncate — "AMOUNT (BDT /" "USD)". */
      wrap?: boolean;
    },
  ): number {
    if (!text) return options.y;
    const size = options.size ?? SIZE.caps;
    const spacing = options.spacing ?? TRACK;

    doc.font(BOLD).fontSize(size).fillColor(options.color);
    const upper = drawable(text).toUpperCase();
    const value = options.wrap
      ? upper
      : fit(doc, upper, options.width - 2, { characterSpacing: spacing });

    doc.text(value, options.x, options.y, {
      width: options.width,
      align: options.align ?? "left",
      characterSpacing: spacing,
      lineGap: 2,
      lineBreak: options.wrap === true,
    });

    return doc.y;
  }

  private hairline(
    doc: PDFKit.PDFDocument,
    y: number,
    color: string,
    weight = 0.7,
    x = MARGIN,
    width = CONTENT,
  ): void {
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineWidth(weight)
      .strokeColor(color)
      .stroke();
  }

  /**
   * Prose with **emphasis**, drawn inline.
   *
   * The notes to the accounts bold the figure and the finding — "**payable
   * following appointment of a tax adviser**" — and a note that cannot do that
   * is a wall of grey the reader skims. PDFKit's `continued` runs are the only
   * way to change font mid-paragraph and keep the wrapping.
   */
  private richText(
    doc: PDFKit.PDFDocument,
    text: string,
    options: {
      x: number;
      y: number;
      width: number;
      color: string;
      size: number;
      lineGap: number;
    },
  ): number {
    // Alternating runs: even is body, odd is bold. An empty run keeps its
    // place in the alternation rather than being dropped, or a note that opens
    // with **bold** would come out the wrong way round the whole way down.
    const parts = drawable(text).split("**");
    doc.fontSize(options.size).fillColor(options.color);

    parts.forEach((part, index) => {
      doc.font(index % 2 === 1 ? BOLD : BODY);
      const last = index === parts.length - 1;

      // Only the opening run may carry a position. PDFKit reads a *missing*
      // x as "the options object is the second argument" and throws the real
      // options away, which put every bold phrase on a line of its own.
      if (index === 0) {
        doc.text(part, options.x, options.y, {
          width: options.width,
          lineGap: options.lineGap,
          continued: !last,
        });
      } else {
        doc.text(part, { continued: !last });
      }
    });

    return doc.y;
  }

  /* --- the block vocabulary ---------------------------------------------- */

  private renderPaged(
    doc: PDFKit.PDFDocument,
    block: PdfPagedBlock,
    flow: Flow,
  ): void {
    const p = flow.palette;

    switch (block.kind) {
      case "gap":
        doc.y += block.height;
        return;

      case "anchor":
        doc.y = SHEET.height - block.fromBottom;
        return;

      case "rule":
        this.hairline(doc, doc.y, p.rule, block.weight ?? 0.8);
        doc.y += 1;
        return;

      case "capsRow": {
        const top = doc.y;
        this.caps(doc, block.left, {
          x: MARGIN,
          y: top,
          width: block.right ? CONTENT * 0.62 : CONTENT,
          color: p.muted,
        });
        if (block.right) {
          this.caps(doc, block.right, {
            x: MARGIN + CONTENT * 0.38,
            y: top,
            width: CONTENT * 0.62,
            color: p.muted,
            align: "right",
          });
        }
        doc.y = top + SIZE.caps + 3;
        return;
      }

      case "display":
        this.renderDisplay(doc, block, p);
        return;

      case "lede": {
        const size = block.size ?? SIZE.lede;
        doc
          .font(BODY)
          .fontSize(size)
          .fillColor(p.body)
          .text(drawable(block.text), MARGIN, doc.y, {
            width: block.width ?? CONTENT,
            lineGap: size * 0.42,
            align: "left",
          });
        doc.x = MARGIN;
        return;
      }

      case "sectionHead":
        this.renderSectionHead(doc, block, p);
        return;

      case "periodMark":
        this.renderPeriodMark(doc, block, p);
        return;

      case "figureBoxes":
        this.renderFigureBoxes(doc, block, p);
        return;

      case "bigFigures":
        this.renderBigFigures(doc, block, p);
        return;

      case "stackTable":
        this.renderStackTable(doc, block, flow);
        return;

      case "waterfall":
        this.renderWaterfall(doc, block, p);
        return;

      case "donut":
        this.renderDonut(doc, block, p);
        return;

      case "notes":
        this.renderNotes(doc, block.items, flow);
        return;

      case "signatures":
        this.renderSignatures(doc, block.items, p);
        return;
    }
  }

  /**
   * The headline.
   *
   * The sample's display face is a high-contrast serif; the document's own bold
   * at the same size keeps the proportion the page is built on — the headline is
   * a third of the cover — which is what carries the design. Faking the italic
   * second line with a shear transform was tried and looked like a mistake.
   */
  private renderDisplay(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfPagedBlock, { kind: "display" }>,
    p: Palette,
  ): void {
    const top = doc.y;

    if (block.eyebrow) {
      this.caps(doc, block.eyebrow, {
        x: MARGIN,
        y: top,
        width: CONTENT,
        color: p.muted,
      });
      doc.y = top + SIZE.caps + 19.5;
    }

    // A headline is set to the width, not cut to it. "The second account &
    // not.." is what truncating a display line looks like, and the one thing a
    // headline may not be is unreadable — so an over-long one steps down in
    // size until it fits, to a floor where it is still a headline.
    doc.font(BOLD).fillColor(p.ink);
    let size = block.size;
    const floor = block.size * 0.68;
    while (size > floor) {
      doc.fontSize(size);
      const widest = Math.max(
        ...block.lines.map((line) => doc.widthOfString(drawable(line))),
      );
      if (widest <= CONTENT) break;
      size -= 1;
    }
    doc.fontSize(size);

    // Each line is placed at a measured position rather than left to PDFKit's
    // line box: at 58pt the difference between a 1.01 and a 1.16 leading is a
    // centimetre, and the cover is built on the headline sitting where it does.
    const pitch = block.size * 1.012;
    let y = doc.y;

    for (const line of block.lines) {
      doc.text(fit(doc, drawable(line), CONTENT), MARGIN, y, {
        width: CONTENT,
        lineBreak: false,
      });
      y += pitch;
    }

    doc.x = MARGIN;
    doc.y = y - pitch + block.size * 1.15;
  }

  /** "01  EXECUTIVE SUMMARY" on the left, the scope note on the right. */
  private renderSectionHead(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfPagedBlock, { kind: "sectionHead" }>,
    p: Palette,
  ): void {
    const top = doc.y;

    doc.font(BOLD).fontSize(SIZE.sectionOrdinal).fillColor(p.ink);
    const ordinal = drawable(block.ordinal);
    doc.text(ordinal, MARGIN, top, { lineBreak: false });
    const ordinalWidth = doc.widthOfString(ordinal);

    // The title sits on the numeral's baseline rather than its top, which is
    // what makes the pair read as one mark instead of two stacked things.
    const titleY = top + SIZE.sectionOrdinal * 0.53;
    const titleX = MARGIN + ordinalWidth + 10;

    doc.font(BOLD).fontSize(SIZE.sectionTitle).fillColor(p.ink);
    doc.text(
      fit(doc, drawable(block.title).toUpperCase(), CONTENT * 0.55, {
        characterSpacing: TRACK,
      }),
      titleX,
      titleY,
      { characterSpacing: TRACK, lineBreak: false },
    );

    if (block.right) {
      this.caps(doc, block.right, {
        x: MARGIN + CONTENT * 0.45,
        y: titleY + 1,
        width: CONTENT * 0.55,
        color: p.muted,
        align: "right",
      });
    }

    doc.x = MARGIN;
    doc.y = top + SIZE.sectionOrdinal + 6;
  }

  /** The big period numeral, with the reconciliation state opposite. */
  private renderPeriodMark(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfPagedBlock, { kind: "periodMark" }>,
    p: Palette,
  ): void {
    const top = doc.y;

    doc.font(BOLD).fontSize(30).fillColor(p.ink);
    const ordinal = drawable(block.ordinal);
    doc.text(ordinal, MARGIN, top, { lineBreak: false });
    const ordinalWidth = doc.widthOfString(ordinal);

    doc
      .font(BODY)
      .fontSize(21)
      .fillColor(p.ink)
      .text(drawable(block.label), MARGIN + ordinalWidth + 12, top + 6, {
        lineBreak: false,
      });

    this.caps(doc, block.right, {
      x: MARGIN + CONTENT * 0.4,
      y: top + 18,
      width: CONTENT * 0.6,
      color: p.muted,
      align: "right",
    });

    doc.x = MARGIN;
    doc.y = top + 36;
    this.hairline(doc, doc.y, p.rule, 0.8);
    doc.y += 1;
  }

  /**
   * The cover's two figures, each in its own rule.
   *
   * The source line under each is the part a hand-made statement always had
   * and a generated one usually loses: which account this is, in words.
   */
  private renderFigureBoxes(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfPagedBlock, { kind: "figureBoxes" }>,
    p: Palette,
  ): void {
    const items = block.items;
    const top = doc.y;
    const height = block.height ?? 114;
    const cap = block.size ?? SIZE.boxFigure;
    /* The three lines inside the box slide up with the box itself. */
    const k = height / 114;
    const pad = 15 * k;
    const inner = BOX_WIDTH - pad * 2;

    // Both boxes take the size the wider figure needs, so the cover's two
    // headline numbers are the same size as each other.
    doc.font(BOLD);
    const figureSize =
      cap *
      sharedScale(
        doc,
        items.slice(0, 2).map((item) => ({
          text: drawable(item.primary),
          size: cap,
          width: inner,
        })),
      );

    items.slice(0, 2).forEach((item, index) => {
      const x = MARGIN + index * (BOX_WIDTH + BOX_GAP);

      doc
        .rect(x, top, BOX_WIDTH, height)
        .lineWidth(0.8)
        .strokeColor(p.panelRule)
        .stroke();

      this.caps(doc, item.label, {
        x: x + pad,
        y: top + 15 * k,
        width: inner,
        color: p.muted,
      });

      doc.font(BOLD).fontSize(figureSize).fillColor(p.ink);
      doc.text(fit(doc, drawable(item.primary), inner), x + pad, top + 33 * k, {
        width: inner,
        lineBreak: false,
      });

      doc
        .font(BODY)
        .fontSize(10 * k)
        .fillColor(p.body)
        .text(
          fit(doc, drawable(item.secondary), inner),
          x + pad,
          top + 71 * k,
          {
            width: inner,
            lineBreak: false,
          },
        );

      doc
        .font(BODY)
        .fontSize(8 * k)
        .fillColor(p.faint)
        .text(fit(doc, drawable(item.source), inner), x + pad, top + 89 * k, {
          width: inner,
          lineBreak: false,
        });
    });

    doc.x = MARGIN;
    doc.y = top + height;
  }

  /**
   * The figures across the foot of the cover and the closing page.
   *
   * Ruled above and below, divided between columns, because these are the
   * numbers somebody reads without reading the document.
   */
  private renderBigFigures(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfPagedBlock, { kind: "bigFigures" }>,
    p: Palette,
  ): void {
    const items = block.items;
    const top = doc.y;
    const height = block.height ?? 102;
    const cap = block.size ?? SIZE.bigFigure;
    const k = height / 102;
    const column = CONTENT / Math.max(1, items.length);
    // A left-set figure stands off the divider that follows it, which is drawn
    // 8pt into the next column: at 32pt with a ৳ on the front, "৳34,68,100" ran
    // up against the rule. A right-set one keeps the full column, so it lands on
    // the margin the rules above and below it are drawn to.
    const cellFor = (align: string) =>
      align === "right" ? column : column - 18;

    this.hairline(doc, top, p.rule, 0.8);

    // One scale for the figures, which are read across and share a baseline. A
    // word — "Reconciled" — sits on its own baseline anyway, so it is sized on
    // its own rather than dragging three amounts down with it.
    //
    // The floor is low because the amounts are not: at 32pt a crore with a ৳ on
    // the front is half again as wide as the column, and "৳11,83,00,.." across
    // the foot of a cover is not a figure. 18pt against a 7.5pt label is still
    // the biggest thing on the page.
    doc.font(BOLD);
    const scale = sharedScale(
      doc,
      items
        .filter((item) => !item.word)
        .map((item) => ({
          text: drawable(item.value),
          size: cap,
          width: cellFor(item.align ?? "left"),
        })),
      0.58,
    );

    items.forEach((item, index) => {
      const align = item.align ?? "left";
      const x = MARGIN + index * column;
      const width = cellFor(align);

      if (index > 0 && align === "left") {
        doc
          .moveTo(x - 8, top + 12 * k)
          .lineTo(x - 8, top + height - 12 * k)
          .lineWidth(0.8)
          .strokeColor(p.rule)
          .stroke();
      }

      const valueY = item.word ? top + 24 * k : top + 15 * k;
      const value = drawable(item.value);

      doc.font(BOLD).fillColor(p.ink);
      if (item.word) {
        sized(doc, value, width, cap * 0.86);
      } else {
        doc.fontSize(cap * scale);
      }
      doc.text(fit(doc, value, width), x, valueY, {
        width,
        align,
        lineBreak: false,
      });

      if (item.secondary) {
        doc
          .font(BODY)
          .fontSize(SIZE.bigSecondary)
          .fillColor(p.body)
          .text(fit(doc, drawable(item.secondary), width), x, top + 56 * k, {
            width,
            align,
            lineBreak: false,
          });
      }

      this.caps(doc, item.label, {
        x,
        y: top + 76 * k,
        width,
        color: p.muted,
        align,
      });
    });

    this.hairline(doc, top + height, p.rule, 0.8);
    doc.x = MARGIN;
    doc.y = top + height + 1;
  }

  /* --- the ledger table --------------------------------------------------- */

  /**
   * A ledger, with every cell free to stack ৳ over $.
   *
   * The column headings repeat on every sheet and the closing balance is
   * printed once, after the last row, wherever that lands — which is the only
   * arrangement that survives a quarter without either losing the headings or
   * claiming a balance three sheets early.
   */
  private renderStackTable(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfPagedBlock, { kind: "stackTable" }>,
    flow: Flow,
  ): void {
    const p = flow.palette;
    const units = block.columns.reduce((sum, c) => sum + c.width, 0);
    const widths = block.columns.map((c) => (c.width / units) * CONTENT);
    const offsets: number[] = [];
    let running = MARGIN;
    for (const w of widths) {
      offsets.push(running);
      running += w;
    }

    /* 1 for every table that does not ask, so the other reports do not move. */
    const k = block.scale ?? 1;

    const header = () => {
      const top = doc.y;
      let deepest = top;
      block.columns.forEach((column, i) => {
        // "AMOUNT (BDT / USD)" over a narrow column wraps onto a second line
        // rather than being cut to "AMOUNT (BDT /..", which would leave the
        // reader guessing at the currency of every figure beneath it.
        deepest = Math.max(
          deepest,
          this.caps(doc, column.header, {
            x: offsets[i],
            y: top,
            width: widths[i],
            color: p.muted,
            align: column.align ?? "left",
            size: SIZE.tableHead * k,
            wrap: true,
          }),
        );
      });
      doc.y = Math.max(top + 16 * k, deepest + 2);
      this.hairline(doc, doc.y, p.ink, 1.1);
      doc.y += 1;
    };

    header();

    block.rows.forEach((row, index) => {
      const height = this.stackRowHeight(row) * k;
      /**
       * A row split across a page break is a row nobody can read.
       *
       * The last row also reserves room for the total beneath it. The total
       * breaks to a fresh sheet on its own if it does not fit, and a ledger
       * ending near the foot of a page therefore put its closing balance
       * alone on the next page — one figure above an otherwise empty sheet,
       * which reads as a fault in the document rather than as pagination.
       * Carrying the last entry over with it costs one row and keeps the
       * balance attached to the line that produced it.
       */
      const isLast = index === block.rows.length - 1;
      const needed = height + (isLast && block.total ? TOTAL_ROW * k : 0);

      if (doc.y + needed > BODY_BOTTOM) {
        flow.next();
        header();
      }
      this.drawStackRow(doc, row, block.columns, offsets, widths, p, height, k);
    });

    if (block.total) {
      if (doc.y + TOTAL_ROW * k > BODY_BOTTOM) {
        flow.next();
        header();
      }
      const top = doc.y;
      block.total.forEach((cell, i) => {
        this.drawStackCell(doc, cell, {
          x: offsets[i],
          y: top + 8 * k,
          width: widths[i],
          align: block.columns[i]?.align ?? "left",
          palette: p,
          scale: k,
        });
      });
      doc.y = top + TOTAL_ROW * k;
    }

    doc.x = MARGIN;
  }

  private stackRowHeight(row: PdfStackCell[]): number {
    const stacked = row.some(
      (cell) =>
        (cell.kind === "label" && cell.detail) ||
        (cell.kind === "money" && cell.secondary),
    );
    return stacked ? 36.5 : 26;
  }

  private drawStackRow(
    doc: PDFKit.PDFDocument,
    row: PdfStackCell[],
    columns: PdfStackColumn[],
    offsets: number[],
    widths: number[],
    p: Palette,
    height: number,
    scale = 1,
  ): void {
    const top = doc.y;

    row.forEach((cell, i) => {
      this.drawStackCell(doc, cell, {
        x: offsets[i],
        y: top + 7 * scale,
        width: widths[i],
        align: columns[i]?.align ?? "left",
        palette: p,
        scale,
      });
    });

    doc.y = top + height;
    this.hairline(doc, doc.y, p.rule, 0.6);
    doc.y += 1;
  }

  private drawStackCell(
    doc: PDFKit.PDFDocument,
    cell: PdfStackCell,
    at: {
      x: number;
      y: number;
      width: number;
      align: "left" | "right" | "center";
      palette: Palette;
      /** Multiplies every type size and offset in the cell. */
      scale?: number;
    },
  ): void {
    const p = at.palette;
    const k = at.scale ?? 1;
    // A right-aligned figure grows leftwards. Without a standing gap the
    // closing position ran straight into "BANK / CARD" beside it.
    const gutter = at.align === "right" ? CELL_GUTTER : 0;
    const width = at.width - gutter;
    const left = at.x + gutter;

    switch (cell.kind) {
      case "empty":
        return;

      case "caps":
        this.caps(doc, cell.text, {
          x: left,
          y: at.y + 3 * k,
          width,
          color: p.ink,
          align: at.align,
          size: SIZE.caps * k,
        });
        return;

      case "text":
        doc
          .font(BODY)
          .fontSize(SIZE.rowLabel * k)
          .fillColor(p.body)
          .text(fit(doc, drawable(cell.text), width), left, at.y, {
            width,
            align: at.align,
            lineBreak: false,
          });
        return;

      case "label": {
        doc
          .font(BOLD)
          .fontSize(SIZE.rowLabel * k)
          .fillColor(p.ink);
        doc.text(fit(doc, drawable(cell.text), width), left, at.y, {
          width,
          align: at.align,
          lineBreak: false,
        });
        if (cell.detail) {
          doc
            .font(BODY)
            .fontSize(SIZE.rowDetail * k)
            .fillColor(p.muted)
            .text(fit(doc, drawable(cell.detail), width), left, at.y + 15 * k, {
              width,
              align: at.align,
              lineBreak: false,
            });
        }
        return;
      }

      case "money": {
        const colour =
          cell.tone === "in" ? p.in : cell.tone === "out" ? p.out : p.ink;
        const size = (cell.large ? SIZE.moneyLarge : SIZE.money) * k;
        const primary = drawable(cell.primary);

        // Sized down rather than cut: this is the figure the reader came for.
        doc.font(BOLD).fillColor(colour);
        sized(doc, primary, width, size);
        doc.text(
          fit(doc, primary, width),
          left,
          cell.large ? at.y - 3 * k : at.y,
          {
            width,
            align: at.align,
            lineBreak: false,
          },
        );

        if (cell.secondary) {
          const secondary = drawable(cell.secondary);
          doc.font(BODY).fillColor(p.muted);
          sized(doc, secondary, width, SIZE.moneySecondary * k);
          doc.text(
            fit(doc, secondary, width),
            left,
            at.y + (cell.large ? 20 : 16) * k,
            { width, align: at.align, lineBreak: false },
          );
        }
        return;
      }

      case "pill": {
        const colour = cell.tone === "out" ? p.out : p.in;
        doc.font(BOLD).fontSize(6);
        const label = drawable(cell.text).toUpperCase();
        const textWidth = doc.widthOfString(label, { characterSpacing: 1 });
        const boxWidth = Math.min(width, textWidth + 14);
        const boxHeight = 13;
        const x =
          at.align === "right"
            ? left + width - boxWidth
            : at.align === "center"
              ? left + (width - boxWidth) / 2
              : left;

        doc
          .rect(x, at.y - 1, boxWidth, boxHeight)
          .lineWidth(0.7)
          .strokeColor(colour)
          .stroke();

        doc.fillColor(colour).text(label, x, at.y + 3, {
          width: boxWidth,
          align: "center",
          characterSpacing: 1,
          lineBreak: false,
        });
        return;
      }
    }
  }

  /* --- the charts --------------------------------------------------------- */

  /** A bordered panel with its own title, the way both charts sit on page 3. */
  private panel(
    doc: PDFKit.PDFDocument,
    title: string,
    subtitle: string,
    height: number,
    p: Palette,
  ): { top: number; bodyTop: number } {
    const top = doc.y;

    doc
      .rect(MARGIN, top, CONTENT, height)
      .fillColor(p.panel)
      .fill()
      .rect(MARGIN, top, CONTENT, height)
      .lineWidth(0.8)
      .strokeColor(p.panelRule)
      .stroke();

    doc
      .font(BOLD)
      .fontSize(SIZE.panelTitle)
      .fillColor(p.ink)
      .text(fit(doc, drawable(title), CONTENT - 56), MARGIN + 28, top + 22, {
        lineBreak: false,
      });

    doc
      .font(BODY)
      .fontSize(SIZE.panelSubtitle)
      .fillColor(p.muted)
      .text(drawable(subtitle), MARGIN + 28, top + 44, {
        width: CONTENT - 56,
        lineGap: 4,
      });

    return { top, bodyTop: Math.max(doc.y + 8, top + 68) };
  }

  /**
   * Opening, every movement, closing — drawn rather than tabulated.
   *
   * A waterfall is the one chart that answers "where did it go" in a single
   * look, and it is the chart the hand-made statement drew by hand each month.
   * Pillars stand between the balance before and the balance after, so the
   * height of a bar *is* the amount and the reader never has to trust a legend.
   */
  private renderWaterfall(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfPagedBlock, { kind: "waterfall" }>,
    p: Palette,
  ): void {
    const height = 238;
    const { top, bodyTop } = this.panel(
      doc,
      block.title,
      block.subtitle,
      height,
      p,
    );

    const steps = block.steps;
    const plotLeft = MARGIN + 30;
    const plotWidth = CONTENT - 60;
    const plotTop = bodyTop + 24;
    const baseline = top + height - 44;
    const plotHeight = baseline - plotTop;

    const peak = steps.reduce(
      (max, step) => Math.max(max, step.balance),
      0.0001,
    );
    // Headroom for the value labels standing over the tallest pillar.
    const scale = plotHeight / (peak * 1.02);
    const yOf = (value: number) => baseline - value * scale;

    for (let i = 1; i <= 3; i++) {
      this.hairline(
        doc,
        plotTop + (plotHeight / 3) * (i - 1),
        p.panelRule,
        0.6,
        plotLeft,
        plotWidth,
      );
    }
    this.hairline(doc, baseline, p.rule, 0.9, plotLeft, plotWidth);

    const slot = plotWidth / Math.max(1, steps.length);
    const barWidth = Math.min(32, slot * 0.46);

    let previous = 0;

    steps.forEach((step, index) => {
      const centre = plotLeft + slot * (index + 0.5);
      const x = centre - barWidth / 2;

      const isPillar = step.kind === "opening" || step.kind === "closing";
      const bottom = isPillar ? 0 : Math.min(previous, step.balance);
      const topValue = isPillar
        ? step.balance
        : Math.max(previous, step.balance);

      const yTop = yOf(topValue);
      const barHeight = Math.max(1.5, yOf(bottom) - yTop);

      const colour =
        step.kind === "in"
          ? SERIES[1]
          : step.kind === "out"
            ? p.out
            : SERIES[0];

      doc.rect(x, yTop, barWidth, barHeight).fillColor(colour).fill();

      // The connector carries the eye from one balance to the next; without it
      // a falling bar looks like it starts at nothing.
      if (index < steps.length - 1 && step.kind !== "closing") {
        doc
          .save()
          .moveTo(x + barWidth, yOf(step.balance))
          .lineTo(
            plotLeft + slot * (index + 1.5) - barWidth / 2,
            yOf(step.balance),
          )
          .lineWidth(0.6)
          .dash(1.6, { space: 2 })
          .strokeColor(p.panelRule)
          .stroke()
          .undash()
          .restore();
      }

      const labelWidth = slot * 1.5;
      const labelX = centre - labelWidth / 2;
      const primary = step.delta || step.balanceLabel;
      const secondary = step.deltaSecondary || step.balanceSecondary;
      const labelColour =
        step.kind === "in" ? SERIES[1] : step.kind === "out" ? p.out : p.ink;

      doc
        .font(BOLD)
        .fontSize(8)
        .fillColor(labelColour)
        .text(fit(doc, drawable(primary), labelWidth), labelX, yTop - 18, {
          width: labelWidth,
          align: "center",
          lineBreak: false,
        });

      if (secondary) {
        doc
          .font(BODY)
          .fontSize(6)
          .fillColor(p.muted)
          .text(fit(doc, drawable(secondary), labelWidth), labelX, yTop - 8, {
            width: labelWidth,
            align: "center",
            lineBreak: false,
          });
      }

      const words = drawable(step.label).toUpperCase().split(" ");
      const half = Math.ceil(words.length / 2);
      const lines =
        words.length > 1
          ? [words.slice(0, half).join(" "), words.slice(half).join(" ")]
          : words;
      lines.forEach((line, row) => {
        this.caps(doc, line, {
          x: labelX,
          y: baseline + 8 + row * 9,
          width: labelWidth,
          color: p.muted,
          size: 5.8,
          align: "center",
          spacing: 0.5,
        });
      });

      previous = step.balance;
    });

    doc.x = MARGIN;
    doc.y = top + height;
  }

  /**
   * Where the outflow went, as a ring with the total inside it.
   *
   * Drawn from arcs rather than an image so it stays sharp at any zoom and the
   * file stays a few tens of kilobytes.
   */
  private renderDonut(
    doc: PDFKit.PDFDocument,
    block: Extract<PdfPagedBlock, { kind: "donut" }>,
    p: Palette,
  ): void {
    const height = 228;
    const { top } = this.panel(doc, block.title, block.subtitle, height, p);

    const cx = MARGIN + 98;
    const cy = top + 137;
    const outer = 55;
    const inner = 33;

    const total = block.slices.reduce(
      (sum, s) => sum + Math.max(0, s.share),
      0,
    );
    let angle = -90;

    block.slices.forEach((slice, index) => {
      const sweep = total > 0 ? (Math.max(0, slice.share) / total) * 360 : 0;
      if (sweep <= 0) return;
      // A hair of ground between segments, so two neighbouring greens read as
      // two shares rather than one.
      const gap = sweep > 4 ? 0.9 : 0;
      this.arc(
        doc,
        cx,
        cy,
        inner,
        outer,
        angle + gap / 2,
        angle + sweep - gap / 2,
        slice.color || SERIES[index % SERIES.length],
      );
      angle += sweep;
    });

    this.caps(doc, block.centreLabel, {
      x: cx - inner,
      y: cy - 12,
      width: inner * 2,
      color: p.muted,
      size: 5.6,
      align: "center",
      spacing: 0.4,
    });
    const centre = drawable(block.centreValue);
    doc.font(BOLD).fillColor(p.ink);
    sized(doc, centre, inner * 2 + 12, 12);
    doc.text(fit(doc, centre, inner * 2 + 12), cx - inner - 6, cy - 2, {
      width: inner * 2 + 12,
      align: "center",
      lineBreak: false,
    });

    /* --- the list beside it ---------------------------------------------- */

    const listLeft = MARGIN + 200;
    const listWidth = MARGIN + CONTENT - 18 - listLeft;
    const pitch = Math.min(30, 150 / Math.max(1, block.slices.length));
    let y = cy - (pitch * block.slices.length) / 2 + 4;

    block.slices.forEach((slice, index) => {
      doc
        .rect(listLeft, y + 2, 9, 9)
        .fillColor(slice.color || SERIES[index % SERIES.length])
        .fill();

      doc
        .font(BODY)
        .fontSize(10.5)
        .fillColor(p.ink)
        .text(
          fit(doc, drawable(slice.label), listWidth - 90),
          listLeft + 17,
          y + 1,
          { width: listWidth - 90, lineBreak: false },
        );

      doc
        .font(BOLD)
        .fontSize(13)
        .fillColor(p.ink)
        .text(`${slice.share.toFixed(1)}%`, listLeft, y - 2, {
          width: listWidth,
          align: "right",
          lineBreak: false,
        });

      y += pitch;
      this.hairline(doc, y - 6, p.panelRule, 0.6, listLeft, listWidth);
    });

    doc.x = MARGIN;
    doc.y = top + height;
  }

  /** One ring segment, as an SVG path PDFKit can fill. */
  private arc(
    doc: PDFKit.PDFDocument,
    cx: number,
    cy: number,
    inner: number,
    outer: number,
    from: number,
    to: number,
    colour: string,
  ): void {
    const point = (angle: number, radius: number) => {
      const rad = (angle * Math.PI) / 180;
      return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
    };
    const large = to - from > 180 ? 1 : 0;
    const [ox0, oy0] = point(from, outer);
    const [ox1, oy1] = point(to, outer);
    const [ix1, iy1] = point(to, inner);
    const [ix0, iy0] = point(from, inner);

    // Sweep 1 runs clockwise on the page, because PDFKit's y grows downwards.
    const path =
      `M ${ox0} ${oy0} A ${outer} ${outer} 0 ${large} 1 ${ox1} ${oy1} ` +
      `L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`;

    doc.path(path).fillColor(colour).fill();
  }

  /* --- notes and signatures ------------------------------------------------ */

  /** The notes to the accounts: numbered prose, with the findings in bold. */
  private renderNotes(
    doc: PDFKit.PDFDocument,
    items: string[],
    flow: Flow,
  ): void {
    const p = flow.palette;
    const gutter = 16;

    items.forEach((item, index) => {
      // Measure first: a note that would land half on the next sheet moves
      // whole, which is the difference between a document and a printout.
      doc.font(BODY).fontSize(SIZE.note);
      const needed =
        doc.heightOfString(drawable(item.replace(/\*\*/g, "")), {
          width: CONTENT - gutter,
          lineGap: 4.5,
        }) + 9;

      if (doc.y + needed > BODY_BOTTOM) flow.next();

      const top = doc.y;
      doc
        .font(BODY)
        .fontSize(SIZE.note)
        .fillColor(p.muted)
        .text(`${index + 1}.`, MARGIN, top, {
          width: gutter - 6,
          align: "right",
          lineBreak: false,
        });

      this.richText(doc, item, {
        x: MARGIN + gutter,
        y: top,
        width: CONTENT - gutter,
        color: p.body,
        size: SIZE.note,
        lineGap: 4.5,
      });

      doc.x = MARGIN;
      doc.y += 9;
    });
  }

  /**
   * Who signed, in a grid: the mark, the rule, the name, the title.
   *
   * Two across and up to two down, because the statement takes up to four
   * signatories and a row of four across an A4 leaves each name 100pt it does
   * not fit in. Three fills three cells of the four and leaves the last empty,
   * which is what a grid does — shuffling the odd one to the middle would put
   * the third signature somewhere the first two are not.
   *
   * The rule sits at the same height in every box whether or not there is an
   * image above it. That is the whole reason this reads as a grid: a box that
   * closed up around a missing signature would put one name a centimetre above
   * its neighbour, and the block would look broken rather than incomplete.
   */
  private renderSignatures(
    doc: PDFKit.PDFDocument,
    items: Array<{ name: string; title: string; image?: Buffer | null }>,
    p: Palette,
  ): void {
    const top = doc.y;
    const shown = items.slice(0, SIGN_GRID.columns * SIGN_GRID.rows);
    const rows = Math.max(1, Math.ceil(shown.length / SIGN_GRID.columns));
    const pad = SIGN_BOX.pad;
    const inner = BOX_WIDTH - pad * 2;

    shown.forEach((item, index) => {
      const x = MARGIN + (index % SIGN_GRID.columns) * (BOX_WIDTH + BOX_GAP);
      const y =
        top +
        Math.floor(index / SIGN_GRID.columns) *
          (SIGN_BOX.height + SIGN_BOX.rowGap);

      doc
        .rect(x, y, BOX_WIDTH, SIGN_BOX.height)
        .lineWidth(0.8)
        .strokeColor(p.panelRule)
        .stroke();

      this.caps(doc, "Signature", {
        x: x + pad,
        y: y + SIGN_BOX.caps,
        width: inner,
        color: p.faint,
      });

      this.signatureInk(doc, item.image, x + pad, y, inner);
      this.hairline(doc, y + SIGN_BOX.rule, p.panelRule, 0.8, x + pad, inner);

      doc
        .font(BOLD)
        .fontSize(13)
        .fillColor(p.ink)
        .text(
          fit(doc, drawable(item.name), inner),
          x + pad,
          y + SIGN_BOX.name,
          { width: inner, lineBreak: false },
        );

      doc
        .font(BODY)
        .fontSize(8)
        .fillColor(p.muted)
        .text(
          fit(doc, drawable(item.title), inner),
          x + pad,
          y + SIGN_BOX.title,
          { width: inner, lineBreak: false },
        );
    });

    doc.x = MARGIN;
    doc.y = top + rows * SIGN_BOX.height + (rows - 1) * SIGN_BOX.rowGap;
  }

  /**
   * The scan itself, laid over the rule on a slip of paper.
   *
   * The plate is not decoration. A signature is dark ink and this page is dark
   * green, so a PNG with a transparent background would be invisible on it and
   * a JPEG would arrive carrying a white rectangle of its own anyway. Drawing
   * the paper deliberately makes both look like the same thing rather than one
   * of them looking like a mistake.
   *
   * It refuses to fail. An image PDFKit cannot decode leaves the ruled line
   * with a name under it, which is the document this page printed before
   * signatures existed — a statement that will not export at all because one
   * scan is an interlaced PNG is a worse outcome than one missing a mark. The
   * upload refuses those, so this is the belt to that brace.
   */
  private signatureInk(
    doc: PDFKit.PDFDocument,
    image: Buffer | null | undefined,
    x: number,
    boxTop: number,
    width: number,
  ): void {
    if (!image?.length) return;

    const top = boxTop + SIGN_BOX.plateTop;
    doc.rect(x, top, width, SIGN_BOX.plateHeight).fill(SIGNATURE_PLATE);

    try {
      doc.image(image, x + 5, top + 4, {
        fit: [width - 10, SIGN_BOX.plateHeight - 8],
        align: "center",
        valign: "center",
      });
    } catch {
      // Decoded on the way in, so reaching here means a file that changed
      // underneath us. The plate stays: an empty slip of paper over the rule
      // says a signature was meant to be here rather than that nobody signed.
    }
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
          .font(BOLD)
          .fontSize(11)
          .fillColor(INK)
          .text(drawable(block.text), PAGE.margin, doc.y, { width })
          .moveDown(0.35);
        return;

      // Set in the body weight, not an italic: the embedded family is two
      // weights, and a sheared upright is worse than an upright.
      case "note":
        doc
          .font(BODY)
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(drawable(block.text), PAGE.margin, doc.y, { width })
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

    // Every tile takes the size the widest figure needs, across the whole
    // block: eight boxes of money in five different sizes is a mess, and a
    // cut-off amount is worse than a small one.
    doc.font(BOLD);
    const figureSize =
      12 *
      sharedScale(
        doc,
        items.map((item) => ({
          text: drawable(item.value),
          size: 12,
          width: boxWidth - 16,
        })),
        0.75,
      );

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
          .font(BODY)
          .fontSize(7)
          .fillColor(MUTED)
          .text(drawable(item.label).toUpperCase(), x + 8, top + 8, {
            width: boxWidth - 16,
            characterSpacing: 0.4,
          });

        doc
          .font(BOLD)
          .fontSize(figureSize)
          .fillColor(
            item.value.trim().startsWith("−") ||
              item.value.trim().startsWith("-")
              ? NEGATIVE
              : INK,
          )
          .text(
            fit(doc, drawable(item.value), boxWidth - 16),
            x + 8,
            top + 21,
            {
              width: boxWidth - 16,
              lineBreak: false,
              ellipsis: true,
            },
          );

        if (item.hint) {
          doc
            .font(BODY)
            .fontSize(7)
            .fillColor(MUTED)
            .text(
              fit(doc, drawable(item.hint), boxWidth - 16),
              x + 8,
              top + 38,
              {
                width: boxWidth - 16,
                lineBreak: false,
                ellipsis: true,
              },
            );
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
      doc.font(BOLD).fontSize(8).fillColor(MUTED);
      let x = PAGE.margin;
      block.columns.forEach((column, i) => {
        doc.text(
          fit(doc, drawable(column.header).toUpperCase(), widths[i] - 6),
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

    block.rows.forEach((row, index) => {
      /**
       * A row split across a page break is a row nobody can read. Start the
       * next page and repeat the headings instead.
       *
       * The last row reserves room for the total beneath it as well. The total
       * is drawn after this loop with no fit check of its own, so without this
       * a table ending near the foot of a page pushed its closing balance onto
       * a sheet by itself — a page holding one figure and nothing else, which
       * reads as a fault in the document rather than as pagination.
       */
      const isLast = index === block.rows.length - 1;
      const needed = rowHeight + (isLast && block.total ? rowHeight + 5 : 0);

      if (doc.y + needed > doc.page.height - PAGE.margin - 14) {
        doc.addPage();
        header();
      }

      const top = doc.y;
      doc.font(BODY).fontSize(8.5).fillColor(INK);
      let x = PAGE.margin;
      row.forEach((cell, i) => {
        const value = cell ?? "";
        doc
          .fillColor(
            value.trim().startsWith("−") || value.trim().startsWith("-")
              ? NEGATIVE
              : INK,
          )
          .text(fit(doc, drawable(value), widths[i] - 6), x, top, {
            width: widths[i] - 6,
            align: block.columns[i]?.align ?? "left",
            lineBreak: false,
            ellipsis: true,
          });
        x += widths[i];
      });
      doc.y = top + rowHeight;
    });

    if (block.total) {
      const top = doc.y;
      doc
        .moveTo(PAGE.margin, top)
        .lineTo(PAGE.margin + width, top)
        .lineWidth(0.6)
        .strokeColor(RULE)
        .stroke();

      doc.font(BOLD).fontSize(8.5).fillColor(INK);
      let x = PAGE.margin;
      block.total.forEach((cell, i) => {
        doc.text(fit(doc, drawable(cell ?? ""), widths[i] - 6), x, top + 5, {
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
        .font(BODY)
        .fontSize(8.5)
        .fillColor(INK)
        .text(
          fit(doc, drawable(item.label), labelWidth - 6),
          PAGE.margin,
          top,
          {
            width: labelWidth - 6,
            lineBreak: false,
            ellipsis: true,
          },
        );

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
        .font(BOLD)
        .fontSize(8.5)
        .fillColor(INK)
        .text(drawable(item.value), barX + barWidth + 12, top, {
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
