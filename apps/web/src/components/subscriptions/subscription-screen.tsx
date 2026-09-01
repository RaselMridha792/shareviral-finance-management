"use client";

import {
  BILLING_CYCLE_LABELS,
  PAYMENT_METHOD_LABELS,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatMoney,
  type BillingCycle,
  type PaymentMethod,
} from "@finance/shared";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";

import { useNameThisPage } from "@/components/layout/breadcrumb";
import { useSettings } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { SubscriptionDto } from "@/lib/subscriptions";

/**
 * One plan, whole.
 *
 * The register used to carry seventeen columns and the owner reads eleven of
 * them — *"baki gula single page a jabe"*. This is that page: the six that left
 * the table, plus everything a plan holds that a table was never going to show
 * well, like the seats and the note.
 *
 * Read-only on purpose. Editing is the drawer the register already opens, and
 * a second form here would be a second place for the same fields to disagree.
 */
export function SubscriptionScreen({ plan }: { plan: SubscriptionDto }) {
  // The rail knows the ancestors; only this page knows the record.
  useNameThisPage(plan.toolName ?? plan.planName);
  const settings = useSettings();

  const money = (value: string | null, currency: string) =>
    value
      ? formatMoney(value, { currency, format: settings.numberFormat })
      : "N/A";

  return (
    <>
      <Link
        href="/subscriptions"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All subscriptions
      </Link>

      <PageHeader
        title={plan.toolName ?? plan.planName}
        description={
          plan.toolName && plan.planName !== plan.toolName
            ? `${plan.planName} · ${SUBSCRIPTION_CATEGORY_LABELS[plan.category]}`
            : SUBSCRIPTION_CATEGORY_LABELS[plan.category]
        }
        actions={
          plan.websiteUrl ? (
            <a
              href={plan.websiteUrl}
              target="_blank"
              /* A third-party address typed by whoever added the plan. */
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-sm text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              <ExternalLink className="size-3.5" />
              Open {plan.toolName ?? "the tool"}
            </a>
          ) : null
        }
      />

      {/*
        The money, which is the reason this page exists.

        Three figures that have to agree: the dollar price, the rate, and the
        taka they come to. They are shown together for the same reason the form
        derives one from the other two — the Cash In sheet already contains a
        row where all three were typed and one of them is wrong by ৳27,612,
        with nothing in the file to say which.
      */}
      <Card>
        <CardHeader title="What it costs" />
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Figure label="Cost (USD)" value={money(plan.costUsd, "USD")} />
            <Figure
              label="USD rate"
              value={plan.usdRate ? Number(plan.usdRate).toFixed(2) : "N/A"}
            />
            <Figure
              label="Equivalent (BDT)"
              value={money(plan.costBdt, "BDT")}
            />
            <Figure
              label="Billing cycle"
              value={
                BILLING_CYCLE_LABELS[plan.billingCycle as BillingCycle] ??
                plan.billingCycle
              }
            />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How it is paid" />
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Figure
              label="Payment method"
              value={
                PAYMENT_METHOD_LABELS[plan.paymentMethod as PaymentMethod] ??
                plan.paymentMethod
              }
            />
            <Figure
              label="Account or card"
              value={
                plan.accountName ? (
                  plan.accountId ? (
                    <Link
                      href={`/accounts/${plan.accountId}`}
                      className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                    >
                      {plan.accountName}
                    </Link>
                  ) : (
                    plan.accountName
                  )
                ) : (
                  "N/A"
                )
              }
            />
            <Figure label="Started" value={formatDate(plan.startDate)} />
            <Figure
              label="Renews"
              value={
                plan.nextRenewalOn ? formatDate(plan.nextRenewalOn) : "N/A"
              }
            />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who it is for" />
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Figure
              label="Status"
              value={
                <Badge
                  tone={plan.status === "active" ? "positive" : "neutral"}
                >
                  {SUBSCRIPTION_STATUS_LABELS[plan.status]}
                </Badge>
              }
            />
            <Figure label="Department" value={plan.boughtFor ?? "N/A"} />
            <Figure
              label="Login accounts"
              value={plan.loginEmail ?? "N/A"}
              wide
            />
          </dl>

          {/*
            The note, given room.

            It was a table cell truncated at sixteen characters, which is the
            one shape a note cannot survive — the whole value of writing one
            down is the sentence nobody would otherwise remember.
          */}
          {plan.notes ? (
            <div className="mt-5 border-t border-border pt-4">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Notes
              </dt>
              <dd className="cell-prose mt-1 text-sm whitespace-pre-wrap">
                {plan.notes}
              </dd>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/*
        The seats, and the footnote that matters more here than anywhere.

        The price above is the WHOLE PLAN'S. Four money figures on a page about
        one tool is exactly where somebody reads a thirteen-seat plan's price as
        what one person costs.
      */}
      <Card>
        <CardHeader
          title="Seats"
          description={
            plan.users.length
              ? `${plan.users.length} ${plan.users.length === 1 ? "person" : "people"} on this plan — the price above is the whole plan's, not each`
              : "Nobody is recorded on this plan"
          }
        />
        <CardBody className="p-0">
          {plan.users.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No seats recorded.
            </p>
          ) : (
            <TableScroll>
              <table className="table-data min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left">
                    <SerialHead />
                    <Th>Name</Th>
                    <Th width="w-32">From</Th>
                    <Th width="w-32">Until</Th>
                    <Th width="w-28">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {plan.users.map((seat, index) => (
                    <tr key={seat.teamMemberId} className="row-finance">
                      <SerialCell n={index + 1} />
                      <td>
                        <Link
                          href={`/team/${seat.teamMemberId}`}
                          className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                        >
                          {seat.fullName}
                        </Link>
                      </td>
                      <td className="num text-muted-foreground">
                        {seat.fromDate ? formatDate(seat.fromDate) : "N/A"}
                      </td>
                      <td className="num text-muted-foreground">
                        {seat.untilDate ? formatDate(seat.untilDate) : "N/A"}
                      </td>
                      <td>
                        <Badge
                          tone={seat.status === "active" ? "positive" : "neutral"}
                        >
                          {seat.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </CardBody>
      </Card>
    </>
  );
}

/** One labelled figure. A `<dl>` because that is what these are. */
function Figure({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
