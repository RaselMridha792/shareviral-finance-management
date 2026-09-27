import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A titled card on an account's page, as the September 2026 handoff draws it:
 * a violet icon and the title over a 1.5px rule, the body under it.
 *
 * Its own file because the account's page and the card-details block both
 * use it, and one of them imports the other.
 */
export function Panel({
  icon: Glyph,
  title,
  description,
  aside,
  className,
  children,
}: {
  icon: Icon;
  title: string;
  description?: string;
  /** At the header's right-hand end — a button that belongs to this card. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "sv-card flex flex-col overflow-hidden rounded-[11px] bg-(--sv-surface)",
        className,
      )}
    >
      <header className="sv-panel-head flex items-center gap-2.5 px-5 py-4">
        <Glyph
          weight="duotone"
          size={21}
          className="flex-none text-(--sv-violet)"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-extrabold">{title}</h2>
          {description ? (
            <p className="text-[12.5px] text-(--sv-muted)">{description}</p>
          ) : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
