import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";
import { ArrowDownLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowDownLeft";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr/Buildings";
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
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { WalletIcon } from "@phosphor-icons/react/dist/ssr/Wallet";

import { Icon } from "@/components/ui/icon";

/**
 * The screens' icons, in the September 2026 handoff's face.
 *
 * Callers still pass the Material name they always passed — `icon="groups"` —
 * and it is turned into the handoff's Phosphor icon here, in one table, rather
 * than at forty call sites. A caller rebuilt in its own session can pass the
 * Phosphor component instead. A name nobody has mapped still draws, in the old
 * face, rather than leaving an empty tile.
 */
const PHOSPHOR: Record<string, PhosphorIcon> = {
  account_balance: BankIcon,
  account_balance_wallet: WalletIcon,
  auto_awesome: SparkleIcon,
  bar_chart: ChartBarIcon,
  delete: TrashIcon,
  description: FileTextIcon,
  grid_view: ChartPieSliceIcon,
  groups: UsersThreeIcon,
  home_work: BuildingsIcon,
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

/** A Phosphor component, or the Material name a screen has always passed. */
export type GlyphSource = string | PhosphorIcon;

export function Glyph({
  icon,
  size,
  weight = "duotone",
  className,
}: {
  icon: GlyphSource;
  size: number;
  weight?: IconWeight;
  className?: string;
}) {
  const Found = typeof icon === "string" ? PHOSPHOR[icon] : icon;
  if (Found) return <Found weight={weight} size={size} className={className} />;
  return (
    <Icon
      name={icon as string}
      size={size}
      fill={weight === "fill"}
      className={className}
    />
  );
}
