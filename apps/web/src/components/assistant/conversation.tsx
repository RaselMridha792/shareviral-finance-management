"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import {
  AI_MODELS,
  type AiAttachment,
  type AiAvailability,
  type AiDataAccess,
} from "@finance/shared";
import { LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import {
  AttachmentCard,
  emptyPartsOf,
} from "@/components/assistant/attachment-card";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { BatchCard } from "@/components/assistant/batch-card";
import { Composer } from "@/components/assistant/composer";
import { DraftCard } from "@/components/assistant/draft-card";
import { MarkWrong } from "@/components/assistant/mark-wrong";
import { Welcome } from "@/components/assistant/welcome";
import { useSession } from "@/components/auth/session-provider";
import { cn } from "@/lib/utils";

/**
 * The Sheet several tabs were read from (A3b), or the workbook several
 * sheets were (A3c), from the names they share: "Expenses 2026 — Jan (tab 1
 * of 3)" and "Expenses 2026 — Feb (tab 2 of 3)" are of "Expenses 2026".
 */
function sheetOf(attachments: AiAttachment[]): string | null {
  let shared = attachments[0]?.name ?? "";
  for (const { name } of attachments.slice(1)) {
    let at = 0;
    while (at < shared.length && shared[at] === name[at]) at += 1;
    shared = shared.slice(0, at);
  }
  const cut = shared.lastIndexOf(" — ");
  return cut > 0 ? shared.slice(0, cut) : null;
}

/**
 * What several files are, from how each is named: a Google Sheet's tabs, or
 * an Excel workbook's sheets, "Book.xlsx — Feb (sheet 2 of 3)" (A3c).
 */
function partsOf(attachments: AiAttachment[]): "tabs" | "sheets" {
  return /\(sheet \d+ of \d+(?:, hidden)?\)$/.test(attachments[0]?.name ?? "")
    ? "sheets"
    : "tabs";
}

/**
 * What the message box says is attached: the file, or its tabs or sheets.
 * A file read as its one sheet of data (A3d) by that sheet's name alone.
 */
function attachedLabel(attachments: AiAttachment[]): string | null {
  if (attachments.length < 2) {
    return attachments[0] ? emptyPartsOf(attachments[0].name).name : null;
  }
  const parts = partsOf(attachments);
  const whole = parts === "sheets" ? "A workbook" : "A Google Sheet";
  return `${sheetOf(attachments) ?? whole} · ${attachments.length} ${parts}`;
}

/**
 * The conversation and the box under it — the part the Assistant page and
 * the floating window (B4) share.
 *
 * Everything said, attached and drafted lives in the provider above the
 * pages, so this can be unmounted from one view and mounted in the other
 * without losing any of it. `compact` is the window's narrower dress: the
 * same transcript and cards, tighter, and a greeting that does not fill the
 * window before a word is typed.
 */
export function Conversation({
  availability,
  compact = false,
}: {
  availability: AiAvailability;
  compact?: boolean;
}) {
  const user = useSession();
  const assistant = useAssistant();
  const {
    messages,
    reply,
    attachments,
    thinking,
    reading,
    chatId,
    savedOn,
    error,
    loadChats,
    watch,
  } = assistant;

  const configured = availability.configured;
  /**
   * Which model answers (B2): the one picked for this conversation, while it
   * can still be reached, else the default in the Assistant's settings. The
   * picker lists every model with a working route right now, for anybody who
   * may use the Assistant, and a pick holds for this conversation only —
   * nobody's default changes. A conversation picked for a model that can no
   * longer be reached shows, and is sent, the default, and keeps its own
   * for when the model is back.
   */
  const fallback = availability.model ?? AI_MODELS[0];
  const models = availability.models?.length ? availability.models : [fallback];
  const picked =
    assistant.chatModel && models.includes(assistant.chatModel)
      ? assistant.chatModel
      : null;
  const model = picked ?? fallback;
  const dataAccess: AiDataAccess =
    availability.dataAccess && availability.dataAccess !== "off"
      ? availability.dataAccess
      : "full";

  const scroller = useRef<HTMLDivElement>(null);

  // Whichever view is open is the one reading the answers, so the launcher
  // has nothing to mark.
  useEffect(() => watch(), [watch]);
  // The month's spending, for the warning above the message box (B3).
  const { loadUsage } = assistant;
  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    if (configured) void loadChats();
  }, [configured, loadChats]);

  // Follow the conversation down as it grows. `scrollTop` on the container
  // rather than scrollIntoView, which drags the whole page on some browsers.
  // Only once something has been said — otherwise the welcome opens scrolled
  // past its own greeting on a short screen.
  useEffect(() => {
    const el = scroller.current;
    if (el && messages.length) el.scrollTop = el.scrollHeight;
  }, [messages, reply, thinking, reading]);

  /**
   * The Sheet, when the files are its tabs, or the workbook, when they are
   * its sheets: named once, above their cards.
   */
  const sheet = attachments.length > 1 ? sheetOf(attachments) : null;
  /**
   * The empty sheets or tabs beside the one a file was read as (A3d), named
   * under its card so nobody wonders where the rest of it went.
   */
  const emptyParts =
    attachments.length === 1 ? emptyPartsOf(attachments[0].name).empty : null;

  // A draft has its own card; a link beside it would be a second thing to
  // press before the first has been read.
  const place = reply
    ? reply.target || reply.batch || reply.importPlan
      ? null
      : (reply.screen ?? null)
    : savedOn;

  return (
    <>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overscroll-contain overflow-y-auto"
      >
        {messages.length === 0 && !reply && !attachments.length ? (
          <Welcome
            fullName={user.fullName}
            dataAccess={dataAccess}
            onPick={assistant.setInput}
            compact={compact}
          />
        ) : (
          <div
            className={cn(
              "mx-auto flex w-full max-w-3xl flex-col",
              compact ? "gap-4 px-3 py-4" : "gap-6 px-4 py-8",
            )}
          >
            {/* A Sheet read whole (A3b), or a workbook (A3c): a card a tab
                or a sheet, each with its own rows, columns and totals,
                never one card for the lot. */}
            {attachments.length ? (
              <div className="flex flex-col gap-3">
                {sheet ? (
                  <p className="text-xs text-muted-foreground">
                    {sheet} · <span className="num">{attachments.length}</span>{" "}
                    {partsOf(attachments)}, each read and counted on its own
                  </p>
                ) : null}
                {attachments.map((attachment) => (
                  <AttachmentCard
                    key={attachment.id}
                    label={
                      sheet
                        ? attachment.name.slice(sheet.length + 3)
                        : undefined
                    }
                    plan={
                      attachments.length === 1
                        ? (reply?.importPlan ?? null)
                        : null
                    }
                    attachment={attachment}
                    staging={assistant.staging === attachment.id}
                    onSendToImport={() =>
                      void assistant.sendToImport(attachment)
                    }
                    onRemove={() => void assistant.detach(attachment.id)}
                  />
                ))}
                {emptyParts ? (
                  <p className="-mt-1.5 px-1 text-xs text-muted-foreground wrap-anywhere">
                    {emptyParts}: empty
                  </p>
                ) : null}
              </div>
            ) : null}

            {messages.map((message, index) =>
              message.role === "user" ? (
                <p
                  key={index}
                  className={cn(
                    "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 leading-relaxed whitespace-pre-wrap text-primary-foreground wrap-anywhere",
                    compact ? "text-[14px]" : "text-[15px]",
                  )}
                >
                  {message.content}
                </p>
              ) : (
                <div key={index} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Sparkles className="size-3.5" />
                  </span>
                  <p
                    className={cn(
                      "min-w-0 pt-0.5 leading-relaxed whitespace-pre-wrap wrap-anywhere",
                      compact ? "text-[14px]" : "text-[15px]",
                    )}
                  >
                    {message.content}
                  </p>
                </div>
              ),
            )}

            {thinking || reading ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <LoaderCircle className="size-3.5 animate-spin" />
                </span>
                {reading ? "Reading the linked file…" : "Thinking…"}
              </div>
            ) : null}

            {/* The way to the screen: where the thing asked about is done
                when the assistant can only point to it, and where a record
                just saved now shows. */}
            {place && !thinking && !reading ? (
              <Link
                href={place.href}
                className="ml-10 inline-flex w-fit items-center gap-1.5 text-[13.5px] font-extrabold text-(--sv-violet-ink) transition-colors hover:text-(--sv-ink)"
              >
                Open {place.name}
                <ArrowRightIcon weight="bold" size={15} />
              </Link>
            ) : null}

            {/* Under the latest answer only: the one the conversation
                holds whole on the server. Keyed on it, so a new answer
                gets a fresh box. */}
            {chatId && reply && !thinking && !reading ? (
              <MarkWrong key={messages.length} chatId={chatId} />
            ) : null}

            {/* A batch and a single draft are never both on offer: the
                batch answers "add all of these", the draft answers "add
                this one", and showing two Save buttons at once is asking
                somebody to pick between things they have not read yet. */}
            {reply?.batch ? (
              <BatchCard
                batch={reply.batch}
                results={assistant.batchResults}
                saving={assistant.saving}
                savingRow={assistant.savingRow}
                savedCount={assistant.savedCount}
                dropped={assistant.dropped}
                onDrop={assistant.toggleDrop}
                onConfirmRow={(index) => void assistant.confirmRow(index)}
                onConfirmAll={() => void assistant.confirmBatch()}
              />
            ) : reply?.target ? (
              <DraftCard
                key={JSON.stringify(reply.draft)}
                reply={reply}
                saving={assistant.saving}
                edits={assistant.edits}
                onEdit={assistant.edit}
                onConfirm={(edited) => void assistant.confirm(edited)}
                leaveEmpty={assistant.leaveEmpty}
                onSkip={assistant.setSkip}
                invoice={
                  assistant.invoiceFile
                    ? { name: assistant.invoiceFile.file.name }
                    : null
                }
                invoiceLost={
                  !assistant.invoiceFile &&
                  attachments.some((file) => file.kind === "invoice")
                }
                attachingInvoice={assistant.attachingInvoice}
                onAttachInvoice={(file) => void assistant.attachInvoice(file)}
              />
            ) : null}
          </div>
        )}
      </div>

      {/* What it spends (B3): at 80% of the month's limit a warning, at
          100% the sentence that says it has stopped and who can raise it. */}
      {assistant.usage?.message && !error ? (
        <div className={cn("shrink-0 pt-2", compact ? "px-3" : "px-4")}>
          <p
            role="status"
            data-usage-notice={assistant.usage.state}
            className={cn(
              "mx-auto max-w-3xl rounded-lg px-3 py-2 text-sm",
              assistant.usage.state === "stopped"
                ? "bg-negative/10 text-negative"
                : "bg-warning/10 text-foreground",
            )}
          >
            {assistant.usage.message}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className={cn("shrink-0 pt-2", compact ? "px-3" : "px-4")}>
          <p
            role="alert"
            className="mx-auto max-w-3xl rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        </div>
      ) : null}

      <Composer
        value={assistant.input}
        onChange={assistant.setInput}
        onSend={() => void assistant.send(picked ?? undefined)}
        thinking={thinking || reading}
        model={model}
        models={models}
        onModelChange={assistant.setChatModel}
        dataAccess={dataAccess}
        onAttach={(file) => void assistant.attach(file)}
        attaching={assistant.attaching}
        attachedName={attachedLabel(attachments)}
        onDetach={() => void assistant.detach()}
        compact={compact}
      />
    </>
  );
}
