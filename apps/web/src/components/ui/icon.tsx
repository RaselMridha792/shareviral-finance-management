import { cn } from "@/lib/utils";

/**
 * A Material Symbols Rounded glyph.
 *
 * The design names its icons — `south_west` for money in, `percent` for tax,
 * `account_balance_wallet` for a balance — so they are written here as those
 * names rather than translated into another set's approximations. Nothing has
 * to be guessed at, and a reviewer can check a screen against the handoff by
 * reading it.
 *
 * The face is variable, so `fill` switches the outline for a solid without a
 * second font file. That is how the active nav item is drawn.
 *
 * `aria-hidden` by default and on purpose: every icon in this app sits beside
 * the words it illustrates, so announcing it would read the same thing twice.
 * Pass a `label` for the rare case where the glyph is the only content — an
 * icon-only button — and it becomes an image with a name instead.
 */
export function Icon({
  name,
  size = 19,
  fill = false,
  weight,
  label,
  className,
  style,
}: {
  /** A Material Symbols Rounded ligature, e.g. "account_balance". */
  name: string;
  /** Pixels. The design uses 17 for stat labels, 19 for card headings, 21 for
   *  section headings and 27 for page titles. */
  size?: number;
  fill?: boolean;
  weight?: 300 | 400 | 500 | 600 | 700;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn("ms-icon", className)}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      style={{
        fontSize: size,
        // The optical-size axis follows the rendered size, which is what keeps
        // a 17px glyph from looking like a shrunken 27px one.
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight ?? 400}, 'GRAD' 0, 'opsz' ${size}`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}
