"use client";

import {
  AI_TARGET_LABELS,
  type AiAttachment,
  type AiAvailability,
  type AiChatSummary,
  type AiDataAccess,
  type AiIntakeReply,
  type AiMessage,
  type AiModel,
} from "@finance/shared";
import {
  ArrowRight,
  History,
  LoaderCircle,
  Sparkles,
  SquarePen,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AttachmentCard } from "@/components/assistant/attachment-card";
import { BatchCard, type RowResult } from "@/components/assistant/batch-card";
import { ChatRail } from "@/components/assistant/chat-rail";
import { Composer } from "@/components/assistant/composer";
import { DraftCard, labelFor } from "@/components/assistant/draft-card";
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
  const [attachment, setAttachment] = useState<AiAttachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [staging, setStaging] = useState(false);
  /** Rows the person struck out before saving, by index. */
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [batchResults, setBatchResults] = useState<RowResult[] | null>(null);
  const [savedCount, setSavedCount] = useState(0);
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
  }, [messages, reply, thinking]);

  if (!configured) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] items-center justify-center px-4">
        <Card className="flex max-w-md flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Sparkles className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">Not switched on</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {availability.reason}
            </p>
          </div>
          {canConfigure ? (
            <Link
              href="/settings?tab=assistant"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Add an API key
              <ArrowRight className="size-3.5" />
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
    setAttachment(null);
    setDropped(new Set());
    setBatchResults(null);
  }

  async function open(id: string) {
    setDrawer(false);
    setError(null);
    try {
      const chat = await aiApi.chat(id);
      setChatId(chat.id);
      setMessages(chat.messages);
      setReply(chat.reply);
      setAttachment(chat.attachments[0] ?? null);
    } catch {
      setError("That conversation could not be opened.");
    }
  }

  async function attach(file: File) {
    setAttaching(true);
    setError(null);
    try {
      setAttachment(await aiApi.attach(file));
    } catch (caught) {
      setError(explain(caught, "That file could not be read."));
    } finally {
      setAttaching(false);
    }
  }

  async function detach() {
    if (!attachment) return;
    const id = attachment.id;
    setAttachment(null);
    // The row goes too — a spreadsheet of real figures should not linger
    // because somebody changed their mind about asking.
    await aiApi.detach(id).catch(() => undefined);
  }

  async function sendToImport() {
    if (!attachment) return;
    setStaging(true);
    setError(null);
    try {
      // The plan the assistant proposed, if it got as far as one. Without it
      // the person maps the columns themselves, exactly as before.
      const { batchId } = await aiApi.sendToImport(
        attachment.id,
        reply?.importPlan ?? null,
      );
      setAttachment({ ...attachment, importBatchId: batchId });
      router.push(`/data?batch=${batchId}`);
    } catch (caught) {
      setError(explain(caught, "Those rows could not be staged for import."));
    } finally {
      setStaging(false);
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
    if (!text || thinking) return;

    const next: AiMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setThinking(true);
    setError(null);

    try {
      const result = await aiApi.turn({
        messages: next,
        target: reply?.target ?? undefined,
        draft: reply?.draft,
        chatId: chatId ?? undefined,
        attachmentId: attachment?.id,
      });

      setReply(result);
      // A new answer means a new set of rows. Carrying the last batch's
      // struck-out lines or its results onto it would strike out whichever
      // rows happened to share those positions.
      setDropped(new Set());
      setBatchResults(null);
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
   * Saves the batch, one row at a time, and leaves the outcome on screen.
   *
   * The table is not cleared when it finishes. With seventeen records the
   * interesting part is usually the two that were refused, and a card that
   * congratulates itself and vanishes takes that with it.
   */
  async function confirmBatch() {
    const batch = reply?.batch;
    if (!batch) return;

    const keeping = batch.rows.filter((_, index) => !dropped.has(index));
    if (!keeping.length) return;

    setSaving(true);
    setSavedCount(0);
    setError(null);

    try {
      const outcomes = await aiApi.saveMany(
        batch.target,
        keeping,
        setSavedCount,
      );

      // Back onto the full-length row list, so a dropped row keeps its place
      // in the table rather than shifting every result up by one.
      const byRow: RowResult[] = [];
      let taken = 0;
      batch.rows.forEach((_, index) => {
        byRow[index] = dropped.has(index)
          ? { ok: false, error: "Left out" }
          : outcomes[taken++];
      });

      setBatchResults(byRow);
      const saved = outcomes.filter((o) => o.ok).length;
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `Saved ${saved} of ${keeping.length}${
            saved === keeping.length ? "." : " — the rest are marked above."
          }`,
        },
      ]);
      router.refresh();
    } catch (caught) {
      setError(explain(caught, "Those could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function confirm(edited: Record<string, unknown>) {
    if (!reply?.target) return;
    setSaving(true);
    setError(null);

    try {
      const created = await aiApi.save(reply.target, edited);

      /**
       * After the save, never before, and never awaited in a way that could
       * hold up the confirmation. What they corrected on the card is the only
       * honest signal of how this company actually files things, and it was
       * being thrown away every time.
       */
      if (chatId) void aiApi.learn(chatId, reply.target, edited);

      const label = AI_TARGET_LABELS[reply.target];
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `Saved — ${label.toLowerCase()}${
            created.refNo ? `, ${created.refNo}` : ""
          }.`,
        },
      ]);
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
          {messages.length === 0 && !reply && !attachment ? (
            <Welcome
              fullName={user.fullName}
              dataAccess={dataAccess}
              onPick={setInput}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
              {attachment ? (
                <AttachmentCard
                  plan={reply?.importPlan ?? null}
                  attachment={attachment}
                  staging={staging}
                  onSendToImport={() => void sendToImport()}
                  onRemove={() => void detach()}
                />
              ) : null}

              {messages.map((message, index) =>
                message.role === "user" ? (
                  <p
                    key={index}
                    className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-primary-foreground"
                  >
                    {message.content}
                  </p>
                ) : (
                  <div key={index} className="flex gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <Sparkles className="size-3.5" />
                    </span>
                    <p className="min-w-0 pt-0.5 text-[15px] leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                  </div>
                ),
              )}

              {thinking ? (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <LoaderCircle className="size-3.5 animate-spin" />
                  </span>
                  Thinking…
                </div>
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
                  onConfirm={() => void confirmBatch()}
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
          thinking={thinking}
          model={model}
          onModelChange={(next) => void changeModel(next)}
          canChangeModel={canConfigure}
          dataAccess={dataAccess}
          onAttach={(file) => void attach(file)}
          attaching={attaching}
          attachedName={attachment?.name ?? null}
          onDetach={() => void detach()}
        />
      </div>
    </div>
  );
}
