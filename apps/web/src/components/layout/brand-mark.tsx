/**
 * The company's mark.
 *
 * Inline SVG rather than an `<img>` to a file: it appears in the rail on every
 * screen, and a request per page load for 400 bytes of vector is a request that
 * can fail and leave a hole where the brand is. Inline it renders with the
 * first paint, scales to any size, and costs nothing.
 *
 * The lime is the brand's own and is deliberately not a theme token — it is the
 * same green on a dark rail as on a light one, which is what a mark is for. The
 * rounded square carries it, so the colour never has to work as text against a
 * ground that changes.
 *
 * No `<title>`: every place this is used already labels itself in text beside
 * it, and a second name announced to a screen reader is a stutter, not help.
 * Hence `aria-hidden`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="100" height="100" rx="20" fill="#BFFF00" />
      {/* The line and its arrowhead, drawn as two strokes so the head keeps
          its right angle at any size rather than being a scaled triangle. */}
      <path
        d="M25 70 L45 50 L55 60 L75 30"
        stroke="#000000"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M65 30 L75 30 L75 40"
        stroke="#000000"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/*
        Kept exactly as supplied, trademark sign and all. It is 8px against a
        100-unit box, so below about 40px on screen it reads as a mark on the
        corner rather than as two letters — which is how a ™ behaves everywhere
        and is not mine to redraw.
      */}
      <text
        x="82"
        y="22"
        fontFamily="Arial, sans-serif"
        fontSize="8"
        fontWeight="700"
        fill="#000000"
      >
        ™
      </text>
    </svg>
  );
}
