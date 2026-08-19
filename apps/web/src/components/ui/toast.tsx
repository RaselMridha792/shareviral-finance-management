"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; message: string };

/**
 * A short line, in the corner, after something happened.
 *
 * The gap this fills is specific. Until now a failure showed a red line and a
 * *success* showed nothing at all: the drawer closed and the row appeared, and
 * on a slow connection neither had happened yet. In an app about money, a save
 * that looks like it did nothing is a save somebody makes twice — and two
 * identical entries an hour apart are far harder to notice than one wrong one.
 *
 * Deliberately not a library. This is a list, a timer and a fixed container.
 */
const ToastContext = createContext<{
  show: (message: string, tone?: Tone) => void;
} | null>(null);

const LIFETIME_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Ids from a counter rather than the clock: two toasts raised in the same
  // millisecond would share a key and React would treat them as one.
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: Tone = "success") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      // Errors stay longer: they are usually a sentence rather than a word,
      // and they are the ones worth reading twice.
      setTimeout(
        () => dismiss(id),
        tone === "error" ? LIFETIME_MS * 2 : LIFETIME_MS,
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/*
        `polite`, not `assertive`: these announce something that already
        succeeded, and interrupting a screen reader mid-sentence to say "saved"
        is worse than waiting for the pause.
      */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg",
              toast.tone === "success" &&
                "border-positive/30 bg-surface text-foreground",
              toast.tone === "error" &&
                "border-negative/40 bg-surface text-foreground",
              toast.tone === "info" &&
                "border-border bg-surface text-foreground",
            )}
          >
            {toast.tone === "success" ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-positive" />
            ) : toast.tone === "error" ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-negative" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}

            <p className="min-w-0 flex-1">{toast.message}</p>

            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-mr-1 rounded p-0.5 text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * `show("Saved")`, `show("Could not save", "error")`.
 *
 * Returns a no-op outside the provider rather than throwing. A missing toast
 * is a missing sentence; a component that crashes because nobody wrapped it is
 * a blank screen, and the trade between those is not close.
 */
export function useToast() {
  const context = useContext(ToastContext);
  return context ?? { show: () => undefined };
}
