"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import {
  AI_TARGET_SHOWS_ON,
  aiModelsFor,
  findGoogleLinks,
  type AiAttachment,
  type AiAvailability,
  type AiBatch,
  type AiChatSummary,
  type AiDataAccess,
  type AiIntakeReply,
  type AiMessage,
  type AiModel,
} from "@finance/shared";
import { History, LoaderCircle, Sparkles, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AttachmentCard } from "@/components/assistant/attachment-card";
import { BatchCard, type RowResult } from "@/components/assistant/batch-card";
import { ChatRail } from "@/components/assistant/chat-rail";
import { Composer } from "@/components/assistant/composer";
import { DraftCard, labelFor } from "@/components/assistant/draft-card";
import { MarkWrong } from "@/components/assistant/mark-wrong";
import { Welcome } from "@/components/assistant/welcome";
import { useCan, useSession } from "@/components/auth/session-provider";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";

/**
 * What actually went wrong, rather than that something did.
 *
 * The API answers a rejected save with `Validation failed` and a map of which
 * fields it objected to. Showing only the first half is how a save that was
 * being refused for one nameable reason read as the assistant being broken —
 * the reason was in the response the whole time.
 */
function explain(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiError)) return fallback;
  const fields = Object.entries(caught.fieldErrors ?? {});
  if (!fields.length) return caught.message;

  const detail = fields
    // "_" is the whole object, not a field — an unexpected key, or a rule
    // about two fields together.
    .map(([field, messages]) =>
      field === "_" ? messages[0] : `${labelFor(field)} — ${messages[0]}`,
    )
    .join("; ");

  return `${caught.message}: ${detail}`;
}

/** The rows of a table already saved, as the conversation keeps them (A4). */
function savedRows(
  batch: AiBatch | null | undefined,
): Record<number, RowResult> {
  const results: Record<number, RowResult> = {};
  for (const [row, saved] of Object.entries(batch?.saved ?? {})) {
    results[Number(row)] = { ok: true, refNo: saved.refNo };
  }
  return results;
}

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

/** What the message box says is attached: the file, or its tabs or sheets. */
function attachedLabel(attachments: AiAttachment[]): string | null {
  if (attachments.length < 2) return attachments[0]?.name ?? null;
  const parts = partsOf(attachments);
  const whole = parts === "sheets" ? "A workbook" : "A Google Sheet";
  return `${sheetOf(attachments) ?? whole} · ${attachments.length} ${parts}`;
}

/** Said when a conversation was never kept, so nothing on it can be confirmed. */
const NOT_KEPT =
  "This conversation was not kept, so it cannot be saved from here. Ask again, or use the ordinary form.";

/**
 * The assistant, as a room rather than a page.
 *
 * Three regions: the conversations you have had, the one you are having, and
 * the box you type in. It fills the window below the top bar so the composer
 * stays put and the transcript scrolls behind it — a chat that grows the page
 * downward means hunting for the input after every reply.
 */
