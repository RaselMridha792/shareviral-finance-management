"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { logout } from "@/lib/api-client";

/**
 * Signs somebody out when the screen has been left alone.
 *
 * The threat is mundane and the most likely one this application will ever
 * meet: a laptop open on a desk, in a shared office, showing what everybody is
 * paid. No password is stolen and nothing is hacked — somebody simply sits
 * down. Every other guard in this app is aimed at a stranger on the internet,
 * and none of them look at that chair.
 *
 * Worth being plain about what this is not. It is enforced in the browser, so
 * it protects an unattended screen and nothing else; somebody holding the
 * cookie can still call the API directly, and that is fine, because the person
 * who walked past a desk is not doing that. The session's own lifetime is what
 * bounds a stolen cookie, and it is a separate control.
 *
 * Three things make it behave under real conditions rather than only in a
 * demo, and each is a bug in the obvious implementation:
 *
 *  1. **A timestamp, not a timer.** `setTimeout(an hour)` does not survive a
 *     closed lid. Browsers throttle and suspend background timers, so a laptop
 *     shut at 6pm and opened at 9am the next morning fires the timeout an
 *     hour *later* — the screen sits signed in for the entire commute. This
 *     compares clock readings instead, so waking after a night is already past
 *     the limit and signs out at once.
 *  2. **Shared between tabs.** The last activity goes to localStorage and every
 *     tab reads it, so working in one does not sign you out of another. It also
 *     means the warning appears everywhere at once, which is what somebody with
 *     three tabs open expects.
 *  3. **The warning is dismissed by a click, not by movement.** Once the
 *     countdown is up, a mouse passing over the dialog does not count as being
 *     there — otherwise a knocked desk, a cat, or a drifting trackpad keeps a
 *     finance system signed in all night.
 */

/**
 * Two hours of nothing — and nothing is the operative word.
 *
 * It was twenty minutes, then an hour, and now the owner's rule: the session
 * does not end while somebody is working, and two hours of no work sends them
 * back to the sign-in page. So this clock is not a session length. Every
 * deliberate action below resets it, which means a person who is using the app
 * is never signed out however long the day runs — the seven-day refresh token
 * behind it is what makes that true rather than this number.
 *
 * What it still catches is the thing it was built for: a laptop open on a desk
 * in a shared office, showing what everybody is paid, with nobody near it.
 */
const IDLE_MS = 120 * 60_000;

/** The last minute of it, spent asking. */
const WARN_MS = 60_000;

/**
 * How often the clock is read. Not how accurate the timeout is — the timestamp
 * decides that — only how soon after the limit the dialog appears.
 */
const TICK_MS = 5_000;

/** Writes are throttled to this, so typing does not hammer localStorage. */
const RECORD_EVERY_MS = 10_000;

const KEY = "sfm.last-activity.v1";

/**
 * What counts as being there.
 *
 * Deliberate actions only — a click, a key, a scroll, a touch, the tab being
 * focused. Mouse *movement* is left out on purpose: a knocked desk or a
 * drifting trackpad would hold a finance system open all night, which is the
 * one case this guard exists for.
 */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "focus",
] as const;

function readLastActivity(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value = raw ? Number(raw) : Number.NaN;
    // A missing or unreadable value means "now" rather than "forever ago".
    // Signing somebody out because localStorage was cleared would be a bug
    // that only ever shows up as a mysterious logout.
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

function writeLastActivity(at: number) {
  try {
    window.localStorage.setItem(KEY, String(at));
  } catch {
    // Private browsing, a full quota, a locked-down profile. The timeout stops
    // being shared between tabs and still works within one.
  }
}

export function IdleTimeout() {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  /** Guards against two ticks both deciding to sign out. */
  const signingOut = useRef(false);
  /** Set while the dialog is up, so movement underneath it does not count. */
  const warning = useRef(false);
  const lastWrite = useRef(0);

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      await logout();
    } finally {
      // The reason travels in the URL so the sign-in page can say why, rather
      // than leaving somebody to wonder whether something broke.
      router.replace("/login?reason=idle");
      router.refresh();
    }
  }, [router]);

  const stay = useCallback(() => {
    warning.current = false;
    setSecondsLeft(null);
    const now = Date.now();
    lastWrite.current = now;
    writeLastActivity(now);
  }, []);

  useEffect(() => {
    writeLastActivity(Date.now());

    const record = () => {
      // Deliberately inert while the dialog is up. See the note above.
      if (warning.current || signingOut.current) return;
      const now = Date.now();
      if (now - lastWrite.current < RECORD_EVERY_MS) return;
      lastWrite.current = now;
      writeLastActivity(now);
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, record, { passive: true });
    }

    const tick = () => {
      if (signingOut.current) return;

      const idleFor = Date.now() - readLastActivity();

      if (idleFor >= IDLE_MS) {
        void signOut();
        return;
      }

      if (idleFor >= IDLE_MS - WARN_MS) {
        warning.current = true;
        setSecondsLeft(Math.max(0, Math.ceil((IDLE_MS - idleFor) / 1000)));
      } else if (warning.current) {
        // Another tab was used, so the countdown is off everywhere.
        warning.current = false;
        setSecondsLeft(null);
      }
    };

    // A second interval during the countdown, so the number moves once a
    // second instead of in five-second jumps.
    const slow = window.setInterval(tick, TICK_MS);
    const fast = window.setInterval(() => {
      if (warning.current) tick();
    }, 1000);

    // Coming back to a tab is the moment a suspended timer is most likely to
    // have lied, so the clock is read immediately rather than at the next tick.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, record);
      }
      window.clearInterval(slow);
      window.clearInterval(fast);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signOut]);

  if (secondsLeft === null) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      aria-describedby="idle-body"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 id="idle-title" className="text-base font-semibold tracking-tight">
          Still there?
        </h2>
        <p id="idle-body" className="mt-2 text-sm text-muted-foreground">
          This screen has been idle, so it is about to sign out —{" "}
          <span className="num font-medium text-foreground">
            {secondsLeft}s
          </span>
          . Anything you have typed and not saved will be lost.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" className="flex-1" autoFocus onClick={stay}>
            Stay signed in
          </Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
