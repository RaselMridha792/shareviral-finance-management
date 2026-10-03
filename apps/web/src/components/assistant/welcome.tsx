"use client";

import type { AiDataAccess } from "@finance/shared";
import { PenLine, Search, Signpost, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What the assistant is for, said once, before anybody has typed anything.
 *
 * An empty chat box tells a person nothing about what it will accept. These
 * three lines are the whole feature: it writes records, it finds records, and
 * it knows which part of the app a thing belongs in. The examples are real
 * sentences that work, in the mixture of Bangla and English people here
 * actually write.
 */

const CAPABILITIES = [
  {
    icon: PenLine,
    title: "Write it down",
    body: "Money out or in, a transfer between our accounts, a new vendor, somebody joining, a TDS challan. It fills in the form; you check it and save.",
  },
  {
    icon: Search,
    title: "Find it again",
    body: "What we paid a vendor this year, what is in an account, whether last month's tax is deposited.",
    needsLookups: true,
  },
  {
    icon: Signpost,
    title: "Say where it belongs",
    body: "Salary is not a transaction, withheld tax is not a receipt. It routes the record to the right place rather than asking you.",
  },
];

const HOURS_TO_GREETING = (hour: number) =>
  hour < 5
    ? "Still up"
    : hour < 12
      ? "Good morning"
      : hour < 17
        ? "Good afternoon"
        : "Good evening";

export function Welcome({
  fullName,
  dataAccess,
  onPick,
  compact = false,
}: {
  fullName: string;
  dataAccess: AiDataAccess;
  onPick: (text: string) => void;
  /**
   * The floating window's (B4): the greeting and the examples, without the
   * three cards, which would fill the window before a word was typed. The
   * Assistant page still has them.
   */
  compact?: boolean;
}) {
  const lookups = dataAccess === "full";

  // Two words, not one: "Md. Rasel" reads as a name where "Md." does not, and
  // an account called "Super Admin" should not be greeted as "Super".
  const name = fullName.split(/\s+/).slice(0, 2).join(" ") || fullName;

  const cards = CAPABILITIES.filter((c) => !c.needsLookups || lookups);

  // Rendered in the browser, so this is the reader's own clock — which is the
  // one that matters for a greeting, unlike a figure, where Dhaka is the only
  // correct answer.
  const greeting = HOURS_TO_GREETING(new Date().getHours());

  const examples = [
    "ami office rent add korte chai",
    "Paid 6,200 to Grameenphone for August internet",
    ...(lookups
      ? ["ei bochor rent e koto kharcha holo?", "Is July's TDS deposited?"]
      : ["Notun ekjon join korche, Tanvir, 1 September theke"]),
  ];

  return (
    // m-auto rather than justify-center: when the content is taller than the
    // window — a phone — a centred flex child cannot be scrolled back up to,
    // and the greeting becomes unreachable.
    <div className="flex min-h-full w-full flex-col">
      <div
        className={cn(
          "m-auto w-full max-w-3xl",
          compact ? "px-4 py-6" : "px-4 py-12",
        )}
      >
        <div className="flex flex-col items-center text-center">
          <span
            className={cn(
              "flex items-center justify-center bg-primary/12 text-primary",
              compact ? "size-10 rounded-xl" : "size-12 rounded-2xl",
            )}
          >
            <Sparkles className={compact ? "size-5" : "size-6"} />
          </span>

          <h1
            className={cn(
              "font-semibold tracking-tight text-balance",
              compact ? "mt-4 text-2xl" : "mt-5 text-3xl sm:text-4xl",
            )}
          >
            {greeting}, {name}
          </h1>

          <p
            className={cn(
              "mt-3 max-w-lg leading-relaxed text-balance text-muted-foreground",
              compact ? "text-[14px]" : "text-[15px]",
            )}
          >
            Describe what happened and it fills in the form.{" "}
            {lookups
              ? "Ask what is in the books and it looks it up."
              : "Lookups are switched off, so it drafts but does not answer questions about existing records."}{" "}
            Bangla, English, or both in one sentence.
          </p>
        </div>

        {compact ? null : (
          <div
            className={cn(
              "mt-9 grid gap-3",
              // Follows the number of cards, so hiding the lookup one leaves a
              // balanced pair rather than a hole in a three-column row.
              cards.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
            )}
          >
            {cards.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4"
              >
                <Icon className="size-4 text-primary" />
                <p className="text-sm font-semibold tracking-tight">{title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className={cn("flex flex-col gap-2", compact ? "mt-6" : "mt-8")}>
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Try one
          </p>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onPick(example)}
                className="cursor-pointer rounded-full border border-border bg-surface px-3.5 py-1.5 text-left text-xs text-muted-foreground transition hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        <p
          className={cn(
            "text-center text-xs leading-relaxed text-muted-foreground",
            compact ? "mt-6" : "mt-9",
          )}
        >
          It drafts; you save. It has no way to write to the books on its own,
          and no route to anybody&apos;s pay.
        </p>
      </div>
    </div>
  );
}
