import { formatMoney, type NumberFormat } from "@finance/shared";
import type { CSSProperties, Ref } from "react";

import {
  STATUS_COLOURS,
  asAmount,
  inUsd,
  lineMinor,
  priceMinor,
  rateOf,
  sheetDate,
  totalMinor,
  type InvoiceDraft,
  type TextLine,
} from "@/components/invoice-builder/invoice-draft";

/**
 * The invoice itself, one A4 page, drawn to the owner's builder.
 *
 * Its measurements, colours and blocks are lifted from
 * `invoice_builder_ShareViral.html` — the 6px accent rule, the logo on its
 * dark tile, the 40px title, the bill-to and bill-from columns, the four-cell
 * meta row, the black table head with the accent under it, the total on the
 * primary colour, the bank box edged in violet, the notes edged in the accent.
 *
 * Like the payslip it carries its own palette rather than the app's tokens: a
 * document with the company's branding on it must look the same in dark mode,
 * on paper and in the saved PDF a year later. Three of its colours are the
 * user's to pick and reach the sheet as `--inv-bg` (the logo's tile, the
 * table head, the total), `--inv-heading` (the title, the bold bill lines,
 * the project title, Payment Terms) and `--inv-accent`. What is written ON
 * the background follows it: white on a dark one, ink on a light one
 * (`--inv-on-bg`), so a pale background never leaves white text on white.
 *
 * Blocks with nothing in them are left out, as the builder did — an empty
 * bill column, a bank box with no rows.
 */