export function AssistantScreen({
  availability,
}: {
  availability: AiAvailability;
}) {
  const router = useRouter();
  const user = useSession();
  const canConfigure = useCan("settings.write");

  const [chats, setChats] = useState<AiChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [reply, setReply] = useState<AiIntakeReply | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  /**
   * One file, or every tab of a Sheet read by its link (A3b), or every sheet
   * of an Excel workbook (A3c).
   */
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  /** A Google link in the message being read, before the message goes. */
  const [reading, setReading] = useState(false);
  /** The file being sent to Import. */
  const [staging, setStaging] = useState<string | null>(null);
  /** Rows the person struck out before saving, by index. */
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  /** Each row's outcome: saved (now, or on an earlier visit) or refused. */
  const [batchResults, setBatchResults] = useState<Record<number, RowResult>>(
    {},
  );
  /** The row being confirmed on its own. */
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  /** Where the record just saved now shows, for the link under "Saved". */
  const [savedOn, setSavedOn] = useState<{ name: string; href: string } | null>(
    null,
  );
  const [model, setModel] = useState<AiModel>(
    availability.model ?? "claude-opus-5",
  );
  const dataAccess: AiDataAccess =
    availability.dataAccess && availability.dataAccess !== "off"
      ? availability.dataAccess
      : "full";

  const scroller = useRef<HTMLDivElement>(null);
  const configured = availability.configured;

  const loadChats = useCallback(async () => {
    try {
      setChats(await aiApi.chats());
    } catch {
      // The history list is a convenience. Losing it must not take the
      // conversation with it.
    }
  }, []);

  useEffect(() => {
    // Fetching on mount, which is exactly the external-system sync effects are
    // for; the rule cannot tell that from a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  if (!configured) {
    return (
      <div className="grid min-h-[calc(100dvh-10rem)] place-items-center px-4">
        {/* The handoff's card: a violet and a lime circle behind, the lime
            robot tile, and the way to switch it on in violet. */}
        <Card className="sv-rise relative flex w-full max-w-[480px] flex-col items-center gap-3 overflow-hidden px-8 py-10 text-center">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-15 -right-15 size-45 rounded-full bg-(--sv-violet-tint)"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-15 -left-10 size-35 rounded-full bg-(--sv-lime-tint)"
          />
          <span className="relative grid size-18 place-items-center rounded-[20px] bg-(--sv-accent) text-(--sv-on-accent) shadow-[0_10px_22px_rgb(150_200_0/0.3)]">
            <RobotIcon weight="duotone" size={38} />
          </span>
          <p className="relative text-[22px] font-extrabold">Not switched on</p>
          <p className="relative text-[14px] leading-[1.55] text-(--sv-muted)">
            {availability.reason}
          </p>
          {canConfigure ? (
            <Link
              href="/settings?tab=assistant"
              className="relative mt-1 inline-flex h-[42px] items-center gap-[7px] rounded-lg bg-(--sv-violet) px-4 text-[14px] font-extrabold text-white transition hover:-translate-y-px"
            >
              Add an API key
              <ArrowRightIcon weight="duotone" size={16} />
            </Link>
          ) : null}
        </Card>
      </div>
    );
  }

  function startNew() {
    setChatId(null);
    setMessages([]);
    setReply(null);
    setInput("");
    setError(null);
    setDrawer(false);
    setAttachments([]);
    setDropped(new Set());
    setBatchResults({});
    setSavedOn(null);
  }

  async function open(id: string) {
    setDrawer(false);
    setError(null);
    try {
      const chat = await aiApi.chat(id);
      setChatId(chat.id);
      setMessages(chat.messages);
      // A draft already saved is not offered again (A4): its card would be a
      // second record. Its sentence is in the conversation; the link is here.
      const saved = chat.reply?.saved ? chat.reply.target : null;
      setReply(saved ? null : chat.reply);
      setSavedOn(saved ? AI_TARGET_SHOWS_ON[saved] : null);
      setDropped(new Set());
      setBatchResults(savedRows(chat.reply?.batch));
      setAttachments(chat.attachments);
    } catch {
      setError("That conversation could not be opened.");
    }
  }

  async function attach(file: File) {
    setAttaching(true);
    setError(null);
    try {
      setAttachments(await aiApi.attach(file));
    } catch (caught) {
      setError(explain(caught, "That file could not be read."));
    } finally {
      setAttaching(false);
    }
  }

  /** One file by its card's cross, or every one by the message box's. */
  async function detach(id?: string) {
    const going = attachments.filter((file) => !id || file.id === id);
    if (!going.length) return;
    setAttachments((current) =>
      current.filter((file) => !going.some((gone) => gone.id === file.id)),
    );
    // The rows go too — a spreadsheet of real figures should not linger
    // because somebody changed their mind about asking.
    for (const file of going) {
      await aiApi.detach(file.id).catch(() => undefined);
    }
  }

  async function sendToImport(attachment: AiAttachment) {
    setStaging(attachment.id);
    setError(null);
    try {
      // The plan the assistant proposed, if it got as far as one. Without it
      // the person maps the columns themselves, exactly as before. A plan is
      // for one file: several tabs never have one.
      const { batchId } = await aiApi.sendToImport(
        attachment.id,
        attachments.length === 1 ? (reply?.importPlan ?? null) : null,
      );
      setAttachments((current) =>
        current.map((file) =>
          file.id === attachment.id
            ? { ...file, importBatchId: batchId }
            : file,
        ),
      );
      router.push(`/data?batch=${batchId}`);
    } catch (caught) {
      setError(explain(caught, "Those rows could not be staged for import."));
    } finally {
      setStaging(null);
    }
  }

  async function remove(id: string) {
    try {
      await aiApi.removeChat(id);
      setChats((current) => current.filter((chat) => chat.id !== id));
      if (id === chatId) startNew();
    } catch {
      setError("That conversation could not be deleted.");
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || thinking || reading) return;

    /*
     * A Google link is read before the message goes (A3), so the file is on
     * the conversation by the time the model sees it. The model cannot open
     * a link, and must never be left to imagine what one holds. One link at a
     * time: two links and one card would let somebody believe both were read.
     */
    const links = findGoogleLinks(text);
    if (links.length > 1) {
      setError(
        "That message has more than one Google link. Send them one at a time: the Assistant reads one file per message.",
      );
      return;
    }

    const before = messages;
    const next: AiMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setSavedOn(null);

    let files = attachments;
    if (links.length) {
      setReading(true);
      try {
        files = await aiApi.attachLink(links[0].url);
        setAttachments(files);
      } catch (caught) {
        // Nothing was sent. The message goes back in the box, and the reason
        // (most often "share it with …") shows above it.
        setMessages(before);
        setInput(text);
        setError(explain(caught, "That link could not be read."));
        return;
      } finally {
        setReading(false);
      }
    }

    setThinking(true);
    try {
      const result = await aiApi.turn({
        messages: next,
        target: reply?.target ?? undefined,
        draft: reply?.draft,
        chatId: chatId ?? undefined,
        attachmentIds: files.length ? files.map((file) => file.id) : undefined,
      });

      setReply(result);
      // A new answer means a new set of rows. Carrying the last batch's
      // struck-out lines or its results onto it would strike out whichever
      // rows happened to share those positions.
      setDropped(new Set());
      setBatchResults(savedRows(result.batch));
      const said =
        result.nextQuestion ?? result.clarification ?? result.summary;
      if (said) setMessages([...next, { role: "assistant", content: said }]);

      if (result.chatId && result.chatId !== chatId) setChatId(result.chatId);
      void loadChats();
    } catch (caught) {
      setError(
        explain(
          caught,
          "The assistant could not answer. The ordinary forms all still work.",
        ),
      );
    } finally {
      setThinking(false);
    }
  }

  /**
   * One row of the table, confirmed on its own (A4). Its values are read
   * from the conversation on the server; only its number is sent. The
   * outcome stays on the row: a refusal says why, beside the button that
   * tries it again.
   */
  async function saveRow(index: number): Promise<RowResult> {
    if (!chatId) return { ok: false, error: NOT_KEPT };
    try {
      const saved = await aiApi.confirmRow(chatId, index);
      return { ok: true, refNo: saved.refNo };
    } catch (caught) {
      return { ok: false, error: explain(caught, "Could not save that one.") };
    }
  }

  async function confirmRow(index: number) {
    setSavingRow(index);
    setError(null);
    const result = await saveRow(index);
    setBatchResults((current) => ({ ...current, [index]: result }));
    setSavingRow(null);
    if (result.ok) router.refresh();
  }

  /**
   * Confirm and save all, after the count and the total: one row at a time,
   * each checked and saved on its own, with its own audit row.
   *
   * The table is not cleared when it finishes. With seventeen records the
   * interesting part is usually the two that were refused, and a card that
   * congratulates itself and vanishes takes that with it. It does not stop
   * at the first refusal either: one row with a malformed email should not
   * strand the sixteen behind it.
   */
  async function confirmBatch() {
    const batch = reply?.batch;
    if (!batch) return;

    const waiting = batch.rows
      .map((_, index) => index)
      .filter((index) => !dropped.has(index) && !batchResults[index]?.ok);
    if (!waiting.length) return;

    setSaving(true);
    setSavedCount(0);
    setError(null);

    let saved = 0;
    for (const [done, index] of waiting.entries()) {
      const result = await saveRow(index);
      if (result.ok) saved += 1;
      setBatchResults((current) => ({ ...current, [index]: result }));
      setSavedCount(done + 1);
    }

    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        content: `Saved ${saved} of ${waiting.length}${
          saved === waiting.length ? "." : " — the rest say why on their rows."
        }`,
      },
    ]);
    setSaving(false);
    router.refresh();
  }

  /**
   * Confirm and save on the draft card (A4). The server checks the boxes
   * again and saves them the way the record's own form does, as this
   * person, and answers with what was saved and where it now shows.
   */
  async function confirm(edited: Record<string, string>) {
    if (!reply?.target) return;
    if (!chatId) {
      setError(NOT_KEPT);
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const saved = await aiApi.confirm(chatId, edited);
      // What was saved, and the page it now shows on: the owner's complaint
      // was a record that showed on one page and not on its own.
      setMessages((current) => [
        ...current,
        { role: "assistant", content: saved.said },
      ]);
      setSavedOn(saved.showsOn);
      setReply(null);
      router.refresh();
    } catch (caught) {
      setError(explain(caught, "Could not save that. Try the ordinary form."));
    } finally {
      setSaving(false);
    }
  }

  async function changeModel(next: AiModel) {
    const previous = model;
    setModel(next);
    try {
      await aiApi.updateSettings({ model: next });
    } catch {
      setModel(previous);
      setError("Could not change the model.");
    }
  }

  /**
   * The Sheet, when the files are its tabs, or the workbook, when they are
   * its sheets: named once, above their cards.
   */
  const sheet = attachments.length > 1 ? sheetOf(attachments) : null;

  // A draft has its own card; a link beside it would be a second thing to
  // press before the first has been read.
  const place = reply
    ? reply.target || reply.batch || reply.importPlan
      ? null
      : (reply.screen ?? null)
    : savedOn;

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0">
      <aside className="hidden w-64 shrink-0 border-r border-border lg:block">
        <ChatRail
          chats={chats}
          activeId={chatId}
          onNew={startNew}
          onOpen={open}
          onDelete={remove}
        />
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close history"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-border">
            <ChatRail
              chats={chats}
              activeId={chatId}
              onNew={startNew}
              onOpen={open}
              onDelete={remove}
              onClose={() => setDrawer(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <History className="size-4" />
            History
          </button>
          <button
            type="button"
            onClick={startNew}
            className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <SquarePen className="size-4" />
            New
          </button>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          {messages.length === 0 && !reply && !attachments.length ? (
            <Welcome
              fullName={user.fullName}
              dataAccess={dataAccess}
              onPick={setInput}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
              {/* A Sheet read whole (A3b), or a workbook (A3c): a card a tab
                  or a sheet, each with its own rows, columns and totals,
                  never one card for the lot. */}
              {attachments.length ? (
                <div className="flex flex-col gap-3">
                  {sheet ? (
                    <p className="text-xs text-muted-foreground">
                      {sheet} ·{" "}
                      <span className="num">{attachments.length}</span>{" "}
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
                      staging={staging === attachment.id}
                      onSendToImport={() => void sendToImport(attachment)}
                      onRemove={() => void detach(attachment.id)}
                    />
                  ))}
                </div>
              ) : null}

              {messages.map((message, index) =>
                message.role === "user" ? (
                  <p
                    key={index}
                    className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-primary-foreground wrap-anywhere"
                  >
                    {message.content}
                  </p>
                ) : (
                  <div key={index} className="flex gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <Sparkles className="size-3.5" />
                    </span>
                    <p className="min-w-0 pt-0.5 text-[15px] leading-relaxed whitespace-pre-wrap wrap-anywhere">
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
                  results={batchResults}
                  saving={saving}
                  savingRow={savingRow}
                  savedCount={savedCount}
                  dropped={dropped}
                  onDrop={(index) =>
                    setDropped((current) => {
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                  onConfirmRow={(index) => void confirmRow(index)}
                  onConfirmAll={() => void confirmBatch()}
                />
              ) : reply?.target ? (
                <DraftCard
                  key={JSON.stringify(reply.draft)}
                  reply={reply}
                  saving={saving}
                  onConfirm={confirm}
                />
              ) : null}
            </div>
          )}
        </div>

        {error ? (
          <div className="shrink-0 px-4 pt-2">
            <p
              role="alert"
              className="mx-auto max-w-3xl rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
            >
              {error}
            </p>
          </div>
        ) : null}

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          thinking={thinking || reading}
          model={model}
          models={aiModelsFor(availability.provider ?? "anthropic")}
          onModelChange={(next) => void changeModel(next)}
          canChangeModel={canConfigure}
          dataAccess={dataAccess}
          onAttach={(file) => void attach(file)}
          attaching={attaching}
          attachedName={attachedLabel(attachments)}
          onDetach={() => void detach()}
        />
      </div>
    </div>
  );
}
