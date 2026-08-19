"use client";

import { Check, ChevronDown, Plus, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  /** Optional heading this option sits under. */
  group?: string;
  /** A second line — an account number, a designation, a vendor's type. */
  hint?: string;
};

/**
 * A select you can type into.
 *
 * The native one is fine at five options and hostile at forty: the only way to
 * find a category is to scroll a list ordered by something other than what you
 * are looking for. Typing narrows it.
 *
 * **The form value is a hidden input, not this widget.** Every form in this app
 * reads its fields with `FormData`, so the value has to be in the DOM under a
 * name whatever the UI looks like. That also means `required` cannot be
 * enforced by the browser — a hidden input is skipped by constraint validation,
 * and making it visible-but-focusable to get the bubble back is a worse trade
 * than the server's own field error, which every one of these forms already
 * renders.
 */
export function SearchableSelect({
  name,
  value,
  onChange,
  options,
  placeholder = "Choose…",
  searchPlaceholder = "Type to search…",
  disabled,
  invalid,
  className,
  emptyLabel = "Nothing matches that.",
  onCreate,
  createLabel = "Add",
}: {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  emptyLabel?: string;
  /**
   * Offered at the bottom of the list, and again when nothing matches. Gets
   * whatever has been typed, so a name already half-entered is not retyped in
   * the dialog that opens next.
   */
  onCreate?: (query: string) => void;
  createLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        o.group?.toLowerCase().includes(needle) ||
        o.hint?.toLowerCase().includes(needle),
    );
  }, [options, query]);

  /**
   * Opening clears the last search and puts the highlight back at the top.
   *
   * Done here rather than in an effect on `open`. An effect would set state
   * during a render caused by state, which is a second render for something
   * the click already knew — and the two states would be briefly out of step
   * with each other on the way.
   */
  function openList() {
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  // Focus is a DOM action, not state, so it does belong in an effect.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Clicking away closes it. Pointerdown rather than click, so a click that
  // lands on another control does not first activate that control and then
  // find the popover still open on top of it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      // Enter inside the search box must not submit the form around it.
      event.preventDefault();
      const option = matches[active];
      if (option) choose(option);
      else if (onCreate) onCreate(query.trim());
      return;
    }
  }

  /** Options in order, with a heading rendered whenever the group changes. */
  const rows: ReactNode[] = [];
  let lastGroup: string | undefined;
  matches.forEach((option, i) => {
    if (option.group && option.group !== lastGroup) {
      rows.push(
        <li
          key={`g-${option.group}-${i}`}
          role="presentation"
          className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {option.group}
        </li>,
      );
    }
    lastGroup = option.group;

    const isActive = i === active;
    rows.push(
      <li key={option.value}>
        <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          onMouseEnter={() => setActive(i)}
          onClick={() => choose(option)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
            isActive ? "bg-surface-muted" : "",
          )}
        >
          <Check
            className={cn(
              "size-3.5 shrink-0",
              option.value === value ? "text-primary" : "opacity-0",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{option.label}</span>
            {option.hint ? (
              <span className="block truncate text-xs text-muted-foreground">
                {option.hint}
              </span>
            ) : null}
          </span>
        </button>
      </li>,
    );
  });

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {name ? <input type="hidden" name={name} value={value} /> : null}

      <button
        type="button"
        disabled={disabled}
        /**
         * A combobox, not a plain button. It holds a value, opens a listbox
         * and can be invalid — none of which a button role can express, and
         * `aria-invalid` on one is simply ignored, so a screen reader would
         * never learn the field was rejected.
         */
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        className={cn(
          controlClass,
          "flex items-center justify-between gap-2 text-left",
          !selected && "text-muted-foreground",
        )}
      >
        <span className="truncate">
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                // The highlight has to land on something that still exists.
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="h-9 w-full bg-transparent text-sm outline-none"
            />
          </div>

          <ul
            id={listId}
            role="listbox"
            className="max-h-64 overflow-y-auto py-1"
          >
            {rows.length ? (
              rows
            ) : (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                {emptyLabel}
              </li>
            )}
          </ul>

          {onCreate ? (
            <button
              type="button"
              onClick={() => {
                onCreate(query.trim());
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium text-primary transition hover:bg-surface-muted"
            >
              <Plus className="size-4" />
              {query.trim() ? `${createLabel} “${query.trim()}”` : createLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
