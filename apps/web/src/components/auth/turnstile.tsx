"use client";

import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr/CircleNotch";
import { CloudCheckIcon } from "@phosphor-icons/react/dist/ssr/CloudCheck";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

/** The parts of Cloudflare's script this page uses. */
type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __sfmTurnstileReady?: () => void;
  }
}

/**
 * From Cloudflare, never a copy: their script changes under them and is not
 * to be cached or bundled. Explicit render, so the widget is drawn when this
 * component asks and removed when it goes.
 */
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__sfmTurnstileReady";

let loading: Promise<TurnstileApi> | null = null;

/** Once per page, however often the form mounts. A failed load may be tried again. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    window.__sfmTurnstileReady = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile loaded without its API"));
    };
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Turnstile's script did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

type Status = "verifying" | "verified" | "failed";

/** What the form can ask of the check. */
export type TurnstileHandle = {
  /**
   * A token is good once, so after a refused sign-in the next attempt needs a
   * new one. Without this the second try sends a spent token and the right
   * password is refused, which reads as "my password stopped working".
   */
  reset(): void;
  /**
   * Cloudflare is still working: no token yet, and no failure either. Only
   * then does Sign in wait. A check that failed sends no token and lets the
   * server decide, so taking the secret off — the way out of a Cloudflare
   * outage — lets people in even while this box says it could not verify.
   */
  pending(): boolean;
};

/**
 * Cloudflare Turnstile, in the box the September handoff draws between the
 * password and Sign in, at the handoff's size.
 *
 * The box says only what Cloudflare has said: "verified" means its callback
 * handed over a token, not a timer (#79 left the box out because the
 * handoff's prototype ticked itself after 1.4 s). Cloudflare's own widget is
 * a fixed 65px frame and cannot be the handoff's size, so it runs as
 * "interaction-only": invisible while Cloudflare is satisfied by itself, and
 * shown in the box's place only when it wants a click.
 *
 * Rendered only when the server has a site key (app/login/page.tsx). The
 * token goes up through `onToken`; null whenever there is no usable one.
 */
export function Turnstile({
  siteKey,
  onToken,
  ref,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("verifying");
  /** Cloudflare wants a click: its frame is showing, so the box stands aside. */
  const [asking, setAsking] = useState(false);
  /** Kept current without re-rendering the widget when the parent re-renders. */
  const report = useRef(onToken);
  useEffect(() => {
    report.current = onToken;
  });
  /** The status, readable from the handle without re-creating it. */
  const latest = useRef<Status>(status);
  useEffect(() => {
    latest.current = status;
  }, [status]);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        report.current(null);
        setStatus("verifying");
        if (widget.current && window.turnstile) {
          window.turnstile.reset(widget.current);
        }
      },
      pending() {
        return latest.current === "verifying";
      },
    }),
    [],
  );

  useEffect(() => {
    let gone = false;

    loadTurnstile()
      .then((turnstile) => {
        if (gone || !container.current) return;
        widget.current = turnstile.render(container.current, {
          sitekey: siteKey,
          action: "login",
          theme: "light",
          size: "flexible",
          appearance: "interaction-only",
          callback: (token: string) => {
            setAsking(false);
            setStatus("verified");
            report.current(token);
          },
          "expired-callback": () => {
            // Cloudflare renews it by itself; until then there is none.
            setStatus("verifying");
            report.current(null);
          },
          "timeout-callback": () => {
            setStatus("verifying");
            report.current(null);
          },
          "error-callback": () => {
            setAsking(false);
            setStatus("failed");
            report.current(null);
            // Handled: Cloudflare goes on retrying without throwing.
            return true;
          },
          "before-interactive-callback": () => setAsking(true),
          "after-interactive-callback": () => setAsking(false),
        });
      })
      .catch(() => {
        if (!gone) setStatus("failed");
      });

    return () => {
      gone = true;
      if (widget.current && window.turnstile) {
        window.turnstile.remove(widget.current);
      }
      widget.current = null;
    };
  }, [siteKey]);

  return (
    <div>
      {asking ? null : <StatusBox status={status} />}
      {/* Takes no room unless Cloudflare shows its frame. */}
      <div ref={container} />
    </div>
  );
}

const LINES: Record<Status, string> = {
  verifying: "Verifying you are human…",
  verified: "Success — you are verified",
  failed: "Couldn't verify. Reload the page to try again.",
};

function StatusBox({ status }: { status: Status }) {
  return (
    <div
      role="status"
      // Inline, because globals.css's unlayered `* { border-color }` beats
      // every Tailwind border-colour utility (#79).
      style={{ border: "1.5px solid var(--sv-line)" }}
      className="flex h-[clamp(42px,6vh,52px)] items-center gap-2.75 rounded-[11px] bg-(--sv-surface) px-3"
    >
      <span
        className={`grid size-6.5 flex-none place-items-center rounded-full ${
          status === "verified"
            ? "bg-(--sv-violet) text-white"
            : "bg-(--sv-violet-tint) text-(--sv-violet)"
        }`}
      >
        {status === "verified" ? (
          <CheckIcon weight="duotone" size={15} />
        ) : status === "failed" ? (
          <WarningIcon weight="duotone" size={15} />
        ) : (
          <CircleNotchIcon weight="duotone" size={16} className="sv-spin" />
        )}
      </span>
      <div className="min-w-0 flex-1 leading-[1.2]">
        <div className="text-[13.5px] font-extrabold">{LINES[status]}</div>
        <div className="text-[11px] text-(--sv-muted)">
          Protected by Cloudflare Turnstile
        </div>
      </div>
      <CloudCheckIcon
        weight="duotone"
        size={22}
        className="flex-none text-(--sv-placeholder)"
      />
    </div>
  );
}
