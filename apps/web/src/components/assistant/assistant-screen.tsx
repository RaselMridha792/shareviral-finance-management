"use client";

import {
  AI_TARGET_LABELS,
  formatMoney,
  type AiAvailability,
  type AiIntakeReply,
  type AiMessage,
} from "@finance/shared";
import { CircleAlert, LoaderCircle, Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";
import { cn } from "@/lib/utils";

/** Fields the person should not have to read as a database column name. */
const FIELD_LABELS: Record<string, string> = {
  txnDate: "Date",
  amount: "Amount",
  description: "What it was for",
  categoryId: "Category",
  categoryName: "Category",
  accountName: "Account",
  accountId: "Account",
  vendorName: "Paid to",
  billAmount: "Gross bill",
  withheldTaxAmount: "Tax withheld",
  fullName: "Name",
  employeeCode: "Employee code",
  joinedOn: "Joined on",
  challanNumber: "Challan number",
  challanDate: "Challan date",
  depositDate: "Deposited on",
  periodYear: "For year",
  periodMonth: "For month",
  name: "Name",
  etin: "e-TIN",
  bin: "BIN",
  type: "Type",
};

/**
 * The amount, read back — or the raw text if it cannot be parsed.
 *
 * The model writes what it heard, which may carry a separator or a stray
 * character. formatMoney is strict on purpose, so this is where that meets
 * reality: showing the raw string is a fine outcome, throwing inside a render
 * and blanking the screen is not.
 */
function safeMoney(raw: string): string {
  const cleaned = raw.replace(/[,s৳$]/g, "");
  if (!/^-?d+(.d{1,2})?$/.test(cleaned)) return raw;
  try {
    return formatMoney(cleaned);
  } catch {
    return raw;
  }
}

export function AssistantScreen({
  availability,
}: {
  availability: AiAvailability;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [reply, setReply] = useState<AiIntakeReply | null>(null);
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, reply]);

  if (!availability.configured) {
    return (
      <>
        <PageHeader
          title="Assistant"
          description="Describe an entry and it fills in the form."
        />
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Sparkles className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Not switched on</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {availability.reason}
            </p>
          </div>
        </Card>
      </>
    );
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;

    const next: AiMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setThinking(true);
    setError(null);
    setSaved(null);

    try {
      const result = await aiApi.turn({
        messages: next,
        target: reply?.target ?? undefined,
        draft: reply?.draft,
      });
      setReply(result);
      const said = result.nextQuestion ?? result.clarification ?? result.summary;
      if (said) {
        setMessages([...next, { role: "assistant", content: said }]);
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The assistant could not answer. The ordinary forms all still work.",
      );
    } finally {
      setThinking(false);
    }
  }

  async function confirm(edited: Record<string, unknown>) {
    if (!reply?.target) return;
    setSaving(true);
    setError(null);

    try {
      const created = await aiApi.save(reply.target, edited);
      setSaved(created.refNo ?? "Saved");
      setReply(null);
      setMessages([]);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save that. Try the ordinary form.",
      );
    } finally {
      setSaving(false);
    }
  }

  const ready = reply && reply.target && reply.missingFields.length === 0;

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Describe an entry in Bangla or English. It asks for whatever is missing, then fills in the form for you to check."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex min-h-[26rem] flex-col">
          <CardHeader
            title="What are you recording?"
            description={
              reply?.target ? AI_TARGET_LABELS[reply.target] : "Just say it"
            }
          />
          <CardBody className="flex flex-1 flex-col gap-3">
            <div className="flex-1 space-y-3 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="flex flex-col gap-2 py-6 text-sm text-muted-foreground">
                  <p>For example:</p>
                  <p className="rounded-lg bg-surface-muted px-3 py-2">
                    ami office rent add korte chai
                  </p>
                  <p className="rounded-lg bg-surface-muted px-3 py-2">
                    Paid 6,200 to Grameenphone for August internet
                  </p>
                </div>
              ) : (
                messages.map((message, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                      message.role === "user"
                        ? "ml-auto bg-primary text-white"
                        : "bg-surface-muted",
                    )}
                  >
                    {message.content}
                  </div>
                ))
              )}
              {thinking ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  Thinking…
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            <form onSubmit={send} className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type it however you would say it…"
                disabled={thinking}
                autoFocus
              />
              <Button
                type="submit"
                variant="primary"
                disabled={thinking || !input.trim()}
              >
                <Send className="size-4" />
              </Button>
            </form>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          {saved ? (
            <Card className="flex items-center gap-3 px-4 py-3">
              <Badge tone="positive">Saved</Badge>
              <span className="num text-sm">{saved}</span>
            </Card>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
            >
              {error}
            </p>
          ) : null}

          {reply && reply.target ? (
            <DraftForm
              key={JSON.stringify(reply.draft)}
              reply={reply}
              ready={Boolean(ready)}
              saving={saving}
              onConfirm={confirm}
            />
          ) : (
            <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
                <Sparkles className="size-5" />
              </span>
              <p className="text-sm font-semibold">Nothing drafted yet</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Whatever it understands appears here as an ordinary form. It is
                not saved until you press Save.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The draft, as an editable form.
 *
 * Every value is a real input, not a read-only summary: the person is the one
 * who signs off on the figure, and a value they cannot change is one they
 * cannot correct. Nothing is written until Save is pressed.
 */
function DraftForm({
  reply,
  ready,
  saving,
  onConfirm,
}: {
  reply: AiIntakeReply;
  ready: boolean;
  saving: boolean;
  onConfirm: (draft: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(reply.draft).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft: Record<string, unknown> = {};
    for (const [key, value] of data.entries()) {
      const text = String(value).trim();
      if (text) draft[key] = text;
    }
    onConfirm(draft);
  }

  return (
    <Card>
      <CardHeader
        title="The draft"
        description={
          ready
            ? "Check every line, then save."
            : `Still needed: ${reply.missingFields.join(", ")}`
        }
      />
      <CardBody>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing understood yet.
            </p>
          ) : (
            entries.map(([key, value]) => (
              <Field key={key} label={FIELD_LABELS[key] ?? key}>
                {String(value).length > 60 ? (
                  <Textarea name={key} defaultValue={String(value)} />
                ) : (
                  <Input
                    name={key}
                    defaultValue={String(value)}
                    className={
                      key.toLowerCase().includes("amount") ? "col-amount" : ""
                    }
                  />
                )}
              </Field>
            ))
          )}

          {reply.summary ? (
            <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
              {reply.summary}
            </p>
          ) : null}

          {typeof reply.draft.amount === "string" ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Read the amount back before saving:{" "}
                <strong>{safeMoney(String(reply.draft.amount))}</strong>. A
                misheard figure looks exactly like a correct one.
              </span>
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={!ready || saving}
              title={ready ? undefined : "Something is still missing"}
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Save it
            </Button>
            {!ready ? (
              <span className="text-xs text-muted-foreground">
                Answer the question on the left first
              </span>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
