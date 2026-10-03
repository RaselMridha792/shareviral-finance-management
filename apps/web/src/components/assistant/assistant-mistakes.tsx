"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import {
  AI_MODEL_SHORT,
  AI_RULE_MAX,
  type AiInstructions,
  type AiMistake,
  type AiModel,
} from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { labelFor } from "@/components/assistant/draft-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";
import { formatDate } from "@/lib/utils";

function explain(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiError)) return fallback;
  return [
    caught.message,
    ...Object.values(caught.fieldErrors ?? {}).map((messages) => messages[0]),
  ].join(": ");
}

/** A model's short name where the app offers it, else the id it was. */
function modelName(model: string | null): string | null {
  if (!model) return null;
  return AI_MODEL_SHORT[model as AiModel] ?? model;
}

/**
 * The Assistant's recent mistakes, and the owner's say over each
 * (2 Oct 2026, piece A2b).
 *
 * Two kinds: a field somebody changed on a draft before saving it, and an
 * answer somebody marked "This was wrong", with why. Every one is shown to
 * the Assistant on later turns, to the people whose role may read that part
 * of the books. Beside each:
 *
 *   - Make this a rule: one line, which the owner can change first, added to
 *     their instructions. The mistake then leaves the prompt; its rule is in
 *     it, in the owner's words.
 *   - Remove: for a lesson that was itself wrong.
 *
 * This list is the "training" the owner asked for, in a form they can read
 * and control. Read by the CFO too (#150), each only about a part their
 * role may read; `readOnly` is their view (B2), with neither button — the
 * API refuses the CFO both anyway.
 */
export function AssistantMistakes({
  onRuled,
  readOnly = false,
}: {
  /** Told the instructions as they now stand, after a rule was added. */
  onRuled?: (instructions: AiInstructions) => void;
  readOnly?: boolean;
}) {
  const [mistakes, setMistakes] = useState<AiMistake[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMistakes(await aiApi.mistakes());
      setError(null);
    } catch (caught) {
      setError(explain(caught, "The mistakes could not be read."));
    }
  }, []);

  useEffect(() => {
    // Fetching on mount, which is exactly the external-system sync effects are
    // for; the rule cannot tell that from a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * Every mistake as a case for the quality bar (`.assistantbar.mjs`, its
   * section M), so that a later change to the prompt or the model cannot
   * bring one back unnoticed. The mistakes are made on the live site and the
   * bar runs from a checkout, so the file is the bridge: a session adds it
   * to `.assistantbar.mistakes.json` and writes what each must now do.
   */
  function download() {
    const cases = (mistakes ?? []).map((mistake) => ({
      id: mistake.id,
      at: mistake.at,
      model: mistake.model,
      kind: mistake.kind,
      area: mistake.area,
      target: mistake.target,
      field: mistake.field,
      said: mistake.said,
      wrong: mistake.drafted,
      right: mistake.corrected,
      expect: {},
    }));
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(cases, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `assistant-mistakes-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader
        title="Its recent mistakes"
        icon={WarningCircleIcon}
        description={
          readOnly
            ? "Drafts somebody corrected before saving, and answers marked This was wrong. The Assistant is shown these on later turns. A Super Admin can make one a rule, or remove one that was not a mistake."
            : "Drafts somebody corrected before saving, and answers marked This was wrong. The Assistant is shown these on later turns. Make one a rule to keep it in your instructions, or remove one that was not a mistake."
        }
        action={
          mistakes?.length ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={download}
            >
              Download as test cases
            </Button>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-3">
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}

        {mistakes === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Reading them…
          </p>
        ) : null}

        {mistakes?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. Under any answer in the chat, This was wrong puts it here,
            with why.
          </p>
        ) : null}

        {mistakes?.map((mistake) => (
          <MistakeRow
            key={mistake.id}
            mistake={mistake}
            readOnly={readOnly}
            onRuled={(instructions) => {
              onRuled?.(instructions);
              void load();
            }}
            onRemoved={() =>
              setMistakes((current) =>
                (current ?? []).filter((one) => one.id !== mistake.id),
              )
            }
          />
        ))}
      </CardBody>
    </Card>
  );
}

function MistakeRow({
  mistake,
  readOnly,
  onRuled,
  onRemoved,
}: {
  mistake: AiMistake;
  readOnly: boolean;
  onRuled: (instructions: AiInstructions) => void;
  onRemoved: () => void;
}) {
  const [ruling, setRuling] = useState(false);
  const [rule, setRule] = useState(mistake.rule);
  const [pending, setPending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function makeRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      onRuled(await aiApi.makeRule(mistake.id, rule));
      setRuling(false);
    } catch (caught) {
      setError(explain(caught, "The rule could not be added."));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await aiApi.forgetMistake(mistake.id);
      onRemoved();
    } catch (caught) {
      setError(explain(caught, "It could not be removed."));
      setPending(false);
    }
  }

  const what =
    mistake.kind === "field"
      ? `${labelFor(mistake.field ?? "", mistake.target)} changed before Save`
      : "Answer marked wrong";
  const model = modelName(mistake.model);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
        <Badge tone={mistake.kind === "field" ? "neutral" : "warning"}>
          {what}
        </Badge>
        {mistake.areaName ? <span>{mistake.areaName}</span> : null}
        {model ? <span>· {model}</span> : null}
        <span>
          · {mistake.by ? `${mistake.by}, ` : ""}
          {formatDate(mistake.at.slice(0, 10))}
        </span>
        {mistake.ruledAt ? (
          <Badge tone="positive">
            A rule since {formatDate(mistake.ruledAt.slice(0, 10))}
          </Badge>
        ) : null}
      </div>

      <dl className="grid gap-x-3 gap-y-1 text-[13.5px] sm:grid-cols-[110px_1fr]">
        <dt className="text-muted-foreground">Asked</dt>
        <dd className="min-w-0 wrap-break-word">{mistake.said}</dd>
        <dt className="text-muted-foreground">It gave</dt>
        <dd className="min-w-0 wrap-break-word">
          {mistake.drafted ?? "nothing (left empty)"}
        </dd>
        <dt className="text-muted-foreground">Right</dt>
        <dd className="min-w-0 font-semibold wrap-break-word">
          {mistake.corrected ?? "empty"}
        </dd>
      </dl>

      {readOnly ? null : ruling ? (
        <form onSubmit={makeRule} className="flex flex-col gap-2">
          <label
            htmlFor={`rule-${mistake.id}`}
            className="text-[13px] font-semibold"
          >
            The rule, in your words — one line, added to your instructions
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`rule-${mistake.id}`}
              autoFocus
              value={rule}
              maxLength={AI_RULE_MAX}
              onChange={(event) => setRule(event.target.value)}
              className="min-w-0 flex-1 basis-72"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={pending || rule.trim().length < 3}
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              Add the rule
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRuling(false);
                setRule(mistake.rule);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : confirmRemove ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span>
            Remove it? The Assistant stops being shown it.
            {mistake.ruledAt ? " Its rule stays in your instructions." : ""}
          </span>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => void remove()}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Remove
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRemove(false)}
          >
            Keep it
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {mistake.ruledAt ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setRuling(true)}
            >
              Make this a rule
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRemove(true)}
          >
            Remove
          </Button>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-[13px] text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
