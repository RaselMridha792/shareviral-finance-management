"use client";

import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr/ListChecks";
import { AI_INSTRUCTIONS_MAX, type AiInstructions } from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";
import { formatDate } from "@/lib/utils";

/**
 * "Instructions for the Assistant": the owner's own rules, in their own
 * words (2 Oct 2026).
 *
 * The owner asked for the assistant to be trained. A model cannot be trained
 * by us; what it knows about this company is what the app puts in front of
 * it, and this box is the part of that the owner writes. One rule a line —
 * "Claude, ChatGPT, Gemini kena = Ai Tools and Subscriptions" — sent with
 * every message, after the app's own map of itself.
 *
 * A rule can say where something belongs or how it is filed. It cannot give
 * anybody a permission: the look-ups and the saves still run as the person
 * asking. That is said on the card, because the box would otherwise read as
 * a place to switch things on.
 *
 * `readOnly` is the CFO's (B2, the owner, 3 Oct 2026): the rules as a list,
 * and no box. The API refuses the CFO a save anyway.
 */
export function AssistantInstructions({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [stored, setStored] = useState<AiInstructions | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    aiApi
      .instructions()
      .then((answer) => {
        if (!alive) return;
        setStored(answer);
        setText(answer.instructions);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : "The instructions could not be read.",
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  // Counted as it will be stored: one line ending, nothing either side.
  const length = text.replace(/\r\n?/g, "\n").trim().length;
  const over = length > AI_INSTRUCTIONS_MAX;
  const changed =
    stored !== null &&
    text.replace(/\r\n?/g, "\n").trim() !== stored.instructions;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const answer = await aiApi.setInstructions(text);
      setStored(answer);
      setText(answer.instructions);
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? [
              caught.message,
              ...Object.values(caught.fieldErrors ?? {}).map(
                (messages) => messages[0],
              ),
            ].join(": ")
          : "Could not save the instructions.",
      );
    } finally {
      setPending(false);
    }
  }

  if (readOnly) {
    const rules = (stored?.instructions ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return (
      <Card>
        <CardHeader
          title="Instructions for the Assistant"
          icon={ListChecksIcon}
          description="The owner's rules, in the owner's words. It reads them with every message, after the app's own map of itself. A rule cannot give anybody a permission."
        />
        <CardBody className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          ) : stored === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Reading them…
            </p>
          ) : rules.length ? (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-relaxed">
              {rules.map((line, index) => (
                <li key={index} className="wrap-break-word">
                  {line}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No rules yet.</p>
          )}
          {stored?.setAt ? (
            <p className="text-xs text-muted-foreground">
              Last changed{stored.setBy ? ` by ${stored.setBy}` : ""} on{" "}
              {formatDate(stored.setAt.slice(0, 10))}. Only a Super Admin can
              change them.
            </p>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Instructions for the Assistant"
        icon={ListChecksIcon}
        description="Your own rules, in your own words. It reads them with every message, after the app's own map of itself."
      />
      <CardBody>
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field
            label="One rule a line"
            hint={
              <>
                Say where a thing belongs or how this company files it:
                &ldquo;Claude, ChatGPT, Gemini kena = Ai Tools and
                Subscriptions&rdquo;. A rule cannot give anybody a permission:
                every look-up and every save still runs as the person asking.
              </>
            }
          >
            <Textarea
              name="instructions"
              rows={8}
              value={text}
              disabled={stored === null}
              onChange={(event) => {
                setText(event.target.value);
                setSaved(false);
              }}
              spellCheck={false}
              aria-invalid={over || undefined}
            />
          </Field>

          <p
            className={
              over
                ? "num text-xs text-negative"
                : "num text-xs text-muted-foreground"
            }
          >
            {length.toLocaleString("en-US")} of{" "}
            {AI_INSTRUCTIONS_MAX.toLocaleString("en-US")} characters
            {over ? " — too long to save" : ""}
          </p>

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
            >
              {error}
            </p>
          ) : null}

          {saved ? (
            <p className="rounded-lg bg-positive/10 px-3 py-2 text-sm text-positive">
              Saved. The Assistant follows these from its next message.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={pending || over || !changed}
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              Save the instructions
            </Button>
            <span className="text-xs text-muted-foreground">
              {stored?.setAt
                ? `Last saved${stored.setBy ? ` by ${stored.setBy}` : ""} on ${formatDate(stored.setAt.slice(0, 10))}. Every change is in What changed.`
                : "Nobody has changed these yet. Every change is kept in What changed."}
            </span>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
