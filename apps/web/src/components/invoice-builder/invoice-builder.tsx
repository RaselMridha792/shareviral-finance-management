"use client";

import { formatMoney } from "@finance/shared";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr/Buildings";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { FilePlusIcon } from "@phosphor-icons/react/dist/ssr/FilePlus";
import { ListBulletsIcon } from "@phosphor-icons/react/dist/ssr/ListBullets";
import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil";
import { PaletteIcon } from "@phosphor-icons/react/dist/ssr/Palette";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { ReceiptIcon } from "@phosphor-icons/react/dist/ssr/Receipt";
import { TextBIcon } from "@phosphor-icons/react/dist/ssr/TextB";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr/UploadSimple";
import { UserCircleIcon } from "@phosphor-icons/react/dist/ssr/UserCircle";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from "react";

import {
  MAX_LOGO_BYTES,
  STATUSES,
  asAmount,
  forgetDraft,
  freshDraft,
  hexColour,
  inUsd,
  lineMinor,
  priceMinor,
  qtyMilli,
  rateOf,
  readSavedDraft,
  saveDraft,
  totalMinor,
  type Block,
  type InvoiceDraft,
  type InvoiceStatus,
  type LineItem,
  type PayLine,
  type TextLine,
} from "@/components/invoice-builder/invoice-draft";
import {
  InvoiceSheet,
  SHAREVIRAL_MARK,
  SHEET_CSS,
  printSheet,
} from "@/components/invoice-builder/invoice-sheet";
import { useUsdRate } from "@/components/money/rate-provider";
import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

/**
 * The Invoice Builder: the invoice's contents on the left, the A4 sheet on
 * the right following every keystroke, and a PDF from the browser's print.
 *
 * Asked for on 28 Sep 2026 — *"amar application a notun ekta features anbo.
 * eta sidebar a add koro eta hobe invoice builder name"* — with the owner's
 * own builder attached as a single HTML page. Everything that page could do,
 * this does: the brand and its two colours, the status badge, the flexible
 * bill-to and bill-from lines with their bold and size, line items in taka
 * with the dollar equivalent at a typed rate, the bank rows, the notes, and
 * the eye buttons that leave a block off the sheet.
 *
 * It keeps nothing on the server — an invoice here is a document, not a
 * ledger entry, and nothing in the books changes because one was drawn. What
 * is typed is kept in this browser, so a reload does not lose it.
 */
export function InvoiceBuilder() {
  /* The draft lives in this browser's storage, which the server cannot read —
     so the server draws the header alone, and the builder starts on the
     client with the kept draft already in its first render. */
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const rate = useUsdRate();

  if (!mounted) {
    return (
      <>
        <Header />
        <Card className="h-[480px] animate-pulse" />
      </>
    );
  }
  return <Builder initial={readSavedDraft() ?? freshDraft(rate)} rate={rate} />;
}

function subscribeNothing() {
  return () => {};
}

function Header({
  onReset,
  onDownload,
}: {
  onReset?: () => void;
  onDownload?: () => void;
}) {
  return (
    <PageHeader
      title="Invoice Builder"
      icon={FilePlusIcon}
      description="Fill in the left and the invoice follows. Download saves it as a PDF."
      actions={
        <>
          <Button
            variant="secondary"
            onClick={onReset}
            disabled={!onReset}
            data-invoice-reset
          >
            <ArrowCounterClockwiseIcon weight="bold" size={16} />
            Reset
          </Button>
          <Button
            variant="primary"
            onClick={onDownload}
            disabled={!onDownload}
            data-invoice-download
          >
            <DownloadSimpleIcon weight="bold" size={16} />
            Download PDF
          </Button>
        </>
      }
    />
  );
}

type SectionKey = "brand" | "info" | "to" | "from" | "items" | "pay" | "notes";

