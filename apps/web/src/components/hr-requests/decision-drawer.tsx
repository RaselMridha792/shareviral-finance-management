"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Textarea } from "@/components/ui/field";
import { payChangeCase } from "@/components/hr-requests/pay-change-case";
import { useMoney } from "@/components/settings-provider";
import { ApiError } from "@/lib/api-client";
import {
  KIND_LABELS,
  hrRequestsApi,
  type Decision,
  type HrRequestDetailDto,
  type HrRequestDto,
  type RequestState,
} from "@/lib/hr-requests";
import { formatDate } from "@/lib/utils";

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
 * taken back — and for a pay change that depends on what is already on
 * file, so it is read first, fresh, whichever button opened the drawer. That
 * read is also what catches a request HR sent again, or somebody decided,
 * after the list was drawn: the drawer then says so and will not approve
 * what it has not shown.
 */
export function DecisionDrawer({
  request,
  decision,
  summary,
  onClose,
  onStale,
  onDone,
}: {
  request: HrRequestDto;
  decision: Decision;
  summary: string;
  onClose: () => void;
  /** On closing, when the fresh read found the request changed. */
  onStale?: () => void;
  onDone: (notice: string | null) => void;
}) {
  const money = useMoney();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const words = WORDS[decision];
  const needsNote = decision === "refused" || decision === "held";
  const readsFigures = decision === "approved" && request.kind === "pay_change";
  /* null while it is read; `detail: null` when it could not be. */
  const [figures, setFigures] = useState<{
    detail: HrRequestDetailDto | null;
  } | null>(null);

  useEffect(() => {
    if (!readsFigures) return;
    let live = true;
    hrRequestsApi
      .get(request.kind, request.id)
      .then((detail) => {
        if (live) setFigures({ detail });
      })
      .catch(() => {
        if (live) setFigures({ detail: null });
      });
    return () => {
      live = false;
    };
  }, [readsFigures, request.kind, request.id]);
  /* Approve waits for the read, and stays off when it failed: what it
     would write is exactly what could not be read. */
  const reading = readsFigures && !figures?.detail;
  const fresh = figures?.detail ?? null;
  const stale = fresh !== null && changedSince(request, fresh);
  const close = () => {
    if (stale) onStale?.();
    onClose();
  };

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
        ? stale && fresh
          ? staleSentence(request, fresh, money)
          : payChangeConsequence(figures)
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
      onClose={close}
      title={`${words.title} — ${KIND_LABELS[request.kind].toLowerCase()}`}
      description={summary}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="hrr-decision"
            variant={decision === "refused" ? "danger" : "primary"}
            disabled={pending || reading || stale}
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
        <p className="text-[13.5px] text-(--sv-muted)" data-hrr-consequence>
          {consequence}
        </p>
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

/**
 * What approving a pay change writes, said per case (`payChangeCase`) — the
 * same ones the pop-up's note tells apart. Until the figures are read it says
 * so; if they cannot be read, it says that instead, and Approve stays off.
 */
function payChangeConsequence(
  figures: { detail: HrRequestDetailDto | null } | null,
): string {
  const final =
    "It cannot be taken back: a correction is a new request from HR.";
  if (figures === null) return "Reading what is on file for that date…";
  const detail = figures.detail;
  if (detail === null) {
    return "What is on file for that date could not be read, so this cannot be approved yet. Close this and press Approve again.";
  }
  const approving = payChangeCase(detail);
  switch (approving.kind) {
    case "same-date":
      return `The salary on file for ${formatDate(detail.effectiveOn)} is already this figure, so this records the decision and leaves the salary record as it is. ${final}`;
    case "same-figure":
      return `The same figure is already on file from ${formatDate(approving.from)}, so pay does not change: this adds a salary record of its own from ${formatDate(detail.effectiveOn)} at that figure. ${final}`;
    case "no-month":
      return `Pay does not change: the later change on file from ${formatDate(approving.next)} starts in the same month, and a salary sheet takes the figure in force at the month's end, so this figure reaches no sheet. This keeps it on the salary record from ${formatDate(detail.effectiveOn)}. ${final}`;
    case "until-next":
      return `This writes the new salary into their pay record from ${formatDate(detail.effectiveOn)} until the later change on file from ${formatDate(approving.next)}, which still applies, as does any after it. Months already paid do not change. ${final}`;
    default:
      return `This writes the new salary into their pay record from that date, and every salary sheet built from then on uses it. ${final}`;
  }
}

const STATE_WORDS: Record<RequestState, string> = {
  pending: "waiting",
  held: "on hold",
  approved: "approved",
  rejected: "rejected",
  withdrawn: "withdrawn by HR",
};

/**
 * Whether the request read now is not the one the drawer was opened on: a
 * decision by somebody else, or anything HR sent again — a re-send always
 * moves the send count, even one that only changes whose pay it is.
 */
function changedSince(shown: HrRequestDto, now: HrRequestDto): boolean {
  return (
    now.state !== shown.state ||
    now.sendCount !== shown.sendCount ||
    now.teamMemberId !== shown.teamMemberId ||
    Number(now.amount) !== Number(shown.amount) ||
    now.effectiveOn !== shown.effectiveOn
  );
}

/** Who changed it: only HR's re-send moves the send count and puts it back
    to waiting; a hold or a put-back by another decider leaves both. */
function staleSentence(
  shown: HrRequestDto,
  now: HrRequestDto,
  money: (value: string | number) => string,
): string {
  if (now.sendCount !== shown.sendCount && now.state === "pending") {
    const whose =
      now.teamMemberId !== shown.teamMemberId ? ` for ${now.subject},` : "";
    return `This request has changed since it was shown: HR sent it again${whose} as ${money(now.amount)} from ${formatDate(now.effectiveOn)}. Close this and open it again before deciding.`;
  }
  const by =
    now.decidedByName &&
    (now.state === "held" ||
      now.state === "approved" ||
      now.state === "rejected")
      ? `, by ${now.decidedByName}`
      : "";
  return `This request has changed since it was shown: it is now ${STATE_WORDS[now.state]}${by}. Close this to see where it stands.`;
}
