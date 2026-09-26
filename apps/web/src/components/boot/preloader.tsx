"use client";

import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { BookOpenIcon } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { FileTextIcon } from "@phosphor-icons/react/dist/ssr/FileText";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { SparkleIcon } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useScrollLock } from "@/components/ui/scroll-lock";

/**
 * The boot screen from the handoff: a trend-up arrow drawn out of the corner
 * of the lime tile as the bar fills, which then runs off the tile and is
 * replaced by a tick.
 *
 * WHAT IS REAL AND WHAT IS NOT. The bar is not a measurement — nothing in a
 * page render reports how far along it is, and a bar that pretended to would
 * be inventing a number. It climbs on a clock to 90% and waits there. What IS
 * real is the end: it only reaches 100, and the tick only appears, once
 * `arrived` says the app has actually rendered underneath. A slow server means
 * a long "Almost there", never a tick over a page that is not there.
 */

type Phase = "load" | "fill" | "hold" | "shoot" | "tick" | "leave";

/**
 * How long each step takes, in ms.
 *
 * The handoff runs its load for four seconds and its ending for three more. It
 * was drawn to be looked at; this is shown every time somebody signs in, so the
 * load is shorter — long enough for the arrow to be seen drawing — and the
 * ending keeps its shape at about two-thirds of the time. `giveUp` is for a
 * navigation that never lands: the overlay gets out of the way rather than
 * sitting over the page forever.
 */
const TIMING = {
  load: 1600,
  fill: 300,
  hold: 280,
  shoot: 640,
  tick: 700,
  leave: 600,
  giveUp: 20_000,
};

/** Somebody who has asked for less motion gets the answer and not the show. */
const REDUCED = {
  load: 0,
  fill: 0,
  hold: 0,
  shoot: 0,
  tick: 450,
  leave: 200,
  giveUp: 20_000,
};

const MESSAGES = [
  { text: "Opening the books", Icon: BookOpenIcon },
  { text: "Checking your access", Icon: ShieldCheckIcon },
  { text: "Reconciling accounts", Icon: ArrowsClockwiseIcon },
  { text: "Almost there", Icon: SparkleIcon },
] as const;

/*
 * The arrow's geometry, from the handoff, in the tile's 48-unit box.
 *
 * PATH starts outside the tile's lower-left corner, runs the trend-up zig-zag
 * to its tip, and carries on past the top-right edge — that last run is where
 * the arrow "shoots out". The tile clips it. ZIG is how much of the line is
 * visible at once, ARROW the distance to the tip, FULL the whole path.
 */
const PATH = "M-19 59 L6 34 L18 22 L26 30 L42 14 L70 -14";
const ZIG = 50.91;
const ARROW = 86.27;
const FULL = 125.87;
const TICK = 34;

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** The handoff's own curve for the exit: slow off the tip, fast off the tile. */
const shootCurve = (t: number) => t * t * (3 - 2 * t) * 0.35 + t * t * t * 0.65;

/** Fits the stack into a short window rather than cutting it off. */
const fitFor = (height: number) =>
  Math.min(1, Math.max(0.55, (height - 96) / 560));

