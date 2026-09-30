import { z } from "zod";

/**
 * The look of the app, chosen in Settings → Appearance (#124).
 *
 * The owner, 30 Sep 2026: *"ami amader applications er color and fonts
 * gulake setting theke dynamic vabe control korbo"* — after the HR portal
 * shipped the same thing (its Brief 3, kept in docs/briefs).
 *
 * The mechanism is the stylesheet's own. Every colour on every screen is
 * already a `--sv-*` custom property (globals.css), light on `:root` and dark
 * on `:root[data-theme="dark"]`, and every figure and line of prose is set in
 * `--sv-font`. The signed-in layout writes one `<style>` that redefines them,
 * built by the functions at the bottom of this file; the Settings panel
 * previews with the same functions, so the two cannot disagree. No screen
 * knows this exists.
 *
 * NULL is the design. Neither stored value is ever a copy of the defaults:
 * a copy goes stale the first time globals.css is retuned, and then "Reset to
 * the design" would put back last month's palette. At NULL — and at values
 * equal to the defaults — the functions below write nothing, so an app nobody
 * has touched renders exactly as it did before this existed.
 */

/* -------------------------------------------------------------------------- */
/*  Colours                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The editable colours: `--sv-<token>` in globals.css, the handoff's table.
 * The same strings in four places — the stylesheet, this list, the API's
 * validation and the panel. A property in the stylesheet and not here is
 * simply not editable, which is a safe failure; `.appearanceqa.mjs` checks
 * the two against each other rather than hoping.
 *
 * Not here on purpose: the sign-in page's and the preloader's own values
 * (`--sv-grid`, `--sv-ring` …), the shadows, and the chart colours. The
 * sign-in page is drawn in the design as it is (the owner's choice, 30 Sep),
 * and the rest are not colours a person picks.
 */
