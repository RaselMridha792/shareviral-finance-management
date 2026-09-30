"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { ApiError } from "@/lib/api-client";

export type Blocked = {
  message: string;
  lines: { text: string; href: string | null }[];
};

/**
 * Whether an error is the salary sheet being held up by HR's requests
 * (#125) — the API sends the people by name in `errors.hrRequests`, and each
 * one's own row in `errors.hrRequestLinks`, in the same order.
 */
export function blockedBy(caught: unknown): Blocked | null {
  if (!(caught instanceof ApiError) || caught.status !== 409) return null;
  const lines = caught.fieldErrors?.hrRequests;
  if (!lines?.length) return null;
  const links = caught.fieldErrors?.hrRequestLinks ?? [];
  return {
    message: caught.message,
    lines: lines.map((text, index) => ({ text, href: links[index] ?? null })),
  };
}

/**
 * The pop-up the owner asked for, word for word: *"se jokhon payroll build
 * korte jabe tokhoni take ekta popup a warning dibe je tumi eta korte
 * parbana karon omuk employee er to salary barche or bonus paiche age tarta
 * aprove koro r nahoy reject koro"*. It names each person and what waits for
 * them, and each line opens that request, where it is approved or rejected.
 */
export function BlockedDialog({
  blocked,
  onClose,
}: {
  blocked: Blocked;
  onClose: () => void;
}) {
  return (
    <Drawer
      open
      onClose={onClose}
      title="HR's requests come first"
      description={blocked.message}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Link
            href="/hr-requests"
            className="sv-button inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-[18px] text-[14px] font-extrabold text-primary-foreground"
            data-blocked-open-all
          >
            Open HR Requests
          </Link>
        </>
      }
    >
      <BlockedList blocked={blocked} />
    </Drawer>
  );
}

/** Each person and what waits for them, each opening its own request. */
export function BlockedList({ blocked }: { blocked: Blocked }) {
  return (
    <ul className="flex flex-col gap-2" data-blocked-list>
      {blocked.lines.map((line) => (
        <li
          key={line.text}
          className="flex items-start gap-2.5 rounded-[11px] bg-(--sv-warn-tint) px-3.5 py-2.5 text-[13.5px]"
        >
          <WarningCircleIcon
            weight="duotone"
            size={19}
            className="mt-px flex-none text-(--sv-warn)"
          />
          <span className="min-w-0 flex-1">{line.text}</span>
          {line.href ? (
            <Link
              href={line.href}
              className="flex-none font-extrabold text-(--link) underline"
            >
              Decide
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
