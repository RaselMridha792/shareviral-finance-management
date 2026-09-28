"use client";

import {
  BILLING_CYCLE_LABELS,
  PAYMENT_METHOD_LABELS,
  SUBSCRIPTION_CATEGORY_LABELS,
  formatMoney,
  hasCharge,
  payableBdt,
  payableUsd,
  type BillingCycle,
  type PaymentMethod,
} from "@finance/shared";
import { ArrowCircleUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowCircleUp";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import {
  RowDetails,
  type DetailSection,
} from "@/components/ui/row-details";
import {
  subscriptionsApi,
  type SubscriptionUpgradeDto,
} from "@/lib/api-client";
import type { SubscriptionDto } from "@/lib/subscriptions";
import { formatDate } from "@/lib/utils";

import { SubscriptionStatusPill } from "./subscription-columns";

/**
 * One plan, whole — what a click on its row, or on its name, opens.
 *
 * The owner: *"ekhane click korle single page a jabena sudhu popup open hobe
 * ei table er khetreo and ager gular moto table er row te click korlei jeno
 * popup ta ase"*. The register used to send the name to `/subscriptions/[id]`;
 * this is that page's content in the popup every other table opens — the
 * money, how it is paid, who it is for, the seats, the paperwork and the note —
 * with the acts the row offers (Renew, Upgrade, Edit) at its foot.
 *
 * Everything here is already on the row the register fetched except the
 * plan's upgrades, which are read when it opens — they are history nobody
 * needs in the table.
 */