export const THEME_TOKENS = [
  "bg",
  "surface",
  "subtle",
  "hover",
  "ink",
  "muted",
  "line",
  "line-soft",
  "track",
  "accent",
  "accent-hover",
  "on-accent",
  "lime-tint",
  "lime-line",
  "violet",
  "violet-mid",
  "violet-soft",
  "violet-tint",
  "violet-tint-line",
  "violet-ink",
  "pos",
  "pos-tint",
  "neg",
  "neg-tint",
  "warn",
  "warn-tint",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type Palette = Record<ThemeToken, string>;
export type ThemeDto = { light: Palette; dark: Palette };

/** What each colour is called on the panel, and what it paints. */
export const THEME_TOKEN_LABELS: Record<
  ThemeToken,
  { label: string; note: string }
> = {
  bg: { label: "Page", note: "Behind everything" },
  surface: { label: "Cards", note: "Cards, tables, drawers" },
  subtle: { label: "Quiet fill", note: "Fields, tabs, grouped rows" },
  hover: { label: "Row hover", note: "A row under the pointer" },
  ink: { label: "Text", note: "Titles, figures, everything read" },
  muted: { label: "Secondary text", note: "Hints, labels, second lines" },
  line: { label: "Lines", note: "Borders and dividers" },
  "line-soft": { label: "Soft lines", note: "Lines between table rows" },
  track: { label: "Tracks", note: "Progress bars, switches off" },
  accent: { label: "Accent", note: "Primary buttons, the active tab" },
  "accent-hover": {
    label: "Accent, hovered",
    note: "A primary button hovered",
  },
  "on-accent": {
    label: "Text on accent",
    note: "The words on a primary button",
  },
  "lime-tint": { label: "Accent tint", note: "Highlighted bands" },
  "lime-line": { label: "Accent tint line", note: "Their borders" },
  violet: { label: "Violet", note: "Icons, highlights, count badges" },
  "violet-mid": { label: "Violet, mid", note: "Charts and the second step" },
  "violet-soft": { label: "Violet, soft", note: "Soft fills" },
  "violet-tint": { label: "Violet tint", note: "The selected menu item" },
  "violet-tint-line": { label: "Violet tint line", note: "Its border" },
  "violet-ink": { label: "Violet ink", note: "Links and selected text" },
  pos: { label: "Money in", note: "Money in, success" },
  "pos-tint": { label: "Money in, tint", note: "Behind a success chip" },
  neg: { label: "Money out", note: "Money out, errors" },
  "neg-tint": { label: "Money out, tint", note: "Behind an error" },
  warn: { label: "Warning", note: "Warnings" },
  "warn-tint": { label: "Warning, tint", note: "Behind a warning" },
};

/**
 * The panel's groups, in the order the design reads. The order is part of the
 * meaning — the violet ramp steps down — and every token is in exactly one
 * group (tested), so none can be editable in the API and missing on screen.
 */
export const THEME_GROUPS: {
  title: string;
  note: string;
  tokens: readonly ThemeToken[];
}[] = [
  {
    title: "Surfaces",
    note: "The grounds everything sits on.",
    tokens: ["bg", "surface", "subtle", "hover"],
  },
  { title: "Text", note: "Everything that is read.", tokens: ["ink", "muted"] },
  {
    title: "Lines",
    note: "What divides one thing from the next.",
    tokens: ["line", "line-soft", "track"],
  },
  {
    title: "Accent",
    note: "The brand's fill: primary buttons and highlights.",
    tokens: ["accent", "accent-hover", "on-accent", "lime-tint", "lime-line"],
  },
  {
    title: "Violet",
    note: "The brand as type and icons, in steps.",
    tokens: [
      "violet",
      "violet-mid",
      "violet-soft",
      "violet-tint",
      "violet-tint-line",
      "violet-ink",
    ],
  },
  {
    title: "Money and states",
    note: "In is green and out is red, whatever the brand is doing.",
    tokens: ["pos", "pos-tint", "neg", "neg-tint", "warn", "warn-tint"],
  },
];

/** globals.css, exactly — the design. `.appearanceqa.mjs` holds them equal. */
export const DEFAULT_THEME: ThemeDto = {
  light: {
    bg: "#f1f3ec",
    surface: "#ffffff",
    subtle: "#f4f6f0",
    hover: "#f8fcea",
    ink: "#060800",
    muted: "#6e7367",
    line: "#e7ebe0",
    "line-soft": "#eef1e8",
    track: "#edefe6",
    accent: "#bfff00",
    "accent-hover": "#a6e000",
    "on-accent": "#060800",
    "lime-tint": "#f6faea",
    "lime-line": "#e3ebc8",
    violet: "#8558ec",
    "violet-mid": "#a47cf1",
    "violet-soft": "#cdb8fb",
    "violet-tint": "#f1ecfe",
    "violet-tint-line": "#dfd2fb",
    "violet-ink": "#4b2a9e",
    pos: "#1e7a3c",
    "pos-tint": "#e6f5ea",
    neg: "#b3261e",
    "neg-tint": "#fce9e7",
    warn: "#8a5a00",
    "warn-tint": "#fff4dc",
  },
  dark: {
    bg: "#0c0f08",
    surface: "#14180f",
    subtle: "#1d2216",
    hover: "#222a18",
    ink: "#ecf1e2",
    muted: "#9ba48e",
    line: "#2a3121",
    "line-soft": "#232a1b",
    track: "#2a3121",
    accent: "#bfff00",
    "accent-hover": "#d2ff4d",
    "on-accent": "#060800",
    "lime-tint": "#1a2010",
    "lime-line": "#2e3a18",
    violet: "#9b76f2",
    "violet-mid": "#7c51d9",
    "violet-soft": "#4a3579",
    "violet-tint": "#241a3d",
    "violet-tint-line": "#3a2b5e",
    "violet-ink": "#cdb8fb",
    pos: "#7fd99a",
    "pos-tint": "#15291b",
    neg: "#f2a097",
    "neg-tint": "#2e1714",
    warn: "#f2c46b",
    "warn-tint": "#2b2412",
  },
};

/**
 * `#rrggbb`, lower case, and nothing else — not `rgb()`, not a name, not
 * three digits.
 *
 * THIS IS A SECURITY CONTROL, NOT A STYLE PREFERENCE. The value is written
 * into a `<style>` block on every signed-in page. A value that could hold `;`
 * or `}` would be writing CSS rather than a colour. Do not widen it to accept
 * `rgba()` or anything else without replacing what it protects.
 */
export const hexColourSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "Use a colour like #8558ec");

export const paletteSchema = z.strictObject(
  Object.fromEntries(THEME_TOKENS.map((token) => [token, hexColourSchema])) as {
    [K in ThemeToken]: typeof hexColourSchema;
  },
);

export const themeSchema = z.strictObject({
  light: paletteSchema,
  dark: paletteSchema,
});

