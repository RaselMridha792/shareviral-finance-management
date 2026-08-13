"use client";

import {
  PSR_STATUS_LABELS,
  VENDOR_TYPE_LABELS,
  type Paginated,
} from "@finance/shared";
import { Plus, Search, SquarePen, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { vendorsApi, type VendorDto } from "@/lib/masters";
import { cn } from "@/lib/utils";
import { VendorForm } from "./vendor-form";

export function VendorsScreen({
  initialPage,
}: {
  initialPage: Paginated<VendorDto>;
}) {
  const router = useRouter();
  const canWrite = useCan("vendors.write");

  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VendorDto | null>(null);

  async function refresh(q = query) {
    setPage(
      await vendorsApi.list({
        pageSize: 50,
        includeInactive: true,
        q: q || undefined,
      }),
    );
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Everyone money is paid to or received from."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              Add vendor
            </Button>
          ) : null
        }
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void refresh();
        }}
        className="relative flex max-w-sm items-center"
      >
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <label className="sr-only" htmlFor="vendor-search">
          Search vendors
        </label>
        <input
          id="vendor-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, contact, phone, or e-TIN"
          className={cn(controlClass, "pl-9")}
        />
      </form>

      {page.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Store className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              {query ? "Nothing matched that search" : "No vendors yet"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {query
                ? "Try a shorter search, or add them as a new vendor."
                : "Add them here, or type a new name while recording a payment and it will be added for you."}
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-left">
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>e-TIN</Th>
                  <Th>BIN</Th>
                  <Th>Return filed</Th>
                  <Th>Contact</Th>
                  <Th className="text-right">{canWrite ? "" : null}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.items.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className={cn(
                      "row-finance hover:bg-surface-muted/50",
                      !vendor.isActive && "opacity-55",
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{vendor.name}</span>
                      {!vendor.isActive ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          inactive
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {VENDOR_TYPE_LABELS[vendor.type]}
                    </td>
                    <td className="num px-4 py-2.5 text-muted-foreground">
                      {vendor.etin ?? "—"}
                    </td>
                    <td className="num px-4 py-2.5 text-muted-foreground">
                      {vendor.bin ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <PsrBadge status={vendor.psrStatus} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {vendor.phone ?? vendor.contactName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canWrite ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(vendor)}
                        >
                          <SquarePen className="size-3.5" />
                          Edit
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <VendorForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => refresh()}
      />
      <VendorForm
        key={editing?.id}
        open={Boolean(editing)}
        vendor={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={() => refresh()}
      />
    </>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * Missing PSR raises the TDS rate by 50%, so an unchecked vendor is worth
 * flagging rather than showing as neutral.
 */
function PsrBadge({ status }: { status: VendorDto["psrStatus"] }) {
  const tone =
    status === "submitted"
      ? "positive"
      : status === "not_submitted"
        ? "negative"
        : "warning";
  return <Badge tone={tone}>{PSR_STATUS_LABELS[status]}</Badge>;
}
