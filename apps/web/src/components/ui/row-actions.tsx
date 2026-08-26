"use client";

import {
  Ban,
  Archive,
  PowerOff,
  SquarePen,
  Trash2,
  UserCog,
} from "lucide-react";
import type { ReactNode } from "react";

import { Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The two buttons every row ends with.
 *
 * The owner's rule is that the pair sits in the same place on every table. What
 * the *second* one does is not the same everywhere, and cannot be: void is a
 * money word. A voided ledger row stays on screen struck through, drops out of
 * every total, and is in the audit log — that machinery is what makes undoing a
 * ledger entry safe, and it does not exist for a user account or an exchange
 * rate. So the position is the standard; the verb follows the row.
 *
 * The other rule here is that an unavailable action renders **disabled rather
 * than absent**. Three screens currently drop the buttons entirely on a voided
 * row or for a read-only reader, which leaves a blank cell where every other
 * row has controls — and a blank cell reads as a rendering fault, not as "you
 * cannot do this".
 *
 * `onDelete` adds a third button, and is separate from `second: "delete"` on
 * purpose. The second slot holds whatever that table's rows support — void,
 * archive, change status — and deleting is none of those: it is the same act
 * on every table, it goes to the same trash, and it is the only one that can
 * be undone from somewhere other than the screen it happened on. A row where
 * both make sense shows both. Omitting the prop leaves the pair exactly as it
 * was, which is what keeps a screen that has not been wired for deleting yet
 * unchanged rather than half-changed.
 */

export type SecondAction =
  "void" | "deactivate" | "archive" | "delete" | "status";

const SECOND: Record<
  SecondAction,
  { label: string; icon: typeof Ban; danger: boolean }
> = {
  void: { label: "Void", icon: Ban, danger: true },
  deactivate: { label: "Deactivate", icon: PowerOff, danger: true },
  archive: { label: "Archive", icon: Archive, danger: false },
  delete: { label: "Delete", icon: Trash2, danger: true },
  status: { label: "Change status", icon: UserCog, danger: false },
};

function IconButton({
  label,
  icon: Glyph,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: typeof Ban;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-label={label}
      title={label}
      className={cn(
        "cursor-pointer rounded p-1 text-muted-foreground transition-colors",
        "hover:bg-surface-muted",
        danger ? "hover:text-negative" : "hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
      )}
    >
      <Glyph className="size-3.5" />
    </button>
  );
}

export function RowActions({
  onEdit,
  second,
  onSecond,
  onDelete,
  /** Anything the row carries in addition — a receipt link, a payslip link. */
  extra,
}: {
  onEdit?: () => void;
  second: SecondAction;
  onSecond?: () => void;
  /** Opens the confirmation. Omit on a table not yet wired for deleting. */
  onDelete?: () => void;
  extra?: ReactNode;
}) {
  const { label, icon, danger } = SECOND[second];

  return (
    <td>
      <div className="flex items-center justify-end gap-1">
        {extra}
        <IconButton label="Edit" icon={SquarePen} onClick={onEdit} />
        <IconButton
          label={label}
          icon={icon}
          onClick={onSecond}
          danger={danger}
        />
        {onDelete ? (
          <IconButton
            label="Delete"
            icon={Trash2}
            onClick={onDelete}
            danger
          />
        ) : null}
      </div>
    </td>
  );
}

/**
 * The unlabelled heading above the buttons.
 *
 * Wider when a third one is there, because two icons under a `w-24` heading
 * fit and three do not — the column squeezes the one before it instead, which
 * is how a description column loses six characters on eight screens at once.
 */
export function RowActionsHead({ deletable = false }: { deletable?: boolean }) {
  return <Th width={deletable ? "w-32" : "w-24"} align="right" />;
}