/* ---- The readability guard ------------------------------------------------ */

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * The pairs where failing means text somebody cannot read — derived from
 * where this design puts text, not from taste: a navy app and a lime app both
 * pass. 4.5 is WCAG AA for text; 3 is its figure for large or bold text and
 * for icons, which is what the chips, buttons and second lines here are.
 *
 * `#ffffff` is not a token: the count badges set white on violet in the
 * stylesheet, so that pair is held too. The danger button's white on red is
 * NOT held: the design's own dark red (#f2a097) carries it at 2.0:1, and a
 * guard that refused the design would be one nobody could save past.
 */
export const CONTRAST_PAIRS: {
  text: ThemeToken | "#ffffff";
  on: ThemeToken;
  min: number;
  where: string;
}[] = [
  { text: "ink", on: "bg", min: 4.5, where: "page titles on the page" },
  { text: "ink", on: "surface", min: 4.5, where: "text on cards" },
  { text: "ink", on: "subtle", min: 4.5, where: "text in fields" },
  { text: "muted", on: "surface", min: 3, where: "second lines on cards" },
  { text: "muted", on: "bg", min: 3, where: "second lines on the page" },
  { text: "on-accent", on: "accent", min: 3, where: "primary buttons" },
  { text: "violet-ink", on: "surface", min: 4.5, where: "links" },
  {
    text: "violet-ink",
    on: "violet-tint",
    min: 3,
    where: "the selected menu item",
  },
  { text: "violet", on: "surface", min: 3, where: "icons and highlights" },
  { text: "#ffffff", on: "violet", min: 3, where: "count badges" },
  { text: "pos", on: "surface", min: 4.5, where: "money in" },
  { text: "neg", on: "surface", min: 4.5, where: "money out and errors" },
  { text: "warn", on: "surface", min: 4.5, where: "warnings" },
  { text: "pos", on: "pos-tint", min: 3, where: "success chips" },
  { text: "neg", on: "neg-tint", min: 3, where: "error chips" },
  { text: "warn", on: "warn-tint", min: 3, where: "warning chips" },
];

function nameOf(token: ThemeToken | "#ffffff"): string {
  return token === "#ffffff" ? "White" : THEME_TOKEN_LABELS[token].label;
}

/**
 * Why this palette cannot be saved, in a sentence — or null when it can.
 *
 * It refuses rather than warns. A palette is company-wide: somebody who saves
 * white on white has made Settings unreadable too, for everybody, and the
 * screen that would let them undo it is the one they can no longer read. A
 * warning they could click past is a door that locks behind them.
 *
 * Both halves are checked: a palette that passes in light and fails in dark
 * has broken the app for everybody who works in dark.
 */
export function paletteProblem(theme: ThemeDto): string | null {
  for (const mode of ["light", "dark"] as const) {
    const palette = theme[mode];
    for (const pair of CONTRAST_PAIRS) {
      const text = pair.text === "#ffffff" ? "#ffffff" : palette[pair.text];
      const ground = palette[pair.on];
      const ratio = contrast(text, ground);
      if (ratio < pair.min) {
        return `${mode === "light" ? "Light" : "Dark"}: ${nameOf(pair.text)} (${text}) on ${nameOf(pair.on)} (${ground}) is ${(Math.floor(ratio * 10) / 10).toFixed(1)}:1 — at least ${pair.min}:1 is needed to read it (${pair.where}).`;
      }
    }
  }
  return null;
}

