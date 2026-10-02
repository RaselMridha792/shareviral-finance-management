"use client";

import { AI_FEEDBACK_MAX } from "@finance/shared";
import { LoaderCircle, ThumbsDown } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";

/**
 * "This was wrong", under the Assistant's latest answer (2 Oct 2026, A2b).
 *
 * The owner: "model er porikkha coltei thakbe and aste aste improve korbo".
 * A wrong answer said so here is kept with why, shown to the Assistant on
 * later turns, and put on the owner's list, where it can become a rule.
 *
 * Only the latest answer: that is the one the conversation holds whole on
 * the server, draft and all, and the server reads what was asked and
 * answered from there rather than from this box.
 */
export function MarkWrong({ chatId }: { chatId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await aiApi.feedback(chatId, reason);
      setSent(true);
      setOpen(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? [
              caught.message,
              ...Object.values(caught.fieldErrors ?? {}).map(
                (messages) => messages[0],
              ),
            ].join(": ")
          : "That could not be sent. Try again.",
      );
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <p className="ml-10 text-[13px] text-muted-foreground">
        Kept as a mistake, with why. It is shown to the Assistant from now on,
        and the owner can make it a rule.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-10 inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ThumbsDown className="size-3.5" />
        This was wrong
      </button>
    );
  }

  return (
    <form onSubmit={send} className="ml-10 flex flex-col gap-2">
      <label
        htmlFor="mark-wrong-reason"
        className="text-[13px] font-semibold text-foreground"
      >
        What was wrong, and what would have been right?
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="mark-wrong-reason"
          autoFocus
          value={reason}
          maxLength={AI_FEEDBACK_MAX}
          onChange={(event) => setReason(event.target.value)}
          placeholder="eta subscription, AI tools and subscriptions e jabe"
          className="min-w-0 flex-1 basis-64"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={sending || reason.trim().length < 3}
        >
          {sending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Send
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-negative">
          {error}
        </p>
      ) : null}
    </form>
  );
}
