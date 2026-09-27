import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowDownLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowDownLeft";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { ChartPieSliceIcon } from "@phosphor-icons/react/dist/ssr/ChartPieSlice";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/ssr/FileArrowUp";
import { FileTextIcon } from "@phosphor-icons/react/dist/ssr/FileText";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { HandCoinsIcon } from "@phosphor-icons/react/dist/ssr/HandCoins";
import { InvoiceIcon } from "@phosphor-icons/react/dist/ssr/Invoice";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent";
import { ShoppingCartIcon } from "@phosphor-icons/react/dist/ssr/ShoppingCart";
import { SparkleIcon } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { TableIcon } from "@phosphor-icons/react/dist/ssr/Table";
import { TagIcon } from "@phosphor-icons/react/dist/ssr/Tag";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { WalletIcon } from "@phosphor-icons/react/dist/ssr/Wallet";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

/**
 * The card every screen opens with, as the September 2026 handoff draws it.
 *
 * A white card with a masked lime grid drifting in from the right, a lime blob,
 * a dashed violet ring and a small violet square behind the words; a 56px lime
 * tile holding the screen's icon, filled; the title at 28px/800 with its line
 * under it; the screen's own controls at the right-hand end.
 *
 * The owner saw the twenty-one screens this reaches before it changed, and
 * chose all of them at once over one screen at a time.
 *
 * THE ICON STILL ARRIVES AS A MATERIAL NAME, which is what every caller passes
 * today — `icon="account_balance"`. It is turned into the handoff's Phosphor
 * icon here, in one table, so twenty-one call sites did not have to change to
 * get the new tile. A caller rebuilt in its own session can pass the Phosphor
 * component instead. A name nobody has mapped still draws, in the old face,
 * rather than leaving an empty tile.
 */
const PHOSPHOR: Record<string, PhosphorIcon> = {
  account_balance: BankIcon,
  account_balance_wallet: WalletIcon,
  auto_awesome: SparkleIcon,
  bar_chart: ChartBarIcon,
  description: FileTextIcon,
  grid_view: ChartPieSliceIcon,
  groups: UsersThreeIcon,
  north_east: ArrowUpRightIcon,
  payments: MoneyIcon,
  percent: PercentIcon,
  receipt_long: InvoiceIcon,
  savings: HandCoinsIcon,
  sell: TagIcon,
  settings: GearSixIcon,
  shopping_basket: ShoppingCartIcon,
  south_west: ArrowDownLeftIcon,
  swap_horiz: ArrowsLeftRightIcon,
  swap_vert: ArrowsDownUpIcon,
  table_view: TableIcon,
  upload_file: FileArrowUpIcon,
};

export function PageHeader({
  title,
  icon,
  description,
  actions,
}: {
  title: string;
  /**
   * The screen's icon: a Phosphor component, or the Material name the rail used
   * to carry (mapped above).
   */
  icon?: string | PhosphorIcon;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const Glyph = typeof icon === "string" ? PHOSPHOR[icon] : icon;

  return (
    <div className="sv-page-head sv-rise relative isolate flex flex-wrap items-center gap-4 overflow-hidden rounded-[11px] bg-(--sv-surface) px-6 py-5.5">
      <div aria-hidden="true" className="sv-page-head-decor">
        <span className="grid-paper" />
        <span className="blob" />
        <span className="loop" />
        <span className="square" />
      </div>

      <div className="flex min-w-65 flex-1 items-center gap-3.5">
        {icon ? (
          <span className="sv-page-head-tile grid size-14 flex-none place-items-center rounded-[14px] bg-(--sv-accent) text-(--sv-on-accent)">
            {Glyph ? (
              <Glyph weight="fill" size={27} />
            ) : (
              <Icon name={icon as string} size={27} fill />
            )}
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.03em]">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-[14.5px] text-(--sv-muted)">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
