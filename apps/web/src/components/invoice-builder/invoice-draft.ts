import { fromMinorUnits, isValidAmount, todayInDhaka } from "@finance/shared";

/**
 * One invoice as the builder holds it — every box on the left, and which
 * blocks of the sheet are switched off.
 *
 * The owner brought the builder as a page of its own
 * (`invoice_builder_ShareViral.html`, 28 Sep 2026) that kept the invoice in
 * the page and lost it on a reload. A new invoice's draft is kept in this
 * browser until it is saved, so a refresh or a wrong click in the sidebar
 * does not throw it away; saved, the whole of this goes to the server as the
 * invoice's `document` (#118) — the API checks the same shape
 * (`apps/api/src/modules/invoices/invoice-document.ts`).
 */
export type TextLine = {
  id: number;
  text: string;
  bold: boolean;
  size: number;
};

export type PayLine = {
  id: number;
  label: string;
  value: string;
  bold: boolean;
  size: number;
};

export type LineItem = {
  id: number;
  description: string;
  /** As typed. Fractions allowed — 1.5 hours, 0.25 of a retainer. */
  qty: string;
  /** Taka, as typed. */
  price: string;
};

export const STATUSES = ["SENT", "PAID", "UNPAID", "DRAFT", "OVERDUE"] as const;
export type InvoiceStatus = (typeof STATUSES)[number];

/** The badge's colour per status — the owner's builder's own. */
export const STATUS_COLOURS: Record<InvoiceStatus, string> = {
  SENT: "#805cf6",
  PAID: "#22c55e",
  UNPAID: "#e05050",
  DRAFT: "#9aa3bb",
  OVERDUE: "#c0392b",
};

/** The blocks of the sheet the eye buttons switch off. */
export type Block = "meta" | "bill" | "terms" | "bank" | "notes";

export type InvoiceDraft = {
  v: 1;
  /** An uploaded logo as a data URL; null is the ShareViral mark. */
  logo: string | null;
  companyName: string;
  tagline: string;
  /**
   * The dark tiles: the logo's, the table head's, the total's. The owner, 29
   * Sep 2026, marking those three on a screenshot: *"mark kora background
   * gular color er jonne background color ekta option thakbe"*.
   */
  background: string;
  /**
   * The headings: the "Invoice" title, the bold bill lines (who it is to and
   * from), the project title, Payment Terms — *"text heading gulao dynamic
   * color choose korar option thakbe"*. Both were one "primary" colour.
   */
  heading: string;
  accent: string;
  status: InvoiceStatus;

  number: string;
  /** ISO dates, shown on the sheet as "19 May 2026". */
  issuedOn: string;
  dueOn: string;
  currencyLabel: string;
  salesPeriod: string;
  showUsd: boolean;
  /** Taka per dollar, as typed. */
  usdRate: string;

  billTo: TextLine[];
  billFrom: TextLine[];

  projectTitle: string;
  items: LineItem[];

  payTerms: string;
  pay: PayLine[];

  notes: string;

  hidden: Record<Block, boolean>;
  /** The next id a new row takes — ids only need to be unique in one draft. */
  nextId: number;
};

export const STORAGE_KEY = "sfm.invoice-builder.v1";

/** The largest image accepted for the logo, before it is scaled down. */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/**
 * The largest scaled logo kept, as data-URL text.
 *
 * The API reads a saved invoice as one JSON body, and Express stops reading
 * at 100 KB — past that the save fails before any of this app's code sees
 * it. The logo is the only part of an invoice that could get near that, so
 * it is scaled to the size it prints at first (`shrinkLogo`) and held under
 * this. The server's own limit is a little above it.
 */
export const MAX_LOGO_CHARS = 60_000;

