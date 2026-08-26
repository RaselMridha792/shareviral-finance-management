"use client";

import { TriangleAlert } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { useDismissable } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

/**
 * The dialog that stands between a row and the trash.
 *
 * `ConfirmDialog` next door is the right control for a reversible act — void an
 * entry, archive a heading, deactivate a user. All of those can be undone by
 * doing the opposite, so one button is the correct amount of friction and more
 * would only teach people to click through it.
 *
 * Deleting is not that. The row leaves every screen and every total, and the
 * way back is through a trash somebody has to know exists. So this one asks
 * three times over, and each ask does a different job:
 *
 *   the summary       says *which* row, because the commonest way to delete
 *                     the wrong thing is to be sure you meant the one above it
 *   the checkbox      states the consequence in words and makes acknowledging
 *                     it a deliberate act rather than a scroll past
 *   typing "delete"   cannot be done by muscle memory, a stray Enter, or a
 *                     click landing where a dialog has just appeared
 *
 * Two gates rather than one because they fail differently: a tick can be
 * clicked without reading, and a word can be typed without meaning it, but
 * doing both to the wrong row takes an effort that reaches the part of somebody
 * that was about to make a mistake.
 */

const WORD = "delete";

export function DeleteDialog({
  open,
  subject,
  summary,
  consequences,
  askForReason = true,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** What kind of thing this is, lower case: "transaction", "team member". */
  subject: string;
  /** Which one. A name, a date and an amount — enough to recognise the row. */
  summary: ReactNode;
  /** What deleting it changes, beyond the row disappearing. */
  consequences?: ReactNode;
  askForReason?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const wordId = useId();
  const ackId = useId();

  useDismissable(open, onCancel);

  /*
   * Every opening starts from nothing.
   *
   * Without this the component keeps the tick and the typed word from last
   * time, so the second delete of a session opens already armed and goes
   * through on one click — precisely the accident the two gates exist to
   * prevent, reintroduced by the thing meant to prevent it.
   *
   * Done during the render that notices `open` changed, rather than in an
   * effect afterwards. An effect would let one frame paint with the previous
   * delete's word still in the box and the button still live, and a click that
   * lands in that frame goes through.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setAcknowledged(false);
    setTyped("");
    setReason("");
  }

  if (!open) return null;

  const wordMatches = typed.trim().toLowerCase() === WORD;
  const armed = acknowledged && wordMatches && !pending;

  const confirm = () => {
    if (!armed) return;
    onConfirm(reason.trim());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delete this ${subject}`}
      className="fixed inset-0 z-[92] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-negative/10 text-negative">
            <TriangleAlert className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Delete this {subject}?</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              It moves to the trash. Nothing on this screen — and no total
              anywhere in the app — will count it any more.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {/*
            Which row. Above the warning rather than below it, because somebody
            who opened this on the wrong line should find that out before they
            read anything else.
          */}
          <div className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm">
            {summary}
          </div>

          <div className="text-sm text-muted-foreground">
            {consequences ?? (
              <p>
                You can put it back from{" "}
                <span className="font-medium text-foreground">
                  Settings &rarr; Trashed
                </span>{" "}
                for as long as it sits there. Emptying the trash removes it for
                good, and that cannot be undone from inside this app.
              </p>
            )}
          </div>

          <label
            htmlFor={ackId}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition hover:bg-surface-muted"
          >
            <input
              id={ackId}
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--negative)]"
            />
            <span>
              I have read the row above and I mean to delete{" "}
              <span className="font-medium text-foreground">that one</span>.
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={wordId} className="text-sm font-medium">
              Type <span className="font-mono text-negative">{WORD}</span> to
              confirm
            </label>
            <input
              id={wordId}
              value={typed}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirm();
                }
              }}
              aria-invalid={typed.length > 0 && !wordMatches}
              className={cn(controlClass, "font-mono")}
            />
          </div>

          {askForReason ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">
                Why, for the record{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                value={reason}
                autoComplete="off"
                placeholder="Duplicate of the row above"
                onChange={(event) => setReason(event.target.value)}
                className={controlClass}
              />
              <span className="text-xs text-muted-foreground">
                Shown beside it in the trash, so whoever finds it there knows
                whether to restore it.
              </span>
            </div>
          ) : null}

          {error ? <p className="text-sm text-negative">{error}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-muted px-5 py-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            No, keep it
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!armed}
            onClick={confirm}
          >
            {pending ? "Deleting…" : `Yes, delete this ${subject}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