export function InvoiceSheet({
  draft,
  format,
  sheetRef,
}: {
  draft: InvoiceDraft;
  /** The company's digit grouping, for the taka. Dollars group their own way. */
  format: NumberFormat;
  sheetRef?: Ref<HTMLDivElement>;
}) {
  const rate = rateOf(draft.usdRate);
  const usd = draft.showUsd && rate !== null;
  const taka = (minor: bigint) => formatMoney(asAmount(minor), { format });
  const dollars = (minor: bigint) =>
    rate === null ? "—" : formatMoney(inUsd(minor, rate), { currency: "USD" });
  const total = totalMinor(draft.items);

  const billTo = filled(draft.billTo);
  const billFrom = filled(draft.billFrom);
  const bank = draft.pay.filter(
    (line) => line.label.trim() !== "" || line.value.trim() !== "",
  );
  const issued = sheetDate(draft.issuedOn);

  const lightBackground = isLight(draft.background);
  const palette = {
    "--inv-bg": draft.background,
    "--inv-heading": draft.heading,
    "--inv-accent": draft.accent,
    "--inv-badge": STATUS_COLOURS[draft.status],
    "--inv-on-bg": lightBackground ? "#14181f" : "#ffffff",
    /* The total's figure is the accent on a dark tile, as drawn; on a light
       one the accent (lime, by default) would not read, so the heading. */
    "--inv-total-figure": lightBackground ? draft.heading : draft.accent,
  } as CSSProperties;

  return (
    <div
      ref={sheetRef}
      className="inv-sheet"
      style={palette}
      data-invoice-sheet
    >
      <div className="inv-rule" />

      <div className="inv-head">
        <div>
          <div className="inv-logo">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the user picked, or the inline mark: nothing for next/image to optimise, and it must print. */}
            <img src={draft.logo ?? SHAREVIRAL_MARK} alt={draft.companyName} />
          </div>
          {draft.tagline.trim() ? (
            <div className="inv-tagline">{draft.tagline}</div>
          ) : null}
        </div>
        <div className="inv-title-block">
          <div className="inv-title">Invoice</div>
          <div className="inv-head-meta">
            <strong>Invoice Date:</strong>&nbsp;&nbsp;{issued}
            <br />
            <strong>Invoice Number:</strong>&nbsp;&nbsp;{draft.number}
          </div>
          <span className="inv-badge">{draft.status}</span>
        </div>
      </div>

      {!draft.hidden.bill && (billTo.length > 0 || billFrom.length > 0) ? (
        <div className="inv-bill">
          <BillColumn label="Invoice To" lines={billTo} />
          <BillColumn label="Invoice From" lines={billFrom} right />
        </div>
      ) : null}

      {!draft.hidden.meta ? (
        <div className="inv-meta">
          <MetaCell label="Currency" value={draft.currencyLabel} />
          <MetaCell label="Sales Period" value={draft.salesPeriod} />
          <MetaCell label="Invoice Date" value={issued} />
          <MetaCell label="Due Date" value={sheetDate(draft.dueOn)} />
        </div>
      ) : null}

      <div className="inv-order">
        <div className="inv-section-label">Order Details</div>
        {draft.projectTitle.trim() ? (
          <div className="inv-order-name">{draft.projectTitle}</div>
        ) : null}
        <table className="inv-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th className="c">Qty</th>
              <th className="c">Unit Price (৳)</th>
              {usd ? <th className="c">Unit Price ($)</th> : null}
              <th className={usd ? "c" : undefined}>Amount (৳)</th>
              {usd ? <th>Amount ($)</th> : null}
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item, index) => {
              const price = priceMinor(item.price) ?? BigInt(0);
              const amount = lineMinor(item);
              return (
                <tr key={item.id}>
                  <td>{index + 1}</td>
                  <td>{item.description.trim() || "—"}</td>
                  <td className="c">{item.qty.trim() || "0"}</td>
                  <td className="c">{taka(price)}</td>
                  {usd ? <td className="c">{dollars(price)}</td> : null}
                  <td className={usd ? "c" : undefined}>{taka(amount)}</td>
                  {usd ? <td>{dollars(amount)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="inv-totals">
        <div className="inv-totals-box">
          <div className="inv-total">
            <span>Total Amount</span>
            <span>{taka(total)}</span>
          </div>
          {usd ? (
            <div className="inv-usd">
              <span>Equivalent (USD)</span>
              <span>≈ {dollars(total)} USD</span>
            </div>
          ) : null}
        </div>
      </div>

      {!draft.hidden.terms ? (
        <div className="inv-terms">
          <strong>Payment Terms</strong>
          <span>{draft.payTerms}</span>
        </div>
      ) : null}

      {!draft.hidden.bank && bank.length > 0 ? (
        <div className="inv-bank">
          <div className="inv-bank-title">Transfer / Payment Information</div>
          <div className="inv-bank-grid">
            {bank.map((line) => (
              <div key={line.id}>
                {line.label.trim() ? (
                  <div className="inv-bank-label">{line.label}</div>
                ) : null}
                <div
                  className="inv-bank-value"
                  style={{
                    fontSize: `${line.size}px`,
                    fontWeight: line.bold ? 700 : 500,
                  }}
                >
                  {line.value.trim() || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!draft.hidden.notes && draft.notes.trim() ? (
        <div className="inv-notes">
          <div className="inv-notes-label">Notes</div>
          <div className="inv-notes-text">{draft.notes}</div>
        </div>
      ) : null}

      <div className="inv-footer">
        <span>
          <span className="inv-footer-company">{draft.companyName}</span>
          {draft.tagline.trim() ? (
            <>
              <span className="inv-footer-dot">•</span>
              {draft.tagline}
            </>
          ) : null}
        </span>
        <span>
          {draft.number} · {issued}
        </span>
      </div>
    </div>
  );
}

/**
 * Whether a colour is light enough that white on it would not read — the
 * relative luminance of WCAG, past the point where ink contrasts better.
 */
function isLight(hex: string): boolean {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const [r, g, b] = match
    .slice(1)
    .map((part) => parseInt(part, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179;
}

function filled(lines: TextLine[]): TextLine[] {
  return lines.filter((line) => line.text.trim() !== "");
}

function BillColumn({
  label,
  lines,
  right = false,
}: {
  label: string;
  lines: TextLine[];
  right?: boolean;
}) {
  return (
    <div className={right ? "inv-bill-right" : undefined}>
      <div className="inv-bill-label">{label}</div>
      {lines.map((line) => (
        <div
          key={line.id}
          className="inv-bill-line"
          style={{
            fontSize: `${line.size}px`,
            fontWeight: line.bold ? 700 : 400,
            color: line.bold ? "var(--inv-heading)" : "#555555",
          }}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="inv-meta-label">{label}</div>
      <div className="inv-meta-value">{value || "—"}</div>
    </div>
  );
}

/**
 * The ShareViral mark the builder shipped with: the lime tile with the rising
 * line, and the name in white — which is why the logo sits on a dark tile.
 */
export const SHAREVIRAL_MARK = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 215 48" width="215" height="48"><rect x="2" y="9" width="30" height="30" rx="9" fill="#bfff00"/><g fill="none" stroke="#0a0a0a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 31 15 24 19 28 26 19"/><polyline points="21 19 26 19 26 24"/></g><text x="42" y="32" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800" fill="#ffffff" letter-spacing="-0.5">ShareViral<tspan font-size="10" font-weight="700" dy="-9" fill="#ffffff">™</tspan></text></svg>`,
)}`;

/**
 * Prints the sheet, and nothing else, through a frame of its own.
 *
 * `window.print()` on the page would print the sidebar and the top bar with
 * it, and hiding the rest of the app for print means rules in the app's
 * shell for one screen. A frame holding only the sheet — with the app's
 * stylesheets, for its font — prints exactly the page on screen. The frame's
 * title is the invoice number, which is what the browser offers as the PDF's
 * file name.
 */
export async function printSheet(sheet: HTMLElement, title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";

  const styles = Array.from(
    document.head.querySelectorAll('link[rel="stylesheet"], style'),
  )
    .map((node) => node.outerHTML)
    .join("");

  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title>${styles}<style>${SHEET_CSS}${FRAME_CSS}</style></head><body>${
    sheet.outerHTML
  }</body></html>`;
  document.body.appendChild(frame);
  await loaded;

  const view = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!view || !doc) {
    frame.remove();
    return;
  }
  // The font and the logo, before the page is laid out for paper.
  await doc.fonts?.ready;
  await Promise.all(
    Array.from(doc.images).map((image) =>
      image.decode().catch(() => undefined),
    ),
  );
  fitToOnePage(doc);

  const remove = () => window.setTimeout(() => frame.remove(), 0);
  view.addEventListener("afterprint", remove, { once: true });
  // A browser that never says the dialog closed still loses the frame.
  window.setTimeout(() => frame.remove(), 10 * 60 * 1000);
  view.focus();
  view.print();
}

/** 296mm at 96px to the inch — a hair under A4's 297, as the builder had it. */
const PAGE_HEIGHT = (296 / 25.4) * 96;
const SMALLEST_FIT = 0.8;

/**
 * A sheet a little longer than a page prints a little smaller, rather than
 * leaving its footer alone on a second sheet of paper.
 *
 * The builder's own layout fills an A4 page with one line item; a second item
 * or a sixth address line pushed the footer over. Up to a fifth over, the
 * sheet is zoomed to fit — laid out that much wider and taller first, so it
 * still spans the page edge to edge and the footer still sits at its foot.
 * Longer than that, it runs on to a second page at full size: shrinking a
 * long invoice to one page makes it unreadable, not tidy.
 */
function fitToOnePage(doc: Document) {
  const sheet = doc.querySelector<HTMLElement>(".inv-sheet");
  if (!sheet) return;
  sheet.style.minHeight = "0";
  const height = sheet.getBoundingClientRect().height;
  sheet.style.minHeight = "";
  if (height <= PAGE_HEIGHT || height * SMALLEST_FIT > PAGE_HEIGHT) return;

  const scale = Math.floor((PAGE_HEIGHT / height) * 1000) / 1000;
  sheet.style.zoom = String(scale);
  sheet.style.width = `calc(210mm / ${scale})`;
  sheet.style.maxWidth = "none";
  sheet.style.minHeight = `calc(296mm / ${scale})`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The print frame's page: white, no margin, the sheet at the top. */
const FRAME_CSS = `
html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }
body { display: block !important; min-height: 0 !important; }
`;

/**
 * Scoped, in `px`, and outside the app's tokens, for the payslip's reason:
 * one printed document with fixed measurements, not a screen that follows
 * the app's spacing or the reader's theme. The class names are the builder's
 * with an `inv-` prefix.
 */
export const SHEET_CSS = `
.inv-sheet {
  --inv-secondary: #805cf6;
  --inv-ink: #14181f;
  --inv-ink-soft: #5a6173;
  --inv-line: #e6e8ee;

  width: 794px;
  min-height: 1123px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  color: var(--inv-ink);
  font-family: var(--sv-font, "Plus Jakarta Sans Variable"), system-ui, sans-serif;
  /* The builder's: nothing set, so the font's own. 1.4 pushed the default
     invoice 6px past one A4 page. */
  line-height: normal;
  text-align: left;
  box-shadow: 0 6px 40px rgb(0 0 0 / 0.13);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.inv-sheet * { box-sizing: border-box; }
.inv-rule { height: 6px; background: var(--inv-accent); }

.inv-head {
  padding: 28px 44px 22px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  border-bottom: 1px solid var(--inv-line);
}
.inv-logo {
  display: inline-flex;
  align-items: center;
  margin-bottom: 7px;
  padding: 9px 16px;
  border-radius: 10px;
  background: var(--inv-bg);
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.12);
}
.inv-logo img { display: block; height: 30px; max-width: 175px; object-fit: contain; }
.inv-tagline { padding-left: 2px; font-size: 11px; font-weight: 500; color: var(--inv-ink-soft); }
.inv-title-block { text-align: right; }
.inv-title {
  font-size: 40px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -1.5px;
  color: var(--inv-heading);
}
.inv-head-meta { margin-top: 8px; font-size: 11.5px; line-height: 2; color: var(--inv-ink-soft); }
.inv-head-meta strong { font-weight: 600; color: var(--inv-ink); }
.inv-badge {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 13px;
  border-radius: 20px;
  background: var(--inv-badge);
  color: #ffffff;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.6px;
}

.inv-bill {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  padding: 18px 44px;
  border-bottom: 1px solid #e4e8f0;
}
.inv-bill-right { text-align: right; }
.inv-bill-label {
  margin-bottom: 7px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--inv-secondary);
}
.inv-bill-line { line-height: 1.7; overflow-wrap: anywhere; }

.inv-meta {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 11px 44px;
  background: #fafbfc;
  border-bottom: 1px solid #e4e8f0;
}
.inv-meta-label {
  margin-bottom: 3px;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #9aa3bb;
}
.inv-meta-value { font-size: 12px; font-weight: 500; color: #1a2340; }

.inv-order { padding: 20px 44px 0; }
.inv-section-label {
  margin-bottom: 4px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #9aa3bb;
}
.inv-order-name { margin-bottom: 14px; font-size: 14px; font-weight: 700; color: var(--inv-heading); }
.inv-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.inv-table thead tr { background: var(--inv-bg); }
.inv-table thead th {
  padding: 11px 10px;
  border-bottom: 2px solid var(--inv-accent);
  color: var(--inv-on-bg);
  font-size: 11.5px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.inv-table thead th:first-child { width: 30px; padding-left: 16px; }
.inv-table thead th:last-child { padding-right: 16px; text-align: right; }
.inv-table thead th.c { text-align: center; }
.inv-table tbody tr { border-bottom: 1px solid #f0f2f5; }
.inv-table tbody td { padding: 11px 10px; font-size: 12.5px; color: #2c3a55; vertical-align: top; }
.inv-table tbody td:first-child { padding-left: 16px; font-size: 11.5px; color: #aab0c0; }
.inv-table tbody td:last-child { padding-right: 16px; text-align: right; white-space: nowrap; }
.inv-table tbody td.c { text-align: center; white-space: nowrap; }

.inv-totals { display: flex; justify-content: flex-end; padding: 10px 44px 18px; }
.inv-totals-box { width: 270px; }
.inv-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 5px;
  padding: 11px 16px;
  border-radius: 8px;
  background: var(--inv-bg);
  color: var(--inv-on-bg);
  font-size: 12.5px;
  font-weight: 700;
}
.inv-total span:first-child { white-space: nowrap; }
.inv-total span:last-child { color: var(--inv-total-figure); font-size: 14px; font-weight: 800; white-space: nowrap; }
.inv-usd {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 5px;
  padding: 7px 16px;
  border-radius: 8px;
  background: #f4f0ff;
  color: var(--inv-secondary);
  font-size: 11.5px;
  font-weight: 600;
}
.inv-usd span:last-child { font-weight: 700; white-space: nowrap; }

.inv-terms {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 44px;
  border-top: 1px solid #e4e8f0;
  border-bottom: 1px solid #e4e8f0;
  font-size: 12.5px;
}
.inv-terms strong { font-weight: 700; color: var(--inv-heading); }
.inv-terms span { color: #555555; }

.inv-bank {
  margin: 16px 44px;
  padding: 16px 20px;
  border: 1px solid var(--inv-line);
  border-left: 4px solid var(--inv-secondary);
  border-radius: 8px;
}
.inv-bank-title {
  margin-bottom: 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--inv-secondary);
}
.inv-bank-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 28px; }
.inv-bank-label {
  margin-bottom: 2px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: #9aa3bb;
}
.inv-bank-value { color: #1a2340; overflow-wrap: anywhere; }

.inv-notes {
  margin: 0 44px 20px;
  padding: 11px 16px;
  border: 1px solid color-mix(in srgb, var(--inv-accent) 35%, #ffffff);
  border-left: 4px solid var(--inv-accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--inv-accent) 12%, #ffffff);
}
.inv-notes-label {
  margin-bottom: 4px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--inv-accent) 45%, #000000);
}
.inv-notes-text { font-size: 12px; line-height: 1.6; color: #555555; white-space: pre-wrap; }

/* The footer keeps to the foot of the page when the invoice is short. */
.inv-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding: 11px 44px;
  background: #fafbfc;
  border-top: 1px solid #e4e8f0;
  font-size: 10.5px;
  color: #9aa3bb;
}
.inv-footer-company { font-weight: 700; color: var(--inv-ink); }
.inv-footer-dot { margin: 0 6px; font-weight: 700; color: var(--inv-accent); }

@media print {
  @page { size: A4; margin: 0; }
  .inv-sheet { width: 210mm; max-width: 100%; min-height: 296mm; box-shadow: none; }
}
`;
