"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { Drawer } from "@/components/ui/drawer";

/**
 * A table row's whole record, in a popup.
 *
 * The owner: *"table item gula clickable hobe jegulay click korle popup open
 * hoye puro data dekhabe jegula hide thakbe"*. The tables keep the columns a
 * reader scans by and lose the long ones — the Description above all, which
 * made every row tall — and a click on the row shows everything, the
 * description and every field no column carries.
 *
 * The same shape as an account's own page: a muted label on the left, the
 * value at 800 on the right, a hairline between rows; long text (a
 * description, a note) on a line of its own under its label. A value that was
 * never recorded reads "N/A", as it does everywhere else in the app.
 */

export type DetailItem = {
  label: string;
  /** Null or empty reads as "N/A". */
  value: ReactNode;
  /** Long text — a description, a note — on its own line, full width. */
  block?: boolean;
};

export type DetailSection = {
  /** A small heading over the section: "Money", "Paperwork". */
  title?: string;
  items: DetailItem[];
};

const isEmpty = (value: ReactNode) =>
  value === null || value === undefined || value === "";

export function RowDetails({
  open,
  onClose,
  title,
  description,
  sections,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  sections: DetailSection[];
  footer?: ReactNode;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={footer}
    >
      <div className="flex flex-col gap-5">
        {sections.map((section, index) => (
          <section key={section.title ?? index}>
            {section.title ? (
              <p className="mb-0.5 text-[11px] font-extrabold tracking-[0.12em] text-(--sv-muted) uppercase">
                {section.title}
              </p>
            ) : null}
            <dl>
              {section.items.map((item) =>
                item.block ? (
                  <div key={item.label} className="sv-row-rule py-[11px]">
                    <dt className="text-[13px] text-(--sv-muted)">
                      {item.label}
                    </dt>
                    <dd
                      className={
                        isEmpty(item.value)
                          ? "mt-1 text-[14px] text-(--sv-muted)"
                          : "mt-1 text-[14.5px] leading-relaxed font-semibold whitespace-pre-line"
                      }
                    >
                      {isEmpty(item.value) ? "N/A" : item.value}
                    </dd>
                  </div>
                ) : (
                  <div
                    key={item.label}
                    className="sv-row-rule flex items-baseline gap-3 py-[11px] text-[14px]"
                  >
                    <dt className="flex-1 text-(--sv-muted)">{item.label}</dt>
                    <dd
                      className={
                        isEmpty(item.value)
                          ? "text-right text-(--sv-muted)"
                          : "text-right font-extrabold tabular-nums"
                      }
                    >
                      {isEmpty(item.value) ? "N/A" : item.value}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          </section>
        ))}
      </div>
    </Drawer>
  );
}

/**
 * What makes a table row open its details: a click anywhere on it, or Enter
 * or Space when it has the keyboard's focus.
 *
 * A click that was meant for something inside the row — a link, a row
 * button, the tick box, an input — is left to that thing and does not open
 * the popup; nor does a click that ends a text selection, so a figure can
 * still be selected and copied off a row.
 *
 * Spread onto the `<tr>`: `<tr {...rowOpener(() => setShowing(row), row.id)}>`.
 * The id rides on the row as `data-row-id`, so a row can be found by what it
 * IS rather than by text a column shows — the harnesses find rows that way,
 * now the description is no longer on them.
 */
export function rowOpener(open: () => void, id?: string) {
  const fromControl = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(
      target.closest(
        "a, button, input, select, textarea, label, [role='switch'], [data-row-ignore]",
      ),
    );

  return {
    tabIndex: 0,
    "aria-haspopup": "dialog" as const,
    "data-row-open": "",
    "data-row-id": id,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (fromControl(event.target)) return;
      if (window.getSelection()?.toString()) return;
      open();
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
  };
}
