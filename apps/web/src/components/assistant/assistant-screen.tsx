"use client";

import { type AiAvailability } from "@finance/shared";
import { History, PictureInPicture2, Settings, SquarePen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useAssistant } from "@/components/assistant/assistant-provider";
import { ChatRail } from "@/components/assistant/chat-rail";
import { Conversation } from "@/components/assistant/conversation";
import { NotSwitchedOn } from "@/components/assistant/not-switched-on";
import { useCan } from "@/components/auth/session-provider";

/**
 * The assistant, as a room rather than a page.
 *
 * Three regions: the conversations you have had, the one you are having, and
 * the box you type in. It fills the window below the top bar so the composer
 * stays put and the transcript scrolls behind it — a chat that grows the page
 * downward means hunting for the input after every reply.
 *
 * The conversation itself is held above the pages (B4), so the floating
 * window shows the same one: "Open as a window" goes back to the page it was
 * expanded from, with the window open on it.
 */
export function AssistantScreen({
  availability,
}: {
  availability: AiAvailability;
}) {
  const canConfigure = useCan("settings.write");
  const assistant = useAssistant();
  const [drawer, setDrawer] = useState(false);

  if (!availability.configured) {
    return (
      <div className="grid min-h-[calc(100dvh-10rem)] place-items-center px-4">
        <NotSwitchedOn
          reason={availability.reason}
          canConfigure={canConfigure}
        />
      </div>
    );
  }

  function startNew() {
    setDrawer(false);
    assistant.startNew();
  }

  function open(id: string) {
    setDrawer(false);
    void assistant.openChat(id);
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0">
      <aside className="hidden w-64 shrink-0 border-r border-border lg:block">
        <ChatRail
          chats={assistant.chats}
          activeId={assistant.chatId}
          onNew={startNew}
          onOpen={open}
          onDelete={(id) => void assistant.removeChat(id)}
          onPopOut={assistant.shrink}
          settings
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
              chats={assistant.chats}
              activeId={assistant.chatId}
              onNew={startNew}
              onOpen={open}
              onDelete={(id) => void assistant.removeChat(id)}
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
            onClick={assistant.shrink}
            aria-label="Open as a window"
            title="Open as a window over the page you came from"
            className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <PictureInPicture2 className="size-4" />
          </button>
          <Link
            href="/assistant/settings"
            aria-label="Assistant settings"
            title="Assistant settings"
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <Settings className="size-4" />
          </Link>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <SquarePen className="size-4" />
            New
          </button>
        </div>

        <Conversation availability={availability} />
      </div>
    </div>
  );
}
