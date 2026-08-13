"use client";

import {
  AI_ATTACHMENT_EXTENSIONS,
  AI_MODELS,
  AI_MODEL_LABELS,
  AI_MODEL_SHORT,
  type AiDataAccess,
  type AiModel,
} from "@finance/shared";
import {
  ArrowUp,
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  Paperclip,
  X,
} from "lucide-react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";

/** Beyond this the box stops growing and scrolls instead. */
const MAX_HEIGHT = 200;

/**
 * The box at the bottom of the room.
 *
 * The model sits in here rather than in Settings because it is a property of
 * the answer being asked for, not of the installation — the person about to
 * type a long, rambling entry is the one who knows it is worth Opus. Changing
 * it is still a Super Admin's call and still writes an audit row; everybody
 * else sees which model is answering, which is the part that matters when the
 * reply is disappointing.
 */
export function Composer({
  value,
  onChange,
  onSend,
  thinking,
  model,
  onModelChange,
  canChangeModel,
  dataAccess,
  onAttach,
  attaching,
  attachedName,
  onDetach,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  thinking: boolean;
  model: AiModel;
  onModelChange: (model: AiModel) => void;
  canChangeModel: boolean;
  dataAccess: AiDataAccess;
  onAttach: (file: File) => void;
  attaching: boolean;
  attachedName: string | null;
  onDetach: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Grows with what is being written, up to a point. Reset first, or the
  // height only ever ratchets upward as text is deleted.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSend();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line. During IME composition Enter
    // is committing a Bangla character, not sending — sending there would eat
    // the word being typed.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      onSend();
    }
  }

  const lookups = dataAccess === "full";

  return (
    <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-4">
      <form onSubmit={submit} className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-border bg-surface shadow-e1 transition focus-within:border-primary">
          {attachedName ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Paperclip className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {attachedName}
              </span>
              <button
                type="button"
                onClick={onDetach}
                aria-label="Remove the attached file"
                className="cursor-pointer rounded-md p-1 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}

          <label className="sr-only" htmlFor="assistant-input">
            What are you recording?
          </label>
          <textarea
            id="assistant-input"
            ref={box}
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={keyDown}
            placeholder="Type it however you would say it…"
            autoFocus
            className="block max-h-50 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
          />

          <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
            <input
              ref={picker}
              type="file"
              accept={AI_ATTACHMENT_EXTENSIONS.join(",")}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAttach(file);
                // Cleared so choosing the same file twice fires again.
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={attaching}
              aria-label="Attach a spreadsheet"
              title="Attach a CSV or Excel file for it to read"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {attaching ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}
            </button>

            {canChangeModel ? (
              <div className="relative">
                <label className="sr-only" htmlFor="assistant-model">
                  Which model answers
                </label>
                <select
                  id="assistant-model"
                  value={model}
                  onChange={(event) =>
                    onModelChange(event.target.value as AiModel)
                  }
                  className="h-8 cursor-pointer appearance-none rounded-lg bg-transparent pr-7 pl-2.5 text-xs font-medium text-muted-foreground transition outline-none hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {AI_MODELS.map((option) => (
                    <option
                      key={option}
                      value={option}
                      title={AI_MODEL_LABELS[option]}
                    >
                      {AI_MODEL_SHORT[option]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground" />
              </div>
            ) : (
              <span
                className="px-2.5 text-xs font-medium text-muted-foreground"
                title="Only a Super Admin can change which model answers"
              >
                {AI_MODEL_SHORT[model]}
              </span>
            )}

            <span
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground"
              title={
                lookups
                  ? "It can look up figures from your books, within what your role may see."
                  : "It can fill in forms but cannot read the ledger. A Super Admin can widen this in Settings."
              }
            >
              {lookups ? (
                <Eye className="size-3.5" />
              ) : (
                <EyeOff className="size-3.5" />
              )}
              {lookups ? "Can look things up" : "Names only"}
            </span>

            <button
              type="submit"
              disabled={thinking || !value.trim()}
              aria-label="Send"
              className="ml-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {thinking ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {/* The keyboard half is meaningless on a phone, and wrapping it onto
              a second line costs room the composer needs more. */}
          <span className="hidden sm:inline">
            Enter sends · Shift + Enter for a new line ·{" "}
          </span>
          Nothing reaches the books until you press Save
        </p>
      </form>
    </div>
  );
}
