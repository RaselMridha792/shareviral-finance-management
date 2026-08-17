"use client";

import { Search, X } from "lucide-react";
import { useId, useRef } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A search box with a way in and a way back out.
 *
 * Both halves were missing and the second one matters more. Typing filtered a
 * list and there was no control that said so — no button to press, and nothing
 * to press to undo it. Somebody who searched and then wanted the whole list
 * again had to select the text and delete it, which is a thing you have to
 * work out rather than see.
 *
 * The clear button appears only when there is something to clear, so the field
 * is quiet until it is doing something.
 */
export function SearchField({
  value,
  onChange,
  onSubmit,
  placeholder = "Search",
  label = "Search",
  className,
  inputClassName,
  submitLabel = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  /**
   * Runs on the button and on Enter. Omit it where the list filters as you
   * type — the button is then not drawn, because a button that repeats what
   * already happened teaches people their typing did not count.
   */
  onSubmit?: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  /** For a row of `h-9` controls, so the box lines up with its neighbours. */
  inputClassName?: string;
  submitLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Generated, not fixed: the topbar's search and a page's own search are on
  // screen together, and two elements sharing an id makes the label point at
  // whichever the browser happened to parse first.
  const id = useId();

  function clear() {
    onChange("");
    // Cleared *and* applied: leaving the old results under an empty box is
    // the confusing half of this, not the box itself.
    onSubmit?.("");
    inputRef.current?.focus();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(value);
      }}
      className={cn("flex max-w-lg flex-1 items-center gap-2", className)}
    >
      <div className="relative flex flex-1 items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <input
          // Deliberately not type="search": WebKit and Chrome draw their own
          // clear cross on those, which would sit next to ours.
          id={id}
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={cn(controlClass, "pl-9", value && "pr-10", inputClassName)}
        />
        {value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear the search"
            className="absolute right-2 rounded-md p-1 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {onSubmit ? (
        <Button type="submit" variant="secondary" size="md">
          {submitLabel}
        </Button>
      ) : null}
    </form>
  );
}
