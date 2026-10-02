"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { BrainIcon } from "@phosphor-icons/react/dist/ssr/Brain";
import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr/ListChecks";
import type {
  AiInstructions,
  AiKnowledge,
  AiKnowledgePart,
} from "@finance/shared";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AssistantMistakes } from "@/components/assistant/assistant-mistakes";
import { useCan } from "@/components/auth/session-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";
import { formatDate } from "@/lib/utils";

/** Whether a part, or any of its forms, mentions what was typed. */
function matches(part: AiKnowledgePart, query: string): boolean {
  if (!query) return true;
  const haystack = [
    part.name,
    part.purpose,
    ...part.keeps,
    ...part.screens.map((screen) => `${screen.name} ${screen.does}`),
    ...part.forms.map((form) => `${form.name} ${form.opens} ${form.onSave}`),
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * "What the Assistant knows" (2 Oct 2026, piece A2b).
 *
 * The owner asked for the Assistant to know the whole app — "kon page a ki
 * ache and kon forms ta kivabe kaj kore" — and to be able to see why it
 * answered as it did. This page is what it is told, from the same map the
 * prompt is written from: every part, its screens, its forms with the fields
 * their Save checks, and what it may do there. For a Super Admin, the
 * owner's rules and its recent mistakes sit above the map.
 *
 * Under /assistant, which is a full-window room rather than a padded column
 * (main-region.tsx), so this page brings its own scroll and padding.
 */
export function KnowledgeScreen({ knowledge }: { knowledge: AiKnowledge }) {
  const canConfigure = useCan("settings.write");
  const [query, setQuery] = useState("");
  const [rules, setRules] = useState<AiInstructions | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);

  useEffect(() => {
    if (!canConfigure) return;
    let alive = true;
    aiApi
      .instructions()
      .then((answer) => {
        if (alive) setRules(answer);
      })
      .catch((caught: unknown) => {
        if (alive) {
          setRulesError(
            caught instanceof ApiError
              ? caught.message
              : "Your rules could not be read.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [canConfigure]);

  const parts = useMemo(
    () => knowledge.parts.filter((part) => matches(part, query.trim())),
    [knowledge.parts, query],
  );
  const formCount = knowledge.parts.reduce(
    (total, part) => total + part.forms.length,
    0,
  );

  return (
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-[18px] p-[clamp(16px,2vw,24px)]">
        <PageHeader
          eyebrow="AI Assistant"
          title="What the Assistant knows"
          icon={BrainIcon}
          description="What it is told about this app with every message: each part, its screens and forms, and what it may do there. When it gets something wrong, look here first."
          actions={
            <Link
              href="/assistant"
              className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-[14px] font-extrabold text-(--sv-violet-ink) transition-colors hover:text-(--sv-ink)"
            >
              <ArrowLeftIcon weight="bold" size={16} />
              Back to the chat
            </Link>
          }
        />

        {canConfigure ? (
          <>
            <Card>
              <CardHeader
                title="Your rules"
                icon={ListChecksIcon}
                description="Your instructions for the Assistant, read with every message after the map below. They can say where a thing belongs; they cannot give anybody a permission."
                action={
                  <Link
                    href="/settings?tab=assistant"
                    className="text-[13.5px] font-extrabold text-(--sv-violet-ink) transition-colors hover:text-(--sv-ink)"
                  >
                    Change them
                  </Link>
                }
              />
              <CardBody>
                {rulesError ? (
                  <p role="alert" className="text-sm text-negative">
                    {rulesError}
                  </p>
                ) : rules === null ? (
                  <p className="text-sm text-muted-foreground">Reading…</p>
                ) : rules.instructions ? (
                  <>
                    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-relaxed">
                      {rules.instructions
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line, index) => (
                          <li key={index} className="wrap-break-word">
                            {line}
                          </li>
                        ))}
                    </ol>
                    {rules.setAt ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Last changed
                        {rules.setBy ? ` by ${rules.setBy}` : ""} on{" "}
                        {formatDate(rules.setAt.slice(0, 10))}.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No rules yet. Make one from a mistake below, or write them
                    under Settings, Assistant.
                  </p>
                )}
              </CardBody>
            </Card>

            <AssistantMistakes onRuled={setRules} />
          </>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
          <div>
            <h2 className="text-[18px] font-extrabold tracking-tight">
              The map of the app
            </h2>
            <p className="text-[13.5px] text-muted-foreground">
              {knowledge.parts.length} parts, {formCount} forms and buttons. The
              fields are read from what each form&apos;s Save accepts.
            </p>
          </div>
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Find a part or a form</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a part or a form"
              className="pl-9"
            />
          </label>
        </div>

        {parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on the map mentions that.
          </p>
        ) : null}

        <div className="grid gap-[18px] xl:grid-cols-2">
          {parts.map((part) => (
            <PartCard key={part.key} part={part} open={Boolean(query.trim())} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PartCard({ part, open }: { part: AiKnowledgePart; open: boolean }) {
  return (
    <Card className="min-w-0">
      <CardHeader
        title={part.name}
        description={part.purpose}
        action={
          part.drafts.length ? (
            <Badge tone="primary">Drafts here</Badge>
          ) : (
            <Badge tone="neutral">Points to the screen</Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-3 text-[13.5px] leading-relaxed">
        <Section title="Kept here">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {part.keeps.map((kept, index) => (
              <li key={index}>{kept}</li>
            ))}
          </ul>
        </Section>

        <Section title="Screens">
          {part.screens.length ? (
            <ul className="flex flex-col gap-1.5">
              {part.screens.map((screen) => (
                <li key={screen.href}>
                  {screen.href.includes("[") ? (
                    <strong>{screen.name}</strong>
                  ) : (
                    <Link
                      href={screen.href}
                      className="font-bold text-(--sv-violet-ink) hover:text-(--sv-ink)"
                    >
                      {screen.name}
                    </Link>
                  )}{" "}
                  — {screen.does}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No screen shows this today.</p>
          )}
        </Section>

        <Section title="What the Assistant may do">
          <p>
            {part.drafts.length
              ? `Draft for you to save: ${part.drafts.join(", ")}.`
              : "Draft nothing here."}
            {part.reads.length
              ? ` Look up, as far as your role may: ${part.reads.join(", ")}.`
              : ""}
          </p>
          <p className="text-muted-foreground">
            Anything else, it says: &ldquo;{part.otherwise}&rdquo;
          </p>
        </Section>

        {part.forms.length ? (
          <details
            open={open}
            className="group rounded-xl border border-border"
          >
            <summary className="cursor-pointer px-3.5 py-2.5 font-bold select-none">
              Forms and buttons ({part.forms.length})
            </summary>
            <div className="flex flex-col divide-y divide-border border-t border-border">
              {part.forms.map((form, index) => (
                <div key={index} className="flex flex-col gap-1.5 px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{form.name}</strong>
                    {form.draft ? (
                      <Badge tone="primary">It drafts this: {form.draft}</Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground">
                    {form.opens}
                    {form.on ? `, on ${form.on.name}` : ""}.
                  </p>
                  <p>
                    <span className="font-semibold">Save: </span>
                    {form.onSave}
                  </p>
                  {form.fields.length ? (
                    <ul className="flex flex-col gap-0.5 pt-1">
                      {form.fields.map((field) => (
                        <li key={field.name} className="wrap-break-word">
                          <code className="num text-[12.5px]">
                            {field.name}
                          </code>
                          {field.required === true ? (
                            <span className="text-negative"> needed</span>
                          ) : field.required === false ? (
                            <span className="text-muted-foreground">
                              {" "}
                              optional
                            </span>
                          ) : null}
                          {field.means ? (
                            <span className="text-muted-foreground">
                              {" "}
                              — {field.means}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11.5px] font-extrabold tracking-wider text-muted-foreground uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}
