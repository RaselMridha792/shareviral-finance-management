"use client";

import type { PendingItem } from "@finance/shared";
import { CircleCheck } from "lucide-react";
import Link from "next/link";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Statutory deadlines, closest first.
 *
 * The only card on the overview about something that has not happened yet, and
 * the only one where being wrong costs a penalty rather than a correction —
 * which is why overdue is red and unmissable rather than a tidy grey list.
 */
export function PendingCard({ items }: { items: PendingItem[] }) {
  const overdue = items.filter((item) => item.status === "overdue").length;

  return (
    <Card>
      <CardHeader
        title="Waiting on you"
        description={
          items.length === 0
            ? "Nothing is due"
            : overdue > 0
              ? `${overdue} past the deadline`
              : "Nothing overdue — these are coming up"
        }
      />
      <CardBody className="flex flex-col gap-1">
        {items.length === 0 ? (
          <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <CircleCheck className="size-6 text-positive" />
            Every return and deposit is up to date.
          </p>
        ) : (
          items.map((item) => (
            <Link
              key={`${item.kind}-${item.dueOn}-${item.title}`}
              href={item.href}
              className="row-finance flex items-center gap-3 rounded-lg px-2 transition hover:bg-surface-muted"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  item.status === "overdue"
                    ? "bg-negative"
                    : item.status === "due_soon"
                      ? "bg-warning"
                      : "bg-border",
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.detail}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={cn(
                    "num block text-xs font-medium",
                    item.status === "overdue"
                      ? "text-negative"
                      : "text-muted-foreground",
                  )}
                >
                  {item.status === "overdue" ? "was due " : "due "}
                  {item.dueOn}
                </span>
              </span>
            </Link>
          ))
        )}
      </CardBody>
    </Card>
  );
}
