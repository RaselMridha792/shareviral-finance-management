"use client";

import type { Icon } from "@phosphor-icons/react";
import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { PowerIcon } from "@phosphor-icons/react/dist/ssr/Power";
import { ProhibitIcon } from "@phosphor-icons/react/dist/ssr/Prohibit";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { UserGearIcon } from "@phosphor-icons/react/dist/ssr/UserGear";
import type { ReactNode } from "react";

import { Th } from "@/components/ui/table";

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

/**
 * The handoff's tones for the second slot: a void or a deactivation is a
 * muted grey icon — it undoes nothing yet — and only an outright delete wears
 * the red tint.
 */
const SECOND: Record<
  SecondAction,
  { label: string; icon: Icon; tone: RowButtonTone }
> = {
  void: { label: "Void", icon: ProhibitIcon, tone: "muted" },
  deactivate: { label: "Deactivate", icon: PowerIcon, tone: "muted" },
  archive: { label: "Archive", icon: ArchiveIcon, tone: "muted" },
  delete: { label: "Delete", icon: TrashIcon, tone: "danger" },
  status: { label: "Change status", icon: UserGearIcon, tone: "violet" },
};

export type RowButtonTone = "violet" | "muted" | "danger";

/**
 * One of the 32px buttons a row ends with (`.sv-row-button`): violet icon on
 * the subtle ground, violet-tint under the pointer; `danger` is the red tint.
 *
 * Exported so a row's own extra button — a receipt, a payment, a password
 * reset — is the same button as the ones beside it.
 */
export function RowButton({
  label,
  title = label,
  icon: Glyph,
  onClick,
  href,
  disabled,
  tone = "violet",
}: {
  /** What a screen reader hears — may name the row ("… for Cursor"). */
  label: string;
  /** The tooltip, when it should be shorter than the label. */
  title?: string;
  icon: Icon;
  onClick?: () => void;
  /** A link instead of a button — opens in a new tab. */
  href?: string;
  disabled?: boolean;
  tone?: RowButtonTone;
}) {
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        title={title}
        data-tone={tone}
        className="sv-row-button"
      >
        <Glyph weight="duotone" size={16} />
      </a>
    );
  }

  /*
   * No handler, no button.
   *
   * It used to render disabled and greyed at 35% — visible, unclickable, and
   * on every row of every table for anybody who cannot write. The owner:
   * *"je role view only tar jonne ... jegula write action diye thake button
   * oigula hide thakbe se sudhu dekhte pabe."*
   *
   * `disabled` is still honoured, and still means something different: the
   * action EXISTS for this person but not for this row — a paid payroll run
   * that cannot be edited, a void that is already void. That is worth showing
   * greyed, because it explains itself. An action they will never have is not.
   */
  if (!onClick) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      data-tone={tone}
      className="sv-row-button"
    >
      <Glyph weight="duotone" size={16} />
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
  const { label, icon, tone } = SECOND[second];

  return (
    <td>
      {/*
        The cell keeps its width whether or not it holds anything, because the
        column is sized by `RowActionsHead` — so a reader with no actions gets
        an empty cell rather than a table that changes shape under them.
      */}
      <div className="flex items-center justify-end gap-1.5">
        {extra}
        <RowButton label="Edit" icon={PencilSimpleIcon} onClick={onEdit} />
        <RowButton label={label} icon={icon} onClick={onSecond} tone={tone} />
        {onDelete ? (
          // "Move to trash", not "Delete" — the owner's catch: the row is
          // recoverable from Settings → Trashed, and the word should promise
          // exactly what the click does.
          <RowButton
            label="Move to trash"
            icon={TrashIcon}
            onClick={onDelete}
            tone="danger"
          />
        ) : null}
      </div>
    </td>
  );
}

/**
 * The unlabelled heading above the buttons.
 *
 * Wider when a third one is there, because two 32px buttons under a `w-24`
 * heading fit and three do not — the column squeezes the one before it
 * instead, which is how a description column loses six characters on eight
 * screens at once.
 */
export function RowActionsHead({ deletable = false }: { deletable?: boolean }) {
  return <Th width={deletable ? "w-32" : "w-24"} align="right" />;
}
