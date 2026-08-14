import { Lock } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = { title: "Not available to your role · SFM" };

/**
 * What a permission boundary should look like.
 *
 * Reaching a page your role cannot read used to surface the API's 403 as an
 * unhandled render error — "This page couldn't load, a server error occurred",
 * with an error id. That is what a fault looks like, and it sent people
 * looking for a problem that did not exist. Thirteen routes did it to HR,
 * including one its own sidebar linked to.
 *
 * The refusal itself is the API's and has not moved; this only gives it a face.
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const from = typeof params.from === "string" ? params.from : null;
  const needs = typeof params.needs === "string" ? params.needs : null;
  // The permission's own name, tidied. There is no label table for these and
  // inventing one here would be a second place for the wording to drift.
  const label = needs ? needs.replace(/\./g, " · ") : null;

  return (
    <Card className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
        <Lock className="size-5" />
      </span>

      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          That page is not part of your role
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {from ? (
            <>
              <span className="num">{from}</span> needs{" "}
              {label ? (
                <span className="font-medium text-foreground">{label}</span>
              ) : (
                "a permission this account does not hold"
              )}
              . Nothing is wrong — the page simply is not yours to open.
            </>
          ) : (
            "This page needs a permission this account does not hold."
          )}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          If you need it, a Super Admin can change what your role may see.
        </p>
      </div>

      <Link
        href="/"
        className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        Back to the dashboard
      </Link>
    </Card>
  );
}