/** A stored theme, or null when it is not one — never written as it is. */
export function readTheme(value: unknown): ThemeDto | null {
  const parsed = themeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/* -------------------------------------------------------------------------- */
/*  Type                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The typefaces on offer: self-hosted variable fonts (`@fontsource-variable`
 * in the web bundle), never a CDN — the app renders the same with no internet
 * beyond its own server, no third party learns who opened a payroll page, and
 * no face changes because somebody re-released it. Variable, so a weight is a
 * number rather than a file and 600 is a real 600, not a synthesised one.
 *
 * Chosen for columns of figures: every one has tabular numerals, which is
 * what lines a money column up (`.appearanceqa.mjs` measures it — DM Sans was
 * on this list until it did: its figures are proportional, so 111 is half as
 * wide as 000). `min` and `max` are the weights each one actually carries.
 */
export const FONT_CHOICES = [
  {
    key: "plus-jakarta-sans",
    label: "Plus Jakarta Sans",
    family: "Plus Jakarta Sans Variable",
    min: 200,
    max: 800,
    note: "The design's own face — round, open, friendly at small sizes.",
  },
  {
    key: "inter",
    label: "Inter",
    family: "Inter Variable",
    min: 100,
    max: 900,
    note: "Made for screens; the most legible at 12–14px, plain and neutral.",
  },
  {
    key: "ibm-plex-sans",
    label: "IBM Plex Sans",
    family: "IBM Plex Sans Variable",
    min: 100,
    max: 700,
    note: "Engineered and a little formal — reads like a bank statement.",
  },
  {
    key: "manrope",
    label: "Manrope",
    family: "Manrope Variable",
    min: 200,
    max: 800,
    note: "Geometric and modern; wide figures that are easy to compare.",
  },
  {
    key: "figtree",
    label: "Figtree",
    family: "Figtree Variable",
    min: 300,
    max: 900,
    note: "Clean and warm; a softer alternative to Inter.",
  },
  {
    key: "public-sans",
    label: "Public Sans",
    family: "Public Sans Variable",
    min: 100,
    max: 900,
    note: "Made for government forms — sober, neutral, very readable.",
  },
  {
    key: "source-sans-3",
    label: "Source Sans 3",
    family: "Source Sans 3 Variable",
    min: 200,
    max: 900,
    note: "Narrow and calm; long lists and reports stay tidy.",
  },
  {
    key: "work-sans",
    label: "Work Sans",
    family: "Work Sans Variable",
    min: 100,
    max: 900,
    note: "Slightly wide, with character; good for headings.",
  },
  {
    key: "onest",
    label: "Onest",
    family: "Onest Variable",
    min: 100,
    max: 900,
    note: "Crisp and contemporary; strong figures at heavy weights.",
  },
] as const;

export type FontKey = (typeof FONT_CHOICES)[number]["key"];
const FONT_KEYS = FONT_CHOICES.map((font) => font.key) as [
  FontKey,
  ...FontKey[],
];

export function fontOf(key: string) {
  return FONT_CHOICES.find((font) => font.key === key) ?? FONT_CHOICES[0];
}

/** A font's CSS stack: its family, then the system's, as globals.css has it. */
export function fontStack(key: string): string {
  return `"${fontOf(key).family}", ui-sans-serif, system-ui, sans-serif`;
}

/**
 * Three roles, not eleven tokens — the three a person means when they say
 * "the font is wrong": the headings, the text they read, the buttons they
 * press.
 */
export const TYPOGRAPHY_ROLES = ["heading", "body", "button"] as const;
export type TypographyRole = (typeof TYPOGRAPHY_ROLES)[number];

/**
 * Each role's size is the size of its reference element — the page title
 * (28px), body text and table cells (14.5px), a button (14px) — and moving it
 * moves that role's whole scale in proportion, so the design's hierarchy
 * stays as drawn. See `typographyCss`.
 */
export const TYPOGRAPHY_SIZES: Record<
  TypographyRole,
  { min: number; max: number; step: number; reference: string }
> = {
  heading: { min: 20, max: 40, step: 1, reference: "the page title" },
  body: { min: 12, max: 18, step: 0.5, reference: "text and table cells" },
  button: { min: 12, max: 18, step: 0.5, reference: "a button's label" },
};

export type TypographyStyle = { font: FontKey; weight: number; size: number };
export type TypographySettings = Record<TypographyRole, TypographyStyle>;

/** What the app renders today — the design. */
export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  heading: { font: "plus-jakarta-sans", weight: 800, size: 28 },
  body: { font: "plus-jakarta-sans", weight: 400, size: 14.5 },
  button: { font: "plus-jakarta-sans", weight: 800, size: 14 },
};

function styleSchema(role: TypographyRole) {
  const size = TYPOGRAPHY_SIZES[role];
  return z
    .strictObject({
      font: z.enum(FONT_KEYS),
      weight: z
        .number()
        .int()
        .min(100, "A weight from 100 to 900")
        .max(900, "A weight from 100 to 900")
        .multipleOf(100, "A weight in hundreds, like 400 or 700"),
      size: z
        .number()
        .min(size.min, `From ${size.min} to ${size.max}px`)
        .max(size.max, `From ${size.min} to ${size.max}px`)
        .multipleOf(size.step, `In steps of ${size.step}px`),
    })
    .superRefine((value, ctx) => {
      const font = fontOf(value.font);
      if (value.weight < font.min || value.weight > font.max) {
        ctx.addIssue({
          code: "custom",
          path: ["weight"],
          message: `${font.label} comes in ${font.min} to ${font.max}`,
        });
      }
    });
}

export const typographySchema = z.strictObject({
  heading: styleSchema("heading"),
  body: styleSchema("body"),
  button: styleSchema("button"),
});

