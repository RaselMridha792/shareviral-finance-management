import type { PendingItem } from "@finance/shared";
import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";

import { PendingCard } from "@/components/dashboard/pending-card";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

/**
 * What HR sees when they sign in.
 *
 * A separate screen rather than the overview with its figures blanked out. An
 * empty tile invites the question "why is this zero"; a page that never asked
 * for the figure has nothing to explain, and the boundary stays a fact about
 * the request rather than a rule about the rendering.
 */
export function HrDashboard({
  firstName,
  pending,
}: {
  firstName: string;
  pending: PendingItem[];
}) {
  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Your work lives under Team."
      />

      <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
          <Users className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold">
            The company&apos;s figures are not on this account
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Balances, payroll and pay are held elsewhere. Everything you do need
            is in the sidebar.
          </p>
        </div>
        <Link
          href="/team"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Go to Team
          <ArrowRight className="size-3.5" />
        </Link>
      </Card>

      {pending.length ? <PendingCard items={pending} /> : null}
    </>
  );
}