function Builder({
  initial,
  rate,
}: {
  initial: InvoiceDraft;
  rate: number | null;
}) {
  const settings = useSettings();
  const [draft, setDraft] = useState(initial);
  /* Bumped by Reset, so the boxes that hold their own text (the colours)
     start again with the draft. */
  const [generation, setGeneration] = useState(0);
  const [closed, setClosed] = useState<Record<SectionKey, boolean>>({
    brand: false,
    info: false,
    to: false,
    from: false,
    items: false,
    pay: false,
    notes: false,
  });
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [kept, setKept] = useState(true);
  const [logoError, setLogoError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  /* Kept a moment after the typing stops, not on every key — a logo makes
     the draft a large string. */
  useEffect(() => {
    const id = window.setTimeout(() => setKept(saveDraft(draft)), 400);
    return () => window.clearTimeout(id);
  }, [draft]);

  const patch = (changes: Partial<InvoiceDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const toggleSection = (key: SectionKey) =>
    setClosed((current) => ({ ...current, [key]: !current[key] }));

  const toggleBlock = (block: Block) =>
    setDraft((current) => ({
      ...current,
      hidden: { ...current.hidden, [block]: !current.hidden[block] },
    }));

  /* --- the flexible lines ------------------------------------------------ */

  type LineList = "billTo" | "billFrom";

  const updateLine = (list: LineList, id: number, changes: Partial<TextLine>) =>
    setDraft((current) => ({
      ...current,
      [list]: current[list].map((line) =>
        line.id === id ? { ...line, ...changes } : line,
      ),
    }));

  const addLine = (list: LineList) =>
    setDraft((current) => ({
      ...current,
      [list]: [
        ...current[list],
        { id: current.nextId, text: "", bold: false, size: 12 },
      ],
      nextId: current.nextId + 1,
    }));

  // The last line stays, as in the builder — a column needs somewhere to type.
  const removeLine = (list: LineList, id: number) =>
    setDraft((current) =>
      current[list].length <= 1
        ? current
        : {
            ...current,
            [list]: current[list].filter((line) => line.id !== id),
          },
    );

  const updatePay = (id: number, changes: Partial<PayLine>) =>
    setDraft((current) => ({
      ...current,
      pay: current.pay.map((line) =>
        line.id === id ? { ...line, ...changes } : line,
      ),
    }));

  const addPay = () =>
    setDraft((current) => ({
      ...current,
      pay: [
        ...current.pay,
        { id: current.nextId, label: "", value: "", bold: false, size: 12.5 },
      ],
      nextId: current.nextId + 1,
    }));

  const removePay = (id: number) =>
    setDraft((current) =>
      current.pay.length <= 1
        ? current
        : { ...current, pay: current.pay.filter((line) => line.id !== id) },
    );

  const updateItem = (id: number, changes: Partial<LineItem>) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    }));

  const addItem = () =>
    setDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        { id: current.nextId, description: "", qty: "1", price: "" },
      ],
      nextId: current.nextId + 1,
    }));

  const removeItem = (id: number) =>
    setDraft((current) =>
      current.items.length <= 1
        ? current
        : { ...current, items: current.items.filter((item) => item.id !== id) },
    );

  /* --- the logo ---------------------------------------------------------- */

  function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError("That is not an image. Pick a PNG, JPG or SVG.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("That image is over 1 MB. Pick a smaller one.");
      return;
    }
    setLogoError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") patch({ logo: reader.result });
    };
    reader.readAsDataURL(file);
  }

  function startAgain() {
    forgetDraft();
    setDraft(freshDraft(rate));
    setGeneration((value) => value + 1);
    setConfirmingReset(false);
    setLogoError(null);
  }

  function download() {
    if (!sheetRef.current) return;
    void printSheet(sheetRef.current, draft.number.trim() || "Invoice");
  }

  /* --- figures ----------------------------------------------------------- */

  const usdRate = rateOf(draft.usdRate);
  const total = totalMinor(draft.items);
  const taka = (minor: bigint) =>
    formatMoney(asAmount(minor), { format: settings.numberFormat });

  return (
    <>
      <style>{SHEET_CSS}</style>
      <Header onReset={() => setConfirmingReset(true)} onDownload={download} />

      {/*
        The preview is only as wide as the sheet — 794px, the padding and a
        thin scrollbar — and sits at the right-hand end; the form takes the
        rest. A preview column wider than its page left an empty band on
        either side of it, which the owner asked to be gone (28 Sep 2026).
        Where there is less room the preview gives way first, down to the
        form's 400px, and the sheet zooms to fit.
      */}
      <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(400px,1fr)_minmax(0,856px)]">
        <div key={generation} className="flex min-w-0 flex-col gap-3">
          {confirmingReset ? (
            <div
              role="alert"
              className="sv-note-violet flex flex-col gap-3 rounded-[11px] bg-(--sv-violet-tint) px-4 py-3.5"
            >
              <p className="text-[13.5px]">
                <span className="font-extrabold">Start a fresh invoice?</span>{" "}
                Everything typed here goes back to the ShareViral defaults.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={startAgain}
                  data-invoice-reset-confirm
                >
                  Start fresh
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmingReset(false)}
                >
                  Keep editing
                </Button>
              </div>
            </div>
          ) : null}

          {!kept ? (
            <p
              role="status"
              className="rounded-[11px] bg-(--sv-neg-tint) px-4 py-3 text-[13px] text-(--sv-neg)"
            >
              This browser would not keep the draft — the logo may be too large.
              The invoice on screen is not affected; download it before you
              leave.
            </p>
          ) : null}

          {/* --- Brand -------------------------------------------------- */}
          <Section
            id="brand"
            icon={PaletteIcon}
            title="Brand and colours"
            open={!closed.brand}
            onToggle={() => toggleSection("brand")}
          >
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-extrabold">Company logo</span>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="inline-flex h-12 items-center rounded-[10px] px-3.5"
                  style={{ background: draft.primary }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the logo as the sheet shows it, from a data URL */}
                  <img
                    src={draft.logo ?? SHAREVIRAL_MARK}
                    alt=""
                    className="max-h-[30px] max-w-[160px] object-contain"
                  />
                </span>
                <label className="inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-lg bg-(--sv-violet-tint) px-[13px] text-[13px] font-extrabold text-(--sv-violet-ink)">
                  <UploadSimpleIcon weight="bold" size={15} />
                  Upload logo
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={onLogo}
                    data-invoice-logo
                  />
                </label>
                {draft.logo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ logo: null })}
                  >
                    Use the ShareViral mark
                  </Button>
                ) : null}
              </div>
              {logoError ? (
                <span className="text-[12px] font-semibold text-(--sv-neg)">
                  {logoError}
                </span>
              ) : (
                <span className="text-[12px] text-(--sv-muted)">
                  Shown on the primary colour, up to 1 MB.
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="Company name">
                <Input
                  value={draft.companyName}
                  onChange={(event) =>
                    patch({ companyName: event.target.value })
                  }
                  data-invoice-field="companyName"
                />
              </Field>
              <Field label="Tagline">
                <Input
                  value={draft.tagline}
                  onChange={(event) => patch({ tagline: event.target.value })}
                  data-invoice-field="tagline"
                />
              </Field>
              <ColourField
                label="Primary colour"
                value={draft.primary}
                onChange={(primary) => patch({ primary })}
              />
              <ColourField
                label="Accent colour"
                value={draft.accent}
                onChange={(accent) => patch({ accent })}
              />
            </div>
            <Field label="Status badge">
              <Select
                value={draft.status}
                onChange={(event) =>
                  patch({ status: event.target.value as InvoiceStatus })
                }
                data-invoice-field="status"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>

          {/* --- Invoice info ------------------------------------------- */}
          <Section
            id="info"
            icon={ReceiptIcon}
            title="Invoice info"
            open={!closed.info}
            onToggle={() => toggleSection("info")}
            eyes={
              <Eye
                label="Meta row"
                shown={!draft.hidden.meta}
                onToggle={() => toggleBlock("meta")}
              />
            }
          >
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="Invoice number">
                <Input
                  value={draft.number}
                  onChange={(event) => patch({ number: event.target.value })}
                  data-invoice-field="number"
                />
              </Field>
              <Field label="Base currency" hint="Every figure is in taka">
                <Input value="BDT" readOnly disabled />
              </Field>
              <Field label="Invoice date">
                <DateInput
                  value={draft.issuedOn}
                  onChange={(event) => patch({ issuedOn: event.target.value })}
                  data-invoice-field="issuedOn"
                />
              </Field>
              <Field label="Due date">
                <DateInput
                  value={draft.dueOn}
                  onChange={(event) => patch({ dueOn: event.target.value })}
                  data-invoice-field="dueOn"
                />
              </Field>
              <Field label="Currency display">
                <Input
                  value={draft.currencyLabel}
                  onChange={(event) =>
                    patch({ currencyLabel: event.target.value })
                  }
                />
              </Field>
              <Field label="Sales period">
                <Input
                  value={draft.salesPeriod}
                  onChange={(event) =>
                    patch({ salesPeriod: event.target.value })
                  }
                />
              </Field>
              <Field label="Show USD equivalent">
                <Select
                  value={draft.showUsd ? "yes" : "no"}
                  onChange={(event) =>
                    patch({ showUsd: event.target.value === "yes" })
                  }
                  data-invoice-field="showUsd"
                >
                  <option value="yes">Yes — show USD</option>
                  <option value="no">No — BDT only</option>
                </Select>
              </Field>
              <Field
                label="USD rate"
                hint="Taka for one dollar"
                error={
                  draft.showUsd && usdRate === null
                    ? ["A rate above zero"]
                    : undefined
                }
              >
                <Input
                  value={draft.usdRate}
                  inputMode="decimal"
                  className="col-amount"
                  aria-invalid={draft.showUsd && usdRate === null}
                  onChange={(event) => patch({ usdRate: event.target.value })}
                  data-invoice-field="usdRate"
                />
              </Field>
            </div>
          </Section>

          {/* --- Invoice to / from -------------------------------------- */}
          <Section
            id="to"
            icon={UserCircleIcon}
            title="Invoice to (client)"
            open={!closed.to}
            onToggle={() => toggleSection("to")}
            eyes={
              <Eye
                label="Bill section"
                shown={!draft.hidden.bill}
                onToggle={() => toggleBlock("bill")}
              />
            }
          >
            <LineEditor
              list="billTo"
              lines={draft.billTo}
              onChange={(id, changes) => updateLine("billTo", id, changes)}
              onAdd={() => addLine("billTo")}
              onRemove={(id) => removeLine("billTo", id)}
            />
          </Section>

          <Section
            id="from"
            icon={BuildingsIcon}
            title="Invoice from (you)"
            open={!closed.from}
            onToggle={() => toggleSection("from")}
          >
            <LineEditor
              list="billFrom"
              lines={draft.billFrom}
              onChange={(id, changes) => updateLine("billFrom", id, changes)}
              onAdd={() => addLine("billFrom")}
              onRemove={(id) => removeLine("billFrom", id)}
            />
          </Section>

          {/* --- Line items --------------------------------------------- */}
          <Section
            id="items"
            icon={ListBulletsIcon}
            title="Line items"
            open={!closed.items}
            onToggle={() => toggleSection("items")}
          >
            <Field label="Project or service title">
              <Input
                value={draft.projectTitle}
                onChange={(event) =>
                  patch({ projectTitle: event.target.value })
                }
                data-invoice-field="projectTitle"
              />
            </Field>

            {draft.items.map((item, index) => {
              const badQty = qtyMilli(item.qty) === null;
              const badPrice = priceMinor(item.price) === null;
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-[11px] bg-(--sv-subtle) p-3.5"
                  data-invoice-item
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-(--sv-surface) px-2 py-0.5 text-[11px] font-extrabold tracking-[0.08em] text-(--sv-muted) uppercase">
                      Item {index + 1}
                    </span>
                    <span className="num ml-auto text-[13.5px] font-extrabold">
                      {taka(lineMinor(item))}
                    </span>
                    <RemoveButton
                      label={`Remove item ${index + 1}`}
                      disabled={draft.items.length <= 1}
                      onClick={() => removeItem(item.id)}
                    />
                  </div>
                  <Field label="Description">
                    <Input
                      value={item.description}
                      placeholder="What was delivered"
                      className="bg-(--sv-surface)"
                      onChange={(event) =>
                        updateItem(item.id, { description: event.target.value })
                      }
                      data-invoice-item-field="description"
                    />
                  </Field>
                  <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
                    <Field
                      label="Qty"
                      error={
                        badQty ? ["A number, up to 3 decimals"] : undefined
                      }
                    >
                      <Input
                        value={item.qty}
                        inputMode="decimal"
                        className="col-amount bg-(--sv-surface)"
                        aria-invalid={badQty}
                        onChange={(event) =>
                          updateItem(item.id, { qty: event.target.value })
                        }
                        data-invoice-item-field="qty"
                      />
                    </Field>
                    <Field
                      label="Unit price (BDT)"
                      error={
                        badPrice ? ["An amount like 1800000.00"] : undefined
                      }
                    >
                      <MoneyInput
                        value={item.price}
                        placeholder="0.00"
                        className="bg-(--sv-surface)"
                        aria-invalid={badPrice}
                        onChange={(event) =>
                          updateItem(item.id, { price: event.target.value })
                        }
                        data-invoice-item-field="price"
                      />
                    </Field>
                  </div>
                </div>
              );
            })}

            <AddButton onClick={addItem} data-invoice-add-item>
              Add line item
            </AddButton>

            <div className="flex flex-col gap-1.5 rounded-[11px] bg-(--sv-violet-tint) p-3">
              <div className="flex items-center justify-between gap-3 rounded-lg bg-(--sv-ink) px-3.5 py-2.5 text-[13.5px] font-extrabold text-(--sv-surface)">
                <span>Total</span>
                <span className="num" data-invoice-total>
                  {taka(total)} BDT
                </span>
              </div>
              {draft.showUsd && usdRate !== null ? (
                <div className="flex items-center justify-between gap-3 px-1 text-[13px] text-(--sv-violet-ink)">
                  <span>USD equivalent</span>
                  <span className="num font-extrabold" data-invoice-total-usd>
                    {formatMoney(inUsd(total, usdRate), { currency: "USD" })}
                  </span>
                </div>
              ) : null}
            </div>
          </Section>

          {/* --- Payment ------------------------------------------------ */}
          <Section
            id="pay"
            icon={BankIcon}
            title="Payment info"
            open={!closed.pay}
            onToggle={() => toggleSection("pay")}
            eyes={
              <>
                <Eye
                  label="Pay terms"
                  shown={!draft.hidden.terms}
                  onToggle={() => toggleBlock("terms")}
                />
                <Eye
                  label="Bank info"
                  shown={!draft.hidden.bank}
                  onToggle={() => toggleBlock("bank")}
                />
              </>
            }
          >
            <Field label="Payment terms">
              <Input
                value={draft.payTerms}
                onChange={(event) => patch({ payTerms: event.target.value })}
              />
            </Field>
            <p className="text-[12px] font-extrabold tracking-[0.1em] text-(--sv-muted) uppercase">
              Bank rows — an empty row is left off
            </p>
            {draft.pay.map((line, index) => (
              <div
                key={line.id}
                className="flex flex-col gap-2 rounded-[11px] bg-(--sv-subtle) p-2.5"
                data-invoice-pay
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    value={line.label}
                    placeholder="Label, e.g. Bank Name"
                    aria-label={`Bank row ${index + 1} label`}
                    className="h-[38px] min-w-0 flex-1 bg-(--sv-surface) text-[12.5px] font-extrabold tracking-[0.04em] text-(--sv-muted) uppercase"
                    onChange={(event) =>
                      updatePay(line.id, { label: event.target.value })
                    }
                  />
                  <BoldButton
                    on={line.bold}
                    onClick={() => updatePay(line.id, { bold: !line.bold })}
                  />
                  <SizeInput
                    value={line.size}
                    onChange={(size) => updatePay(line.id, { size })}
                  />
                  <RemoveButton
                    label={`Remove bank row ${index + 1}`}
                    disabled={draft.pay.length <= 1}
                    onClick={() => removePay(line.id)}
                  />
                </div>
                <Input
                  value={line.value}
                  placeholder="Value, e.g. Standard Chartered Bank"
                  aria-label={`Bank row ${index + 1} value`}
                  className="bg-(--sv-surface)"
                  onChange={(event) =>
                    updatePay(line.id, { value: event.target.value })
                  }
                />
              </div>
            ))}
            <AddButton onClick={addPay}>Add bank row</AddButton>
          </Section>

          {/* --- Notes -------------------------------------------------- */}
          <Section
            id="notes"
            icon={NotePencilIcon}
            title="Notes"
            open={!closed.notes}
            onToggle={() => toggleSection("notes")}
            eyes={
              <Eye
                label="Notes"
                shown={!draft.hidden.notes}
                onToggle={() => toggleBlock("notes")}
              />
            }
          >
            <Field label="Note text">
              <Textarea
                rows={5}
                value={draft.notes}
                onChange={(event) => patch({ notes: event.target.value })}
                data-invoice-field="notes"
              />
            </Field>
          </Section>
        </div>

        <Preview>
          <InvoiceSheet
            draft={draft}
            format={settings.numberFormat}
            sheetRef={sheetRef}
          />
        </Preview>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  The preview                                                                */
/* -------------------------------------------------------------------------- */

const SHEET_WIDTH = 794;

/**
 * The sheet at its real size where there is room, and shrunk to the column
 * where there is not — zoomed rather than scrolled sideways, so the whole
 * page is always in view while typing. Held in view beside the form on a wide
 * screen.
 */
function Preview({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? SHEET_WIDTH;
      setScale(Math.min(1, width / SHEET_WIDTH));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="min-w-0 rounded-[11px] bg-(--sv-subtle) p-[clamp(12px,2vw,24px)] [scrollbar-width:thin] xl:sticky xl:top-[84px] xl:max-h-[calc(100dvh-100px)] xl:overflow-y-auto"
      data-invoice-preview-box
    >
      <div ref={boxRef} className="flex justify-center">
        <div style={{ zoom: scale }} data-invoice-preview>
          {children}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The form's parts                                                           */
/* -------------------------------------------------------------------------- */

function Section({
  id,
  icon: Icon,
  title,
  open,
  onToggle,
  eyes,
  children,
}: {
  id: string;
  icon: PhosphorIcon;
  title: string;
  open: boolean;
  onToggle: () => void;
  /** The buttons that leave this section's blocks off the sheet. */
  eyes?: ReactNode;
  children: ReactNode;
}) {
  const bodyId = `invoice-section-${id}`;
  return (
    <Card data-invoice-section={id}>
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-3",
          open && "sv-panel-head",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-[11px] text-left"
        >
          <span className="grid size-9 flex-none place-items-center rounded-[11px] bg-(--sv-violet-tint) text-(--sv-violet)">
            <Icon weight="duotone" size={20} />
          </span>
          <span className="truncate text-[15px] font-extrabold tracking-[-0.01em]">
            {title}
          </span>
        </button>
        {eyes ? <div className="flex flex-none gap-1.5">{eyes}</div> : null}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Close ${title}` : `Open ${title}`}
          className="grid size-8 flex-none cursor-pointer place-items-center rounded-lg text-(--sv-muted) hover:bg-(--sv-subtle)"
        >
          <CaretDownIcon
            weight="bold"
            size={15}
            className={cn("transition-transform", !open && "-rotate-90")}
          />
        </button>
      </div>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-3.5 p-4">
          {children}
        </div>
      ) : null}
    </Card>
  );
}

/** Leaves a block off the sheet, or puts it back. */
function Eye({
  label,
  shown,
  onToggle,
}: {
  label: string;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      title={
        shown ? `Hide ${label} on the invoice` : `Show ${label} on the invoice`
      }
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[11.5px] font-extrabold whitespace-nowrap transition-colors",
        shown
          ? "bg-(--sv-violet-tint) text-(--sv-violet-ink)"
          : "bg-(--sv-subtle) text-(--sv-muted) line-through",
      )}
      data-invoice-eye={label}
    >
      {shown ? (
        <EyeIcon weight="bold" size={13} />
      ) : (
        <EyeSlashIcon weight="bold" size={13} />
      )}
      {label}
    </button>
  );
}

function LineEditor({
  list,
  lines,
  onChange,
  onAdd,
  onRemove,
}: {
  list: string;
  lines: TextLine[];
  onChange: (id: number, changes: Partial<TextLine>) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
}) {
  return (
    <>
      <p className="text-[12px] font-extrabold tracking-[0.1em] text-(--sv-muted) uppercase">
        Lines — an empty line is left off
      </p>
      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div
            key={line.id}
            className="flex items-center gap-1.5 rounded-[11px] bg-(--sv-subtle) p-2"
            data-invoice-line={list}
          >
            <Input
              value={line.text}
              placeholder="Enter text…"
              aria-label={`Line ${index + 1}`}
              className={cn(
                "min-w-0 flex-1 bg-(--sv-surface)",
                line.bold && "font-extrabold",
              )}
              onChange={(event) =>
                onChange(line.id, { text: event.target.value })
              }
            />
            <BoldButton
              on={line.bold}
              onClick={() => onChange(line.id, { bold: !line.bold })}
            />
            <SizeInput
              value={line.size}
              onChange={(size) => onChange(line.id, { size })}
            />
            <RemoveButton
              label={`Remove line ${index + 1}`}
              disabled={lines.length <= 1}
              onClick={() => onRemove(line.id)}
            />
          </div>
        ))}
      </div>
      <AddButton onClick={onAdd}>Add line</AddButton>
    </>
  );
}

function BoldButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label="Bold"
      title="Bold"
      className={cn(
        "grid size-8 flex-none cursor-pointer place-items-center rounded-lg transition-colors",
        on
          ? "bg-(--sv-ink) text-(--sv-surface)"
          : "bg-(--sv-surface) text-(--sv-muted) hover:text-(--sv-ink)",
      )}
    >
      <TextBIcon weight="bold" size={15} />
    </button>
  );
}

/**
 * The type size in px, 8 to 28 as the builder allowed.
 *
 * Holds what is typed until it is a size — typing 16 passes through 1, which
 * is not one, and a box bound straight to the size put 12 back under the
 * finger.
 */
function SizeInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (size: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Input
      type="number"
      min={8}
      max={28}
      step={0.5}
      value={text}
      aria-label="Font size in px"
      title="Font size (px)"
      className="h-[38px] w-[60px] flex-none bg-(--sv-surface) px-1.5 text-center text-[13px]"
      onChange={(event) => {
        setText(event.target.value);
        const size = Number(event.target.value);
        if (event.target.value !== "" && size >= 8 && size <= 28) {
          onChange(size);
        }
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled ? "The last one stays" : label}
      className="sv-row-button"
      data-tone="danger"
    >
      <XIcon weight="bold" size={14} />
    </button>
  );
}

function AddButton({
  children,
  ...props
}: { children: ReactNode; onClick: () => void } & Record<
  `data-${string}`,
  boolean | string
>) {
  return (
    <button
      type="button"
      className="inline-flex h-[38px] w-full cursor-pointer items-center justify-center gap-[7px] rounded-lg bg-(--sv-violet-tint) text-[13px] font-extrabold text-(--sv-violet-ink) transition-colors hover:bg-(--sv-violet-soft)"
      {...props}
    >
      <PlusIcon weight="bold" size={14} />
      {children}
    </button>
  );
}

/**
 * A colour: the picker, and the hex beside it for pasting a brand colour.
 * The hex box keeps what is typed until it is a whole colour.
 */
function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const valid = hexColour(text) !== null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-extrabold">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          aria-label={label}
          className="h-11 w-12 flex-none cursor-pointer rounded-[11px] bg-(--sv-subtle) p-1"
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value);
          }}
        />
        <Input
          value={text}
          aria-label={`${label} as hex`}
          aria-invalid={!valid}
          className="num min-w-0 flex-1"
          maxLength={7}
          onChange={(event) => {
            setText(event.target.value);
            const hex = hexColour(event.target.value);
            if (hex) onChange(hex);
          }}
        />
      </div>
    </div>
  );
}
