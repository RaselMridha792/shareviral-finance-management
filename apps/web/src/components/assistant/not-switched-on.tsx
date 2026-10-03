import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * What the Assistant says when there is nothing to talk to: no key, or not
 * this person's role.
 *
 * The handoff's card: a violet and a lime circle behind, the lime robot tile,
 * and the way to switch it on in violet. `compact` is the floating window's
 * (B4), which has no room for the circles or the padding.
 */
export function NotSwitchedOn({
  reason,
  canConfigure,
  compact = false,
}: {
  reason: string | null;
  canConfigure: boolean;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        "sv-rise relative flex w-full flex-col items-center gap-3 overflow-hidden text-center",
        compact ? "px-5 py-8" : "max-w-[480px] px-8 py-10",
      )}
    >
      {compact ? null : (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-15 -right-15 size-45 rounded-full bg-(--sv-violet-tint)"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-15 -left-10 size-35 rounded-full bg-(--sv-lime-tint)"
          />
        </>
      )}
      <span className="relative grid size-18 place-items-center rounded-[20px] bg-(--sv-accent) text-(--sv-on-accent) shadow-[0_10px_22px_rgb(150_200_0/0.3)]">
        <RobotIcon weight="duotone" size={38} />
      </span>
      <p className="relative text-[22px] font-extrabold">Not switched on</p>
      <p className="relative text-[14px] leading-[1.55] text-(--sv-muted)">
        {reason}
      </p>
      {canConfigure ? (
        <Link
          href="/assistant/settings"
          className="relative mt-1 inline-flex h-[42px] items-center gap-[7px] rounded-lg bg-(--sv-violet) px-4 text-[14px] font-extrabold text-white transition hover:-translate-y-px"
        >
          Add a key
          <ArrowRightIcon weight="duotone" size={16} />
        </Link>
      ) : null}
    </Card>
  );
}