/** A whole invoice as JSON, kept safely under the API's 100 KB. */
export const MAX_DOCUMENT_CHARS = 95_000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-05-19" → "19 May 2026". Anything else comes back as it was. */
export function sheetDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return iso;
  return `${Number(match[3])} ${month.slice(0, 3)} ${match[1]}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * A fresh invoice: the owner's builder's own contents, dated today.
 *
 * `usdRate` is the latest rate on file when there is one — the builder's
 * fixed 120 was a placeholder for a rate it had no way to know. `number` is
 * the next one after the last invoice saved, when the page knows it; the
 * payment reference starts as the same.
 */
export function freshDraft(
  usdRate: number | null,
  number = "INV-001",
): InvoiceDraft {
  const today = todayInDhaka();
  const [year, month] = today.split("-");
  return {
    v: 1,
    logo: null,
    companyName: "ShareViral™",
    tagline: "Level Up Your Earnings",
    background: "#0a0a0a",
    heading: "#0a0a0a",
    accent: "#bfff00",
    status: "SENT",

    number,
    issuedOn: today,
    dueOn: addDays(today, 30),
    currencyLabel: "৳ — BDT",
    salesPeriod: `${MONTHS[Number(month) - 1]} ${year}`,
    showUsd: true,
    usdRate: usdRate ? usdRate.toFixed(2) : "120",

    billTo: [
      { id: 1, text: "ShareViral Corp (USA)", bold: true, size: 14 },
      { id: 2, text: "C/O: Finance Department", bold: false, size: 12 },
      { id: 3, text: "Attn: Rich Dotson (CFO)", bold: false, size: 12 },
      { id: 4, text: "1798 Technology Dr., Ste. 178", bold: false, size: 12 },
      { id: 5, text: "San Jose, CA 95110", bold: false, size: 12 },
    ],
    billFrom: [
      { id: 6, text: "ShareViral Corp (BD)", bold: true, size: 14 },
      { id: 7, text: "Finance Department", bold: false, size: 12 },
      { id: 8, text: "Yeasin Hossain", bold: false, size: 12 },
      { id: 9, text: "Hi Tech Park, Rajshahi", bold: false, size: 12 },
      { id: 10, text: "Bangladesh", bold: false, size: 12 },
    ],

    projectTitle: "Pre-Acquisition (Legacy)",
    items: [
      {
        id: 11,
        description:
          "Full development roadmap built against the ShareViral platform.",
        qty: "1",
        price: "1800000",
      },
    ],

    payTerms: "30 Days",
    pay: [
      {
        id: 12,
        label: "Bank Name",
        value: "Standard Chartered Bank",
        bold: false,
        size: 12.5,
      },
      {
        id: 13,
        label: "Account Holder",
        value: "M/S. EXPROVIA",
        bold: false,
        size: 12.5,
      },
      {
        id: 14,
        label: "Account Number",
        value: "01-7023747-01",
        bold: false,
        size: 12.5,
      },
      {
        id: 15,
        label: "BIC / SWIFT",
        value: "SCBLBDDXXXX",
        bold: false,
        size: 12.5,
      },
      { id: 16, label: "Branch", value: "GULSHAN", bold: false, size: 12.5 },
      {
        id: 17,
        label: "Routing Number",
        value: "215261726",
        bold: false,
        size: 12.5,
      },
      {
        id: 18,
        label: "Payment Reference",
        value: number,
        bold: false,
        size: 12.5,
      },
    ],

    notes:
      "This invoice is issued by ShareViral Corp (Bangladesh) for technical services delivered to ShareViral Corp (USA). Upon approval, payment will be remitted to the ShareViral Bangladesh account listed above. Thank you for your continued partnership.",

    hidden: {
      meta: false,
      bill: false,
      terms: false,
      bank: false,
      notes: false,
    },
    nextId: 19,
  };
}

/**
 * The draft this browser kept, or null.
 *
 * Read defensively: it is the one thing on the page somebody could have
 * edited by hand, and a draft from a later shape of this file must not take
 * the page down — it is simply not used.
 */
export function readSavedDraft(): InvoiceDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InvoiceDraft> | null;
    if (!parsed || parsed.v !== 1) return null;
    if (
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.billTo) ||
      !Array.isArray(parsed.billFrom) ||
      !Array.isArray(parsed.pay) ||
      typeof parsed.hidden !== "object"
    ) {
      return null;
    }
    /* A draft kept before the one colour became two (29 Sep 2026) gives
       its colour to both. */
    const legacy = parsed as Partial<InvoiceDraft> & { primary?: string };
    const colours =
      typeof legacy.primary === "string" && !legacy.background
        ? { background: legacy.primary, heading: legacy.primary }
        : {};
    // Filled over a fresh one, so a field added later has a value.
    const { primary: _primary, ...rest } = legacy;
    void _primary;
    return { ...freshDraft(null), ...rest, ...colours } as InvoiceDraft;
  } catch {
    return null;
  }
}

/** False when the browser would not keep it — full, or storage switched off. */
export function saveDraft(draft: InvoiceDraft): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function forgetDraft() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/**
 * An uploaded logo, scaled to what the sheet prints.
 *
 * The sheet shows the logo 30px tall and at most 175px wide; three times that
 * is sharp on paper and in the PDF, and is a few tens of KB rather than the
 * megabytes a logo straight off a designer's disk can be. WebP where the
 * browser writes it (it keeps a transparent background, and is smaller), PNG
 * where it does not. Null when even the scaled image is too large to save.
 */
export async function shrinkLogo(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || 525;
    const height = image.naturalHeight || 90;
    const scale = Math.min(1, 90 / height, 525 / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const type of ["image/webp", "image/png"]) {
      const data = canvas.toDataURL(type, 0.92);
      if (data.startsWith(`data:${type}`) && data.length <= MAX_LOGO_CHARS) {
        return data;
      }
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * What is wrong with the invoice as it stands, in a sentence, or null.
 *
 * The same refusals the server makes, said before the request rather than
 * after it — and the size one especially, which the server cannot say at all.
 */
export function problemWith(draft: InvoiceDraft): string | null {
  if (!draft.number.trim()) return "Give the invoice a number.";
  for (const [index, item] of draft.items.entries()) {
    if (priceMinor(item.price) === null) {
      return `Item ${index + 1}: the unit price is not an amount.`;
    }
    if (qtyMilli(item.qty) === null) {
      return `Item ${index + 1}: the quantity is not a number (up to 3 decimals).`;
    }
  }
  if (JSON.stringify(draft).length > MAX_DOCUMENT_CHARS) {
    return "This invoice is too large to save. Use a smaller logo, or shorten the longest descriptions.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  The arithmetic                                                             */
/* -------------------------------------------------------------------------- */

/* `BigInt(…)` rather than `0n`: the web app compiles to ES2017, which has no
   bigint literals. */
const ZERO = BigInt(0);
const HALF_THOUSAND = BigInt(500);
const HUNDRED = BigInt(100);
const THOUSAND = BigInt(1000);

/** A money box's text without the separators and symbols people type. */
export function plain(value: string): string {
  return value.replace(/[,\s৳$]/g, "").trim();
}

/** Taka as poisha, or null for something that is not an amount. */
export function priceMinor(value: string): bigint | null {
  const text = plain(value);
  if (text === "") return ZERO;
  if (!isValidAmount(text) || text.startsWith("-")) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
}

const QTY = /^\d{1,7}(\.\d{1,3})?$/;

/** The quantity in thousandths, or null for something that is not one. */
export function qtyMilli(value: string): bigint | null {
  const text = value.trim();
  if (text === "") return ZERO;
  if (!QTY.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * THOUSAND + BigInt(fraction.padEnd(3, "0"));
}

/**
 * A line's amount in poisha: price × quantity, rounded half up.
 *
 * Integers throughout — a quantity of 1.5 at ৳0.10 is 15 poisha, not
 * 0.15000000000000002 of a taka.
 */
export function lineMinor(item: LineItem): bigint {
  const price = priceMinor(item.price) ?? ZERO;
  const qty = qtyMilli(item.qty) ?? ZERO;
  return (price * qty + HALF_THOUSAND) / THOUSAND;
}

export function totalMinor(items: LineItem[]): bigint {
  return items.reduce((sum, item) => sum + lineMinor(item), ZERO);
}

export function asAmount(minor: bigint): string {
  return fromMinorUnits(minor);
}

/** Taka per dollar, or null when the box does not hold a positive rate. */
export function rateOf(value: string): number | null {
  const rate = Number(plain(value));
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Poisha in dollars at the rate, to the cent, as an amount string.
 *
 * Division is the one place a float is used, and it is display only: the
 * dollar column is an equivalent printed beside the taka, never a figure
 * anything adds up.
 */
export function inUsd(minor: bigint, rate: number): string {
  return (Number(minor) / 100 / rate).toFixed(2);
}

/** "#RRGGBB", or null — the colour boxes accept only the long form. */
export function hexColour(value: string): string | null {
  const text = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : null;
}
