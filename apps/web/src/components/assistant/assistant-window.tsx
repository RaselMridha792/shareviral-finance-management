"use client";

import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import {
  ChevronDown,
  History,
  LoaderCircle,
  Maximize2,
  Minus,
  SquarePen,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import {
  onAssistantPage,
  useAssistant,
} from "@/components/assistant/assistant-provider";
import { ChatRail } from "@/components/assistant/chat-rail";
import { Conversation } from "@/components/assistant/conversation";
import { NotSwitchedOn } from "@/components/assistant/not-switched-on";
import { useCan } from "@/components/auth/session-provider";
import { cn } from "@/lib/utils";

/**
 * The room every page leaves at its foot while the launcher is drawn: the
 * launcher's 52px, its 20px from the edge, and 20px clear above it. A page
 * scrolled to its end then never has its last control under the button.
 * Paper has no launcher, so a printed payslip keeps the foot it had.
 */
export const LAUNCHER_ROOM = "pb-[92px] print:pb-[clamp(16px,2vw,24px)]";

const HEADER_BUTTON =
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * The Assistant over any page (B4): a launcher at the foot of the screen, and
 * the chat as a small window above it.
 *
 * Only for those who may use the Assistant at all (B1: the Super Admin and
 * the CFO). Not on the Assistant's own pages, where the conversation is the
 * page. The window and the page are two views of one conversation, held in
 * the provider: Expand opens the page on it, and the page's "Open as a
 * window" comes back here, with the files, the draft card and anything
 * typed into it.
 *
 * Under every popup: the launcher and the window sit above the page and the
 * top bar, and below the drawers and dialogs, so a form opened from the page
 * is never under the window. On a phone the window is the whole screen.
 */
export function AssistantWindow() {
  const pathname = usePathname();
  const canUse = useCan("ai.use");
  const canConfigure = useCan("settings.write");
  const assistant = useAssistant();
  const [history, setHistory] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);

  if (!canUse || onAssistantPage(pathname)) return null;

  const open = assistant.windowOpen;
  const busy = assistant.thinking || assistant.reading || assistant.saving;
  const availability = assistant.availability;

  function close() {
    setHistory(false);
    assistant.closeWindow();
    launcher.current?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    if (history) setHistory(false);
    else close();
  }

  /**
   * A link followed from the window — "Open AI tools and subscriptions"
   * under a saved record, a file's staged rows, What the Assistant knows —
   * is a page the person wants to look at, so the window gets out of its
   * way. The conversation waits behind the launcher.
   */
  function leaveByLink(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest("a[href]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (link.getAttribute("target") === "_blank") return;
    setHistory(false);
    assistant.closeWindow();
  }

  return (
    <>
      {open ? (
        <div
          role="dialog"
          aria-label="Assistant"
          onKeyDown={keyDown}
          onClickCapture={leaveByLink}
          className={cn(
            "sv-rise fixed z-[45] flex flex-col overflow-hidden bg-background print:hidden",
            // A phone: the whole screen, over the top bar.
            "inset-0",
            // Wider: a window above the launcher, clear of the top bar.
            "sm:inset-auto sm:right-5 sm:bottom-[88px] sm:h-[min(640px,calc(100dvh-172px))] sm:w-[400px] sm:rounded-2xl sm:border sm:border-border sm:shadow-[0_18px_48px_rgb(16_12_40/0.22)]",
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-(--sv-surface) py-2 pr-2 pl-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-(--sv-accent) text-(--sv-on-accent)">
              <RobotIcon weight="duotone" size={17} />
            </span>
            <p className="min-w-0 flex-1 truncate text-[15px] font-extrabold">
              Assistant
            </p>
            {availability?.configured ? (
              <>
                <button
                  type="button"
                  onClick={() => setHistory((shown) => !shown)}
                  aria-label="History"
                  aria-pressed={history}
                  title="Your earlier conversations"
                  className={cn(
                    HEADER_BUTTON,
                    history && "bg-surface-muted text-foreground",
                  )}
                >
                  <History className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistory(false);
                    assistant.startNew();
                  }}
                  aria-label="New chat"
                  title="New chat"
                  className={HEADER_BUTTON}
                >
                  <SquarePen className="size-4" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setHistory(false);
                assistant.expand();
              }}
              aria-label="Expand to the Assistant page"
              title="Expand to the Assistant page — the same conversation"
              className={HEADER_BUTTON}
            >
              <Maximize2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="Minimise the Assistant"
              title="Minimise — the conversation stays"
              className={HEADER_BUTTON}
            >
              <Minus className="size-4" />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            {!availability ? (
              <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin" />
                  Opening…
                </span>
              </div>
            ) : !availability.configured ? (
              <div className="flex-1 overflow-y-auto p-4">
                <NotSwitchedOn
                  reason={availability.reason}
                  canConfigure={canConfigure}
                  compact
                />
              </div>
            ) : (
              <>
                <Conversation availability={availability} compact />
                {history ? (
                  <ChatRail
                    className="absolute inset-0 z-10"
                    chats={assistant.chats}
                    activeId={assistant.chatId}
                    onNew={() => {
                      setHistory(false);
                      assistant.startNew();
                    }}
                    onOpen={(id) => {
                      setHistory(false);
                      void assistant.openChat(id);
                    }}
                    onDelete={(id) => void assistant.removeChat(id)}
                    onClose={() => setHistory(false)}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      <button
        ref={launcher}
        type="button"
        onClick={open ? close : assistant.openWindow}
        aria-expanded={open}
        aria-label={
          open
            ? "Minimise the Assistant"
            : assistant.unseen
              ? "Open the Assistant — a new answer is waiting"
              : "Open the Assistant"
        }
        title={open ? "Minimise the Assistant" : "Ask the Assistant"}
        className={cn(
          "fixed right-4 bottom-4 z-[44] grid size-[52px] print:hidden cursor-pointer place-items-center rounded-full bg-(--sv-accent) text-(--sv-on-accent) shadow-[0_10px_22px_rgb(150_200_0/0.35)] transition hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:right-5 sm:bottom-5",
          // On a phone the open window is the whole screen and has its own
          // way out; a second one floating over its message box would sit on
          // the Send button.
          open && "max-sm:hidden",
        )}
      >
        {open ? (
          <ChevronDown className="size-6" />
        ) : (
          <RobotIcon weight="duotone" size={27} />
        )}
        {!open && busy ? (
          <span
            aria-hidden="true"
            className="absolute -inset-1 animate-spin rounded-full border-2 border-transparent border-t-(--sv-violet) motion-reduce:animate-none"
          />
        ) : null}
        {!open && !busy && assistant.unseen ? (
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 size-3.5 rounded-full border-2 border-(--sv-surface) bg-(--sv-violet)"
          />
        ) : null}
      </button>
    </>
  );
}
