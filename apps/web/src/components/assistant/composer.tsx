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
  Mic,
  Paperclip,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  readNumbers,
  VoiceReadback,
} from "@/components/assistant/voice-readback";
import {
  SPEECH_LANG_LABELS,
  SPEECH_LANG_SHORT,
  useSpeechRecognition,
  type SpeechLang,
} from "@/hooks/use-speech-recognition";
import { cn } from "@/lib/utils";

/** Beyond this the box stops growing and scrolls instead. */
const MAX_HEIGHT = 200;

const OTHER_LANG: Record<SpeechLang, SpeechLang> = {
  "bn-BD": "en-US",
  "en-US": "bn-BD",
};

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

  const [lang, setLang] = useState<SpeechLang>("bn-BD");
  /** A spoken figure is waiting to be looked at. Cleared by accepting it. */
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  /** Somebody has tried to send anyway. A disabled button that says nothing
   *  reads as a broken button. */
  const [nudged, setNudged] = useState(false);
  /** What the box held before the last utterance, so it can be taken back. */
  const beforeVoice = useRef("");

  const speech = useSpeechRecognition({
    lang,
    onTranscript: (text) => {
      // Voice fills the box and stops there. It never sends, and it never
      // becomes a second way in — this is the same `onChange` typing uses, so
      // the sentence can be edited before it goes anywhere.
      beforeVoice.current = value;
      const before = value.trim();
      onChange(before ? `${before} ${text}` : text);
      setLastHeard(text);
      // `was ||` so a second sentence with no figures in it cannot lower the
      // gate the first one raised.
      setUnconfirmed((was) => was || readNumbers(text).length > 0);
      box.current?.focus();
    },
  });

  // Read back from the box rather than from the transcript, so correcting a
  // misheard figure by hand updates what is being confirmed. Delete the figure
  // and there is nothing left to confirm.
  const heard = useMemo(
    () => (unconfirmed ? readNumbers(value) : []),
    [unconfirmed, value],
  );
  const blocked = heard.length > 0;

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
    if (blocked) {
      setNudged(true);
      return;
    }
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
      if (blocked) {
        setNudged(true);
        return;
      }
      onSend();
    }
  }

  function listen() {
    if (!speech.listening) setLastHeard("");
    speech.toggle();
  }

  function accept() {
    setUnconfirmed(false);
    setLastHeard("");
    setNudged(false);
    box.current?.focus();
  }

  /**
   * Takes back the last thing that was said, and only that.
   *
   * Cutting the sentence out of where it landed rather than restoring the
   * snapshot, because anything typed after speaking is not the microphone's to
   * throw away. The snapshot is the fallback for when the transcript has been
   * edited and can no longer be found.
   */
  function undo() {
    const at = lastHeard ? value.lastIndexOf(lastHeard) : -1;
    const restored =
      at === -1
        ? beforeVoice.current
        : `${value.slice(0, at)}${value.slice(at + lastHeard.length)}`.trimEnd();

    onChange(restored);
    setUnconfirmed(readNumbers(restored).length > 0);
    setLastHeard("");
    setNudged(false);
    box.current?.focus();
  }

  const lookups = dataAccess === "full";

  // One live region, mounted whether or not there is anything in it: a region
  // that appears at the same moment as its text is not reliably announced.
  const status =
    speech.error ??
    (speech.listening
      ? speech.interim || "Listening…"
      : nudged && blocked
        ? "Confirm the figure above before this can be sent"
        : null);
  const announcement = lastHeard
    ? blocked
      ? `Heard: ${lastHeard}. Check the figures — ${heard
          .map((number) => `${number.digits}, ${number.words}`)
          .join("; ")}. Confirm before sending.`
      : `Heard: ${lastHeard}`
    : "";

  return (
    <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-4">
      <form onSubmit={submit} className="mx-auto w-full max-w-3xl">
        {/* Above the box, not inside it: the one thing on this screen that
            must not be scrolled past. */}
        <VoiceReadback numbers={heard} onAccept={accept} onUndo={undo} />

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
            onChange={(event) => {
              // Typing is the answer to "Microphone blocked" and to "Nothing
              // heard", so the message goes as soon as it is being acted on.
              if (speech.error) speech.clearError();
              onChange(event.target.value);
            }}
            onKeyDown={keyDown}
            placeholder="Type it however you would say it…"
            autoFocus
            className="block max-h-50 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
          />

          <div aria-live="polite" className="px-4">
            {status ? (
              <p className="flex items-center gap-2 pb-1 text-[13px] text-muted-foreground">
                {speech.listening && !speech.error ? (
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                ) : null}
                <span className="min-w-0 flex-1">{status}</span>
              </p>
            ) : null}
            {announcement ? (
              <span className="sr-only">{announcement}</span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5">
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

            {/* Safari, Firefox and several Android browsers have no speech
                API. There is nothing to explain and nothing to fall back to,
                so nothing is drawn — the box still takes typing. */}
            {speech.supported ? (
              <>
                <button
                  type="button"
                  onClick={listen}
                  aria-pressed={speech.listening}
                  aria-label={
                    speech.listening
                      ? "Stop listening"
                      : `Speak the entry in ${SPEECH_LANG_LABELS[lang]}`
                  }
                  title={
                    speech.listening
                      ? "Stop listening"
                      : `Speak it instead of typing (${SPEECH_LANG_LABELS[lang]})`
                  }
                  className={cn(
                    "relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    speech.listening
                      ? // The ring carries the state on its own, so reduced
                        // motion loses nothing but the movement.
                        "bg-primary/12 text-primary ring-2 ring-primary"
                      : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  <Mic className="size-4" />
                  {speech.listening ? (
                    <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                  ) : null}
                </button>

                <button
                  type="button"
                  onClick={() => setLang(OTHER_LANG[lang])}
                  disabled={speech.listening}
                  aria-label={`Speaking language: ${SPEECH_LANG_LABELS[lang]}. Press to switch to ${SPEECH_LANG_LABELS[OTHER_LANG[lang]]}.`}
                  title={`It listens in ${SPEECH_LANG_LABELS[lang]} — press for ${SPEECH_LANG_LABELS[OTHER_LANG[lang]]}. Either way, a mixed sentence comes out mixed.`}
                  className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg px-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {SPEECH_LANG_SHORT[lang]}
                </button>
              </>
            ) : null}

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
              disabled={thinking || !value.trim() || blocked}
              aria-label="Send"
              title={
                blocked ? "Check the figure above, then confirm it" : undefined
              }
              className="ml-auto inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
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
