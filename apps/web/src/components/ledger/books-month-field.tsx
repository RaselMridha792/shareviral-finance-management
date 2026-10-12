"use client";

import { booksMonthLabel } from "@finance/shared";
import { useEffect, useRef, useState } from "react";

import { Field, Select } from "@/components/ui/field";

/** How far back the picker offers. Older is still kept when a row has it. */
const MONTHS_BACK = 12;

/**
 * "Belongs to month": the month's books an entry counts in, when that is not
 * the month of its date — May's salaries paid on 12 June (the brief of
 * 13 Oct 2026).
 *
 * Starts empty, and empty is the month of the date, which the hint names.
 * Offers that month's predecessors only: a later month is refused by the API,
 * so a picker that offered one would be offering an error.
 *
 * It reads the date from its own form's `txnDate` box rather than taking it
 * as a prop: every form it sits in keeps the date uncontrolled, and following
 * the box keeps those forms as they are. Sent as `booksMonth`, the 1st of the
 * month, or nothing.
 */
export function BooksMonthField({
  defaultValue,
  error,
  name = "booksMonth",
  dateName = "txnDate",
  className,
}: {
  /** The row's own books month, on an edit. */
  defaultValue?: string | null;
  error?: string[];
  name?: string;
  dateName?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  const [date, setDate] = useState("");

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const read = () => {
      const box = form.elements.namedItem(dateName);
      setDate(box instanceof HTMLInputElement ? box.value : "");
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, [dateName]);

  const own = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `${date.slice(0, 7)}-01`
    : null;
  const months = own
    ? Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonth(own, -(i + 1)))
    : [];
  // A stored month the list no longer reaches stays choosable, so opening an
  // old entry and saving it cannot quietly move it.
  if (defaultValue && defaultValue !== own && !months.includes(defaultValue)) {
    months.unshift(defaultValue);
  }

  return (
    <Field
      label="Belongs to month"
      error={error}
      hint={
        own ? `${booksMonthLabel(own)}, from the date` : "The month of the date"
      }
      className={className}
    >
      <Select
        ref={ref}
        name={name}
        defaultValue={defaultValue ?? ""}
        aria-label="Belongs to month"
      >
        <option value="">From the date</option>
        {months.map((month) => (
          <option key={month} value={month}>
            {booksMonthLabel(month)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** The 1st of the month `by` months from `firstOfMonth`. */
function shiftMonth(firstOfMonth: string, by: number): string {
  const [year, month] = firstOfMonth.split("-").map(Number);
  const index = year * 12 + (month - 1) + by;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
