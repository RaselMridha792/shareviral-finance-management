"use client";

import { useState, type ReactNode } from "react";

import { DeleteDialog } from "@/components/ui/delete-dialog";
import { ApiError, trashApi } from "@/lib/api-client";

/**
 * Deleting a row from whatever table it is in.
 *
 * Every screen that can delete needs the same five things: somewhere to keep
 * which row was asked about, a pending flag, an error, the dialog itself, and
 * the call. Written per screen that is five states times eight screens, and
 * the eighth copy is the one that forgets to clear the error, or reloads the
 * list before the request has landed.
 *
 * So a screen declares what kind of row it holds and how to name one, gets
 * back a function to open the dialog and a dialog to render, and its own diff
 * is four lines:
 *
 *     const del = useRowDelete({
 *       kind: "transaction",
 *       subject: "transaction",
 *       describe: (row) => <>...</>,
 *       onDone: () => void load(),
 *     });
 *     // in the row:  <RowActions onDelete={() => del.ask(row)} … />
 *     // beside the table:  {del.dialog}
 *
 * `kind` is the key from the API's trash registry — the server decides from it
 * which permission is needed, whether the row may go at all, and what to say
 * when it may not. Nothing here has to know that a transaction deletes as a
 * transfer pair or that an account with entries against it refuses; the
 * message comes back and is shown.
 */
export function useRowDelete<T>({
  kind,
  subject,
  describe,
  consequences,
  onDone,
}: {
  /** The trash registry key: "transaction", "account", "user", … */
  kind: string;
  /** What the dialog calls it: "Delete this transaction?" */
  subject: string;
  /** Enough of the row to recognise it — a name, a date, an amount. */
  describe: (row: T) => ReactNode;
  /**
   * What deleting this particular kind changes, if it is worth saying.
   *
   * A function when the answer depends on the row rather than the kind — a
   * heading that takes six sub-categories with it has to name them, and a
   * heading with none must not claim to.
   */
  consequences?: ReactNode | ((row: T) => ReactNode);
  /** Reload the list. Called only after the delete has landed. */
  onDone: () => void;
}) {
  const [target, setTarget] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idOf = (row: T) => (row as { id: string }).id;

  const confirm = async (reason: string) => {
    if (!target) return;
    setPending(true);
    setError(null);
    try {
      await trashApi.remove(kind, idOf(target), reason);
      setTarget(null);
      onDone();
    } catch (caught) {
      /*
       * The server's own sentence, not a generic one.
       *
       * "This account still has entries against it" and "This run has been
       * paid" are the two answers somebody actually needs here, and they are
       * only knowable server-side. Replacing them with "Delete failed" would
       * throw away the whole reason the guards write a message.
       */
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That did not go through. Try again in a moment.",
      );
    } finally {
      setPending(false);
    }
  };

  return {
    /** Open the confirmation for this row. */
    ask: (row: T) => {
      setError(null);
      setTarget(row);
    },
    /** Render beside the table, never inside its empty-or-loading branch. */
    dialog: (
      <DeleteDialog
        open={target !== null}
        subject={subject}
        summary={target ? describe(target) : null}
        consequences={
          typeof consequences === "function"
            ? target
              ? consequences(target)
              : null
            : consequences
        }
        pending={pending}
        error={error}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => setTarget(null)}
      />
    ),
  };
}