/** A stored choice, or null when it is not one. */
export function readTypography(value: unknown): TypographySettings | null {
  const parsed = typographySchema.safeParse(value);
  return parsed.success ? (parsed.data as TypographySettings) : null;
}

/* -------------------------------------------------------------------------- */
/*  The CSS — one builder for the layout and the panel's preview               */
/* -------------------------------------------------------------------------- */

/**
 * The palette as CSS, or "" for the design.
 *
 * It wins by specificity rather than by where it lands in the document, which
 * Next decides: `:root:not([data-theme="dark"])` (0,2,0) beats globals.css's
 * `:root` (0,1,0), and `:root:root[data-theme="dark"]` (0,3,0) beats its
 * `:root[data-theme="dark"]` (0,2,0). `.sv-light` — the sign-in page and the
 * preloader — declares its own values on its subtree and so keeps the design,
 * as the owner chose.
 *
 * The theme script paints `<html>`'s background inline before anything loads,
 * in the design's ground; the last rule puts the chosen one back over it.
 */
export function themeCss(theme: ThemeDto | null): string {
  if (!theme) return "";
  const block = (palette: Palette) =>
    THEME_TOKENS.map((token) => `--sv-${token}:${palette[token]}`).join(";");
  return (
    `:root:not([data-theme="dark"]){${block(theme.light)}}` +
    `:root:root[data-theme="dark"]{${block(theme.dark)}}` +
    `html{background-color:var(--sv-bg)!important}`
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The type choices as CSS, or "" for the design.
 *
 * FACES. Body text is `--sv-font`, which every figure and line of prose
 * already reads (`--font-sans`, `--font-num`). Headings and buttons carry
 * Tailwind weight classes (`font-extrabold`), which an element selector
 * cannot outrank, so their rules are `!important` — written only when
 * something was changed. Once any face is changed, all three are written, so
 * a heading set to the design's face stays in it when the body's changes.
 *
 * SIZE IS A RATIO. The design sets type as exact pixels because those numbers
 * are a hierarchy, and a control that forced every heading to one size would
 * flatten it. So each size moves its role's whole scale with `zoom`, which
 * multiplies an element's own size rather than replacing it. The body's goes
 * on `<html>`, which the browser treats like its own zoom — spacing moves
 * with the text (`.appearanceqa.mjs` checks nothing then scrolls sideways) —
 * and that carries headings and buttons with it, so theirs divide the page's
 * ratio back out: each control then means the size it says.
 *
 * Nothing is written for what equals the design.
 */
export function typographyCss(settings: TypographySettings | null): string {
  if (!settings) return "";
  const d = DEFAULT_TYPOGRAPHY;
  const rules: string[] = [];

  const anyFace = TYPOGRAPHY_ROLES.some(
    (role) => settings[role].font !== d[role].font,
  );
  if (anyFace) {
    rules.push(`:root:root{--sv-font:${fontStack(settings.body.font)}}`);
    rules.push(
      `h1,h2,h3,h4,h5,h6{font-family:${fontStack(settings.heading.font)}!important}`,
    );
    rules.push(
      `.sv-button{font-family:${fontStack(settings.button.font)}!important}`,
    );
  }

  if (settings.body.weight !== d.body.weight)
    rules.push(`body{font-weight:${settings.body.weight}}`);
  if (settings.heading.weight !== d.heading.weight)
    rules.push(
      `h1,h2,h3,h4,h5,h6{font-weight:${settings.heading.weight}!important}`,
    );
  if (settings.button.weight !== d.button.weight)
    rules.push(`.sv-button{font-weight:${settings.button.weight}!important}`);

  const pageZoom = settings.body.size / d.body.size;
  const headingZoom = round(settings.heading.size / d.heading.size / pageZoom);
  const buttonZoom = round(settings.button.size / d.button.size / pageZoom);
  if (round(pageZoom) !== 1) rules.push(`html{zoom:${round(pageZoom)}}`);
  if (headingZoom !== 1) rules.push(`h1,h2,h3,h4,h5,h6{zoom:${headingZoom}}`);
  if (buttonZoom !== 1) rules.push(`.sv-button{zoom:${buttonZoom}}`);

  return rules.join("");
}

/** Both, as the signed-in layout writes them. */
export function appearanceCss(appearance: {
  theme: ThemeDto | null;
  typography: TypographySettings | null;
}): string {
  return themeCss(appearance.theme) + typographyCss(appearance.typography);
}
