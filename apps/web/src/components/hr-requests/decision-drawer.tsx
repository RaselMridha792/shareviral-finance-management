"use client";

import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Textarea } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import {
  KIND_LABELS,
  hrRequestsApi,
  type Decision,
  type HrRequestDto,
} from "@/lib/hr-requests";

const WORDS: Record<Decision, { title: string; label: string }> = {
  approved: { title: "Approve", label: "Approve" },
  refused: { title: "Reject", label: "Reject" },
  held: { title: "Put on hold", label: "Hold" },
  received: { title: "Put back to waiting", label: "Put back" },
};

/**
 * One decision on one request — the same drawer from the row and from the
 * pop-up (#125: "one control, two placements").
 *
 * A rejection and a hold need the decider's own words: HR reads them, and a
 * refusal without a sentence is one HR can only send again. Approving says
 * what it will write before it writes it, because an applied approval is not
 * taken back.
 */
export function DecisionDrawer({
  request,
  decision,
  summary,
  onClose,
  onDone,
}: {
  request: HrRequestDto;
  decision: Decision;
  summary: string;
  onClose: () => void;
  onDone: (notice: string | null) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const words = WORDS[decision];
  const needsNote = decision === "refused" || decision === "held";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note =
      String(new FormData(event.currentTarget).get("note") ?? "").trim() ||
      null;
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await hrRequestsApi.decide(
        request.kind,
        request.id,
        decision,
        note,
      );
      onDone(result.notice);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("That did not go through. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  const consequence =
    decision === "approved"
      ? request.kind === "pay_change"
        ? "This writes the new salary into their pay record from that date, and every salary sheet built from then on uses it. It cannot be taken back: a correction is a new request from HR."
        : request.kind === "one_off"
          ? "This adds it to their bonus on that month's salary sheet — at once if the sheet is a draft with them on it, otherwise when it is built."
          : request.kind === "spend"
            ? "Approved, it can be paid: Pay writes the expense into the books."
            : "The budget is agreed. Each spend against it is still decided on its own."
      : decision === "refused"
        ? "Nothing moves, for good. HR sees your note."
        : decision === "held"
          ? "Nothing moves yet, and it stays in the waiting list — a salary sheet it affects cannot be built until it is decided. HR sees your note."
          : "It goes back to waiting, undecided.";

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${words.title} — ${KIND_LABELS[request.kind].toLowerCase()}`}
      description={summary}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="hrr-decision"
            variant={decision === "refused" ? "danger" : "primary"}
            disabled={pending}
            data-hrr-submit
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {words.label}
          </Button>
        </>
      }
    >
      <form
        id="hrr-decision"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <p className="text-[13.5px] text-(--sv-muted)">{consequence}</p>
        {decision !== "received" ? (
          <Field
            label={
              decision === "refused"
                ? "Why it is rejected"
                : decision === "held"
                  ? "What is needed before deciding"
                  : "Note"
            }
            required={needsNote}
            error={fieldErrors.note}
            hint="HR sees this"
          >
            <Textarea
              name="note"
              rows={3}
              maxLength={1000}
              required={needsNote}
              data-hrr-field="note"
            />
          </Field>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-(--sv-neg-tint) px-3 py-2 text-sm text-(--sv-neg)"
            data-hrr-error
          >
            {error}
          </p>
        ) : null}
      </form>
    </Drawer>
  );
}