export function Preloader({
  arrived,
  onDone,
}: {
  /** True once the page being opened has rendered underneath. */
  arrived: boolean;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<Phase>("load");
  const [shoot, setShoot] = useState(0);
  const [fit, setFit] = useState(() => fitFor(window.innerHeight));

  // Read from inside the timeline, which is started once and must not restart
  // when the prop changes.
  const arrivedRef = useRef(arrived);
  useEffect(() => {
    arrivedRef.current = arrived;
  }, [arrived]);

  useScrollLock(true);

  useEffect(() => {
    const onResize = () => setFit(fitFor(window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const time = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? REDUCED
      : TIMING;
    const start = performance.now();
    const timers: number[] = [];
    let frame = 0;

    const later = (ms: number, next: () => void) => {
      timers.push(window.setTimeout(next, ms));
    };

    const leave = () => {
      setPhase("leave");
      later(time.leave, onDone);
    };

    const tick = () => {
      setPhase("tick");
      later(time.tick, leave);
    };

    const shootOff = () => {
      if (time.shoot === 0) return tick();
      setPhase("shoot");
      const from = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - from) / time.shoot);
        setShoot(shootCurve(t));
        if (t < 1) frame = requestAnimationFrame(step);
        else tick();
      };
      frame = requestAnimationFrame(step);
    };

    const fill = (from: number) => {
      setPhase("fill");
      const began = performance.now();
      const step = (now: number) => {
        const t = time.fill === 0 ? 1 : Math.min(1, (now - began) / time.fill);
        setProgress(from + (100 - from) * t);
        if (t < 1) {
          frame = requestAnimationFrame(step);
        } else {
          setPhase("hold");
          later(time.hold, shootOff);
        }
      };
      frame = requestAnimationFrame(step);
    };

    const load = (now: number) => {
      const elapsed = now - start;
      const t = time.load === 0 ? 1 : Math.min(1, elapsed / time.load);
      const at = 90 * easeInOutCubic(t);
      setProgress(at);

      if (arrivedRef.current && elapsed >= time.load) fill(at);
      // Never arrived. No tick, no "welcome back" — just out of the way.
      else if (elapsed >= time.giveUp) leave();
      else frame = requestAnimationFrame(load);
    };

    frame = requestAnimationFrame(load);
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [onDone]);

  const done = phase === "tick" || phase === "leave";
  const index = done
    ? MESSAGES.length
    : Math.min(MESSAGES.length - 1, Math.floor(progress / 25));
  const message = done
    ? { text: "Ready — welcome back", Icon: CheckCircleIcon }
    : MESSAGES[index];

  return (
    <div className="sv sv-preloader" data-leaving={phase === "leave"}>
      <div aria-hidden="true" className="paper" />
      <div aria-hidden="true" className="light" />
      <div aria-hidden="true" className="sv-pl-decor">
        <span className="glow-lime" />
        <span className="glow-violet" />
        <span className="halo" />
        <span className="halo-dashed" />
        <span className="s1" />
        <span className="s2" />
        <span className="s3" />
        <span className="s4" />
        <span className="s5" />
        <span className="s6" />
      </div>

      <div aria-hidden="true" className="sv-pl-chips">
        <Chip Icon={MoneyIcon}>Payroll finalised</Chip>
        <Chip Icon={ArrowsLeftRightIcon}>Transfer recorded</Chip>
        <Chip Icon={FileTextIcon}>Statement · {thisMonth()}</Chip>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="relative flex flex-col items-center gap-7.5 p-6"
        style={{ transform: `scale(${fit.toFixed(3)})` }}
      >
        <div className="relative grid size-75 place-items-center">
          <div aria-hidden="true" className="sv-pl-orbit-a" />
          <div aria-hidden="true" className="sv-pl-orbit-b" />
          <div aria-hidden="true" className="sv-pl-tile">
            <div className="sv-pl-shine" />
            <Mark progress={progress} phase={phase} shoot={shoot} />
          </div>
        </div>

        <div className="flex w-[min(320px,82vw)] flex-col items-center gap-4">
          <p className="flex items-baseline gap-2">
            <span className="text-[32px] font-extrabold tracking-tight">
              ShareViral
            </span>
            <span className="text-[13px] font-extrabold tracking-[0.2em] text-(--sv-violet) uppercase">
              Finance
            </span>
          </p>

          <p
            // A new key replays the entrance for each new line.
            key={message.text}
            className={`sv-pl-status flex min-h-6 items-center gap-2.25 text-[15px] font-extrabold ${
              done ? "text-(--sv-violet-ink)" : "text-(--sv-ink)"
            }`}
          >
            <span
              className={`sv-pl-status-icon grid size-6.5 place-items-center rounded-full ${
                done
                  ? "bg-(--sv-violet) text-white"
                  : "bg-(--sv-surface) text-(--sv-violet)"
              }`}
            >
              <message.Icon weight="duotone" size={15} />
            </span>
            {message.text}
            {done ? "" : "…"}
          </p>

          <div aria-hidden="true" className="flex w-full items-center gap-3">
            <div className="sv-pl-track h-2.5 flex-1 overflow-hidden rounded-full bg-(--sv-surface)">
              <div
                className="sv-pl-fill relative h-full rounded-full"
                style={{ width: `${progress.toFixed(1)}%` }}
              >
                <span className="sv-pl-knob absolute top-1/2 -right-px -mt-1.5 size-3 rounded-full bg-(--sv-accent)" />
              </div>
            </div>
            <span className="w-11 flex-none text-right text-[14px] font-extrabold text-(--sv-violet-ink) tabular-nums">
              {Math.round(progress)}%
            </span>
          </div>

          <div aria-hidden="true" className="flex gap-2">
            {MESSAGES.map((_, step) => (
              <span
                key={step}
                className={`sv-pl-step h-1.5 rounded-full ${
                  step === index ? "w-6.5" : "w-2"
                } ${done || step <= index ? "bg-(--sv-violet)" : "bg-(--sv-ring)"}`}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="absolute inset-x-0 bottom-5.5 flex items-center justify-center gap-2 text-[12px] text-(--sv-violet-ink)">
        <LockSimpleIcon weight="duotone" size={15} />
        Secure connection · ShareViral Finance
      </p>
    </div>
  );
}

/**
 * The arrow, then the tick.
 *
 * The line is one path whose visible stretch — ZIG long — slides along it by
 * dash offset, and the head is a chevron riding the same path with
 * `offset-path`, turned to face along it. Drawing and shooting are the same
 * picture at two distances.
 */
function Mark({
  progress,
  phase,
  shoot,
}: {
  progress: number;
  phase: Phase;
  shoot: number;
}) {
  const ticked = phase === "tick" || phase === "leave";
  const shooting = phase === "shoot";
  const head = shooting
    ? ARROW + (FULL + ZIG - ARROW) * shoot
    : ARROW * (progress / 100);

  return (
    <svg
      width={55}
      height={55}
      viewBox="0 0 48 48"
      fill="none"
      className={`relative overflow-visible ${ticked ? "sv-pl-pop" : ""}`}
    >
      {(progress >= 3 || shooting) && !ticked ? (
        <path
          d={PATH}
          stroke="var(--sv-ink)"
          strokeWidth={3.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: `${ZIG} 400`,
            strokeDashoffset: ZIG - head,
          }}
        />
      ) : null}
      <g
        style={{
          offsetPath: `path('${PATH}')`,
          offsetRotate: "auto",
          offsetDistance: `${Math.max(0.01, Math.min(head, FULL))}px`,
          opacity: (progress < 3 && !shooting) || ticked ? 0 : 1,
        }}
      >
        <polyline
          points="-4.6,-4.6 0,0 -4.6,4.6"
          stroke="var(--sv-ink)"
          strokeWidth={3.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
      {ticked ? (
        <path
          d="M13 25 L20.5 32 L35 17"
          stroke="var(--sv-ink)"
          strokeWidth={4.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="sv-pl-draw"
          style={{ strokeDasharray: `${TICK} ${TICK}` }}
        />
      ) : null}
    </svg>
  );
}

function Chip({
  Icon,
  children,
}: {
  Icon: typeof MoneyIcon;
  children: ReactNode;
}) {
  return (
    <span className="sv-pl-chip">
      <span className="grid size-7 place-items-center rounded-full bg-(--sv-accent) text-(--sv-on-accent)">
        <Icon weight="duotone" size={16} />
      </span>
      {children}
    </span>
  );
}

/** "Sep 2026", in Dhaka — a UTC clock names the wrong month for six hours. */
function thisMonth() {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dhaka",
  }).format(new Date());
}
