"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { hrRequestsApi } from "@/lib/hr-requests";

/**
 * How many of HR's money requests wait for a decision, beside HR Requests
 * in the rail (#125) — "a count of what is waiting belongs where the CFO
 * will see it without opening the page". Read again on every navigation, so
 * deciding one and moving on brings it down. Nothing is drawn at zero, and
 * a failed read draws nothing rather than a wrong number.
 */
export function WaitingBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    hrRequestsApi
      .waiting()
      .then((result) => {
        if (alive) setCount(result.waiting);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pathname]);

  if (!count) return null;
  return (
    <span
      className="num flex-none rounded-full bg-(--sv-violet) px-2 py-0.5 text-[11.5px] font-extrabold text-white"
      title={`${count} waiting for a decision`}
      data-hrr-waiting
    >
      {count}
    </span>
  );
}