export function SubscriptionDetails({
  plan,
  onClose,
  onEdit,
  onPay,
  onUpgrade,
  onInvoice,
  onReference,
  onScreenshot,
}: {
  plan: SubscriptionDto;
  onClose: () => void;
  /** Absent for a reader. */
  onEdit?: () => void;
  /** Absent for a reader. */
  onPay?: () => void;
  /** Absent for a reader. */
  onUpgrade?: () => void;
  onInvoice: () => void;
  onReference: () => void;
  onScreenshot: () => void;
}) {
  const settings = useSettings();
  /** Null while reading; an empty list is "never upgraded". */
  const [upgrades, setUpgrades] = useState<SubscriptionUpgradeDto[] | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    subscriptionsApi
      .upgrades(plan.id)
      .then((rows) => {
        if (alive) setUpgrades(rows);
      })
      .catch(() => {
        if (alive) setUpgrades([]);
      });
    return () => {
      alive = false;
    };
  }, [plan.id]);

  const money = (value: string | null | undefined, currency: string) =>
    value ? formatMoney(value, { currency, format: settings.numberFormat }) : null;

  /** A count with an eye, or nothing — the table's two paper cells, spelled out. */
  const paper = (
    label: string | null,
    count: number,
    open: () => void,
  ) =>
    !label && count === 0 ? null : (
      <span className="inline-flex items-center gap-2">
        {label ?? `${count} attached`}
        {count > 0 ? <ViewButton onClick={open} /> : null}
      </span>
    );

  const sections: DetailSection[] = [
    {
      items: [
        { label: "Plan", value: plan.planName },
        {
          label: "Category",
          value: SUBSCRIPTION_CATEGORY_LABELS[plan.category] ?? plan.category,
        },
        { label: "Status", value: <SubscriptionStatusPill status={plan.status} /> },
        {
          label: "Website",
          value: plan.websiteUrl ? (
            <a
              href={plan.websiteUrl}
              target="_blank"
              /* A third-party address typed by whoever added the plan. */
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-extrabold text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              Open {plan.toolName ?? "the tool"}
              <ArrowSquareOutIcon weight="duotone" size={14} />
            </a>
          ) : null,
        },
      ],
    },
    {
      title: "What it costs",
      items: [
        {
          label: "Cost (USD)",
          value: plan.costUsd
            ? `${money(plan.costUsd, "USD")}${hasCharge(plan) ? ` + ${money(plan.chargeUsd, "USD")} charge` : ""}`
            : null,
        },
        {
          label: "USD rate",
          value: plan.usdRate ? Number(plan.usdRate).toFixed(2) : null,
        },
        { label: "Equivalent (BDT)", value: money(plan.costBdt, "BDT") },
        {
          label: "Total per cycle",
          value: payableUsd(plan) ? (
            <span className="inline-flex flex-col items-end">
              {money(payableUsd(plan), "USD")}
              {payableBdt(plan) ? (
                <span className="text-[12.5px] font-normal text-(--sv-muted)">
                  {money(payableBdt(plan), "BDT")}
                </span>
              ) : null}
            </span>
          ) : (
            money(payableBdt(plan), "BDT")
          ),
        },
        {
          label: "Billing cycle",
          value:
            BILLING_CYCLE_LABELS[plan.billingCycle as BillingCycle] ??
            plan.billingCycle,
        },
      ],
    },
    {
      title: "How it is paid",
      items: [
        {
          label: "Payment method",
          value: plan.paymentMethod
            ? (PAYMENT_METHOD_LABELS[plan.paymentMethod as PaymentMethod] ??
              plan.paymentMethod)
            : null,
        },
        {
          label: "Account or card",
          value: plan.accountName ? (
            plan.accountId ? (
              <Link
                href={`/accounts/${plan.accountId}`}
                className="font-extrabold text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
              >
                {plan.accountName}
              </Link>
            ) : (
              plan.accountName
            )
          ) : null,
        },
        { label: "Started", value: formatDate(plan.startDate) },
        {
          label: "Next renewal",
          value: plan.nextRenewalOn
            ? formatDate(plan.nextRenewalOn)
            : (plan.renewalNote ?? null),
        },
      ],
    },
    {
      title: "Who it is for",
      items: [
        { label: "Department", value: plan.boughtFor },
        { label: "Login accounts", value: plan.loginEmail },
        {
          /*
            The seats, with the footnote that matters most here: the price
            above is the WHOLE plan's, and a thirteen-seat plan read as one
            person's cost is the mistake a page about one tool invites.
          */
          label:
            plan.users.length > 1
              ? `Seats — ${plan.users.length} people; the price is the whole plan's`
              : "Seats",
          block: true,
          value:
            plan.users.length === 0 ? null : (
              <ul className="flex flex-col gap-1.5">
                {plan.users.map((seat) => (
                  <li
                    key={seat.teamMemberId}
                    className="flex flex-wrap items-baseline justify-between gap-x-3"
                  >
                    <Link
                      href={`/team/${seat.teamMemberId}`}
                      className="font-extrabold text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                    >
                      {seat.fullName}
                    </Link>
                    <span className="text-[12.5px] font-normal text-(--sv-muted) tabular-nums">
                      {seat.fromDate ? formatDate(seat.fromDate) : "N/A"} –{" "}
                      {seat.untilDate ? formatDate(seat.untilDate) : "now"} ·{" "}
                      {seat.status}
                    </span>
                  </li>
                ))}
              </ul>
            ),
        },
      ],
    },
    {
      title: "Paperwork",
      items: [
        { label: "Invoice", value: paper(null, plan.invoiceCount, onInvoice) },
        {
          label: "Reference",
          value: paper(plan.reference, plan.recordCount, onReference),
        },
        {
          label: "As bought",
          value: plan.screenshotFileId ? (
            <span className="inline-flex items-center gap-2">
              Screenshot
              <ViewButton onClick={onScreenshot} />
            </span>
          ) : null,
        },
      ],
    },
    /*
      What the plan was before, each time it was upgraded in place — newest
      first, with the charge the upgrade took when there was one.
    */
    ...(upgrades && upgrades.length > 0
      ? [
          {
            title: "Upgrades",
            items: upgrades.map((one) => ({
              label: formatDate(one.upgradedOn),
              block: true,
              value: (
                <span className="flex flex-col gap-0.5">
                  <span>
                    {one.fromPlanName}{" "}
                    <span className="text-(--sv-muted)">
                      ({money(one.fromCostUsd, "USD") ?? "N/A"})
                    </span>{" "}
                    → {one.toPlanName}{" "}
                    <span className="text-(--sv-muted)">
                      ({money(one.toCostUsd, "USD")})
                    </span>
                  </span>
                  <span className="text-[12.5px] font-normal text-(--sv-muted)">
                    {one.paymentRefNo
                      ? `Charged ${money(one.paymentAmount, "BDT")} for it — ${one.paymentRefNo}${one.paymentVoided ? " (voided)" : ""}`
                      : "Nothing charged on the day"}
                    {one.note ? ` · ${one.note}` : ""}
                  </span>
                </span>
              ),
            })),
          },
        ]
      : []),
    ...(plan.notes
      ? [{ items: [{ label: "Notes", value: plan.notes, block: true }] }]
      : []),
  ];

  return (
    <RowDetails
      open
      onClose={onClose}
      title={plan.toolName ?? plan.planName}
      description={`${plan.planName} · started ${formatDate(plan.startDate)}`}
      sections={sections}
      footer={
        onEdit || onPay || onUpgrade ? (
          <div className="flex flex-wrap justify-end gap-2">
            {onPay ? (
              <Button variant="secondary" onClick={onPay}>
                <ArrowsClockwiseIcon
                  weight="duotone"
                  size={17}
                  className="text-(--sv-violet)"
                />
                Renew
              </Button>
            ) : null}
            {onUpgrade ? (
              <Button variant="secondary" onClick={onUpgrade}>
                <ArrowCircleUpIcon
                  weight="duotone"
                  size={17}
                  className="text-(--sv-violet)"
                />
                Upgrade
              </Button>
            ) : null}
            {onEdit ? (
              <Button variant="secondary" onClick={onEdit}>
                <PencilSimpleIcon
                  weight="duotone"
                  size={17}
                  className="text-(--sv-violet)"
                />
                Edit
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    />
  );
}

/** The eye the table's paper cells wear, as a button in the record. */
function ViewButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 text-[13px] font-extrabold text-link transition hover:bg-(--sv-violet-tint)"
    >
      <EyeIcon weight="duotone" size={15} />
      View
    </button>
  );
}
