"use client";

import {
  AI_TARGET_SHOWS_ON,
  findGoogleLinks,
  type AiAttachment,
  type AiAvailability,
  type AiBatch,
  type AiChatSummary,
  type AiIntakeReply,
  type AiMessage,
} from "@finance/shared";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { RowResult } from "@/components/assistant/batch-card";
import { labelFor } from "@/components/assistant/draft-card";
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

/** Said when a conversation was never kept, so nothing on it can be confirmed. */
const NOT_KEPT =
  "This conversation was not kept, so it cannot be saved from here. Ask again, or use the ordinary form.";

/** The Assistant's own pages, where the conversation is the page itself. */
export function onAssistantPage(pathname: string): boolean {
  return pathname === "/assistant" || pathname.startsWith("/assistant/");
}

type AssistantState = ReturnType<typeof useConversation>;

const AssistantContext = createContext<AssistantState | null>(null);

/**
 * One conversation, held above every page (B4).
 *
 * The Assistant page and the floating window are two views of the same
 * thing: expanding the window to the page and back must keep the
 * conversation, the attached files, the draft card and anything typed into
 * it. The dashboard layout stays mounted across a navigation, so state kept
 * here survives the trip in both directions — a reply still on its way
 * arrives in whichever view is open by then. Nothing is asked of the API
 * until one of the two views is opened.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const value = useConversation();
  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantState {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error("useAssistant must be used inside the dashboard layout");
  }
  return value;
}

function useConversation() {
  const router = useRouter();
  const pathname = usePathname();

  const [chats, setChats] = useState<AiChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [reply, setReply] = useState<AiIntakeReply | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  /**
   * What the person has typed over on the draft card, by field. Kept here
   * rather than in the card's boxes, so a corrected figure is still corrected
   * after the window is expanded to the page or the page shrunk to the
   * window. A new answer is a new draft, and starts clean.
   */
  const [edits, setEdits] = useState<Record<string, string>>({});

  /* ---------------------------------------------------------------------- */
  /*  The floating window                                                    */
  /* ---------------------------------------------------------------------- */

  const [windowOpen, setWindowOpen] = useState(false);
  /** The window's own reading of Settings, asked for each time it opens. */
  const [availability, setAvailability] = useState<AiAvailability | null>(null);
  /** An answer arrived while neither view was open to show it. */
  const [unseen, setUnseen] = useState(false);
  /** How many views are on screen: the page, or the window, or neither. */
  const watching = useRef(0);
  /** Where the window was expanded from, so shrinking it goes back there. */
  const lastPage = useRef<string | null>(null);

  /*
   * Opening the Assistant's page is the window becoming the page, so the
   * window is closed by it — otherwise it would spring open again on the
   * next page, over a conversation the person has since moved on from.
   * Adjusted while rendering, as React has state follow a prop.
   */
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    if (onAssistantPage(pathname)) setWindowOpen(false);
  }

  useEffect(() => {
    if (!onAssistantPage(pathname)) {
      lastPage.current = `${pathname}${window.location.search}`;
    }
  }, [pathname]);

  const loadAvailability = useCallback(async () => {
    try {
      setAvailability(await aiApi.availability());
    } catch (caught) {
      setAvailability({
        configured: false,
        // The same words the page uses for the same two cases.
        reason:
          caught instanceof ApiError && caught.status === 403
            ? "The assistant is not part of your role."
            : "The assistant could not be reached. Try again in a moment.",
      });
    }
  }, []);

  function openWindow() {
    setWindowOpen(true);
    setUnseen(false);
    void loadAvailability();
  }

  function closeWindow() {
    setWindowOpen(false);
  }

  /** The window, made the whole page. */
  function expand() {
    lastPage.current = `${window.location.pathname}${window.location.search}`;
    setWindowOpen(false);
    router.push("/assistant");
  }

  /** The page, made a window again over the page it was opened from. */
  function shrink() {
    openWindow();
    router.push(lastPage.current ?? "/");
  }

  /** A view says it is on screen; the function it returns says it has gone. */
  const watch = useCallback(() => {
    watching.current += 1;
    setUnseen(false);
    return () => {
      watching.current -= 1;
    };
  }, []);

  /** An answer is in. The launcher marks it if nobody is looking. */
  function said(next: AiMessage[]) {
    setMessages(next);
    if (watching.current === 0) setUnseen(true);
  }

  /* ---------------------------------------------------------------------- */
  /*  The conversation                                                       */
  /* ---------------------------------------------------------------------- */

  const loadChats = useCallback(async () => {
    try {
      setChats(await aiApi.chats());
    } catch {
      // The history list is a convenience. Losing it must not take the
      // conversation with it.
    }
  }, []);

  function startNew() {
    setChatId(null);
    setMessages([]);
    setReply(null);
    setEdits({});
    setInput("");
    setError(null);
    setAttachments([]);
    setDropped(new Set());
    setBatchResults({});
    setSavedOn(null);
  }

  async function openChat(id: string) {
    setError(null);
    try {
      const chat = await aiApi.chat(id);
      setChatId(chat.id);
      setMessages(chat.messages);
      // A draft already saved is not offered again (A4): its card would be a
      // second record. Its sentence is in the conversation; the link is here.
      const saved = chat.reply?.saved ? chat.reply.target : null;
      setReply(saved ? null : chat.reply);
      setEdits({});
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
      // Import is a page to work on, not one to read past a window.
      setWindowOpen(false);
      router.push(`/data?batch=${batchId}`);
    } catch (caught) {
      setError(explain(caught, "Those rows could not be staged for import."));
    } finally {
      setStaging(null);
    }
  }

  async function removeChat(id: string) {
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
      setEdits({});
      // A new answer means a new set of rows. Carrying the last batch's
      // struck-out lines or its results onto it would strike out whichever
      // rows happened to share those positions.
      setDropped(new Set());
      setBatchResults(savedRows(result.batch));
      const answer =
        result.nextQuestion ?? result.clarification ?? result.summary;
      if (answer) said([...next, { role: "assistant", content: answer }]);

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
    if (watching.current === 0) setUnseen(true);
    setSaving(false);
    // The page behind the window too: a row just saved shows on it.
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
      if (watching.current === 0) setUnseen(true);
      setSavedOn(saved.showsOn);
      setReply(null);
      setEdits({});
      router.refresh();
    } catch (caught) {
      setError(explain(caught, "Could not save that. Try the ordinary form."));
    } finally {
      setSaving(false);
    }
  }

  function toggleDrop(index: number) {
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function edit(field: string, value: string) {
    setEdits((current) => ({ ...current, [field]: value }));
  }

  return {
    chats,
    chatId,
    messages,
    reply,
    input,
    setInput,
    thinking,
    saving,
    error,
    setError,
    attachments,
    attaching,
    reading,
    staging,
    dropped,
    batchResults,
    savingRow,
    savedCount,
    savedOn,
    edits,
    loadChats,
    startNew,
    openChat,
    attach,
    detach,
    sendToImport,
    removeChat,
    send,
    confirmRow,
    confirmBatch,
    confirm,
    toggleDrop,
    edit,
    windowOpen,
    availability,
    unseen,
    watch,
    openWindow,
    closeWindow,
    expand,
    shrink,
  };
}
