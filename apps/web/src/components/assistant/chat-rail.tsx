"use client";

import type { AiChatSummary } from "@finance/shared";
import { MessageSquarePlus, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Past conversations, newest first.
 *
 * Grouped by when rather than listed flat, because the thing people come back
 * for is almost always "the one from this morning". Each is this person's own
 * — the API has no route to anybody else's, so there is nothing here to filter.
 */

type Bucket = "Today" | "Yesterday" | "Previous 7 days" | "Older";
const ORDER: Bucket[] = ["Today", "Yesterday", "Previous 7 days", "Older"];

function bucketOf(iso: string): Bucket {
  const then = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const days = Math.floor(
    (startOfToday.getTime() - then.getTime()) / 86_400_000,
  );
  if (days < 0) return "Today";
  if (days < 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  return "Older";
}

export function ChatRail({
  chats,
  activeId,
  onNew,
  onOpen,
  onDelete,
  onClose,
  className,
}: {
  chats: AiChatSummary[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  /** Only passed on the mobile drawer, where the rail needs a way out. */
  onClose?: () => void;
  className?: string;
}) {
  const groups = ORDER.map((bucket) => ({
    bucket,
    items: chats.filter((chat) => bucketOf(chat.updatedAt) === bucket),
  })).filter((group) => group.items.length > 0);

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-surface", className)}>
      <div className="flex shrink-0 items-center gap-2 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <MessageSquarePlus className="size-4 shrink-0 text-primary" />
          New chat
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="cursor-pointer rounded-lg p-2 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-xs leading-relaxed text-muted-foreground">
            Nothing yet. What you ask is saved here for you alone, and deleting
            it removes it.
          </p>
        ) : (
          groups.map(({ bucket, items }) => (
            <div key={bucket} className="flex flex-col gap-0.5">
              <p className="px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {bucket}
              </p>
              {items.map((chat) => (
                <div
                  key={chat.id}
                  className={cn(
                    "group flex items-center rounded-lg pr-1 transition",
                    chat.id === activeId
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(chat.id)}
                    aria-current={chat.id === activeId ? "true" : undefined}
                    className="min-w-0 flex-1 cursor-pointer truncate px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {chat.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(chat.id)}
                    aria-label={`Delete "${chat.title}"`}
                    title="Delete this conversation"
                    // Always reachable by keyboard; only shown on hover so the
                    // list does not read as a row of delete buttons.
                    className="cursor-pointer rounded-md p-1.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-negative focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
