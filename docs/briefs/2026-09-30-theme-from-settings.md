# Brief 3 — the look of the app, changed from Settings

> **Built as #124 (Settings → Appearance) — see SESSIONS.md for what was
> chosen and where it differs.** Pasted in by the owner on 30 Sep 2026 with:
> *"ami amader applications er color and fonts gulake setting theke dynamic
> vabe control korbo. tomar hater kajta ses hole eta dhorba. akhon apatoto
> etake to do te rakho"*. Kept here word for word so the session that builds
> it has the whole brief. It comes from the HR portal's session: take the
> design and the reasons, not the code (§0). It touches shared code, the root
> layout and the schema, so ask the owner before starting (CLAUDE.md).

**For:** the Claude session working in the **ShareViral Finance** repository.
**From:** the session working in ShareViral People (HRM), 30 Sep 2026.
**Asked for by:** the owner — *"amar ei application tate jevabe theme change
kora jay and typo and color dynamic kora hoiche setting theke oi jinish tai
finance application er moddheo rakhte cai."*

---

## 0. Read this first

This describes a thing that is **built, shipped and in use** in the HR portal.
It is not a proposal. Everything below has been through the owner, through a
browser and through a harness, and where something was got wrong on the way it
is written down as a warning rather than quietly corrected.

**You are in a different repository with a different stack.** The two apps
share a server and nothing else — no code, no database, no configuration. So
take the *design and the reasons*; the code is here to be read, not copied
into a build system it does not fit. Where a decision depends on your stack,
this brief says so and leaves it to you.

**Nothing in here should travel with another change.** In our repository a
schema migration travels alone, and so does anything touching auth. This
feature is a migration plus a settings screen; do it as at least two commits.

---

## 1. What the owner is asking for

Three controls on a Settings screen, changing the **whole application** for
**everybody**, without a deploy:

1. **Colours** — every colour token the design uses, in light **and** dark.
2. **Typefaces and weights** — for headings, body text and buttons.
3. **Type size** — the same three, as a scale rather than a fixed size.

And one thing that is not a control but is the reason the controls are safe:

4. **A guard that refuses a palette nobody could read.**

---

## 2. The shape of it, in one paragraph

A single settings row in the database holds the choices. A **public** GET
hands them out. The **root layout** fetches them before anything is painted
and writes a `<style>` block into `<head>` that redefines the same CSS custom
properties the stylesheet already declares. Every screen follows, because
every screen was already drawing from those properties. The Settings panel
writes back through a Super-Admin-only PUT and previews with the *same
function* the layout uses.

No component imports anything. No screen is aware this exists.

---

## 3. Colours

### 3.1 The token list is the contract

We declare ~25 tokens. The names are the same strings in four places: the
stylesheet, the shared list, the API's validation, and the settings panel.

```ts
export const THEME_TOKENS = [
  "page", "surface", "surface-muted", "surface-hover",
  "ink", "body", "muted",
  "border", "border-soft", "track",
  "accent", "accent-hover", "on-accent",
  "violet", "violet-mid", "violet-soft", "violet-tint", "violet-tint-2",
  "violet-tint-line", "violet-ink", "on-violet",
  "warning", "warning-tint", "negative", "negative-tint",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type Palette = Record<ThemeToken, string>;
export type ThemeDto = { light: Palette; dark: Palette };
```

In our stylesheet these are `--color-page`, `--color-surface` and so on,
inside Tailwind v4's `@theme` block, which makes each one a utility
(`bg-surface`, `text-muted`). **If your app is not Tailwind v4, this is the
first thing to adapt** — the mechanism only needs that your colours already
come from custom properties on `:root`. If they are hard-coded in components,
that refactor is the real work and this feature is the easy part.

**A token in the stylesheet and not in this list is simply not editable.**
That is a safe failure and it is deliberate. We check the two against each
other in a harness rather than hoping.

### 3.2 Groups, because a flat list of 25 colour pickers is unusable

```ts
export const THEME_GROUPS: { title: string; note: string; tokens: readonly ThemeToken[] }[] = [
  { title: "Surfaces", note: "The grounds everything sits on.",
    tokens: ["page", "surface", "surface-muted", "surface-hover"] },
  { title: "Text", note: "Everything that is read.",
    tokens: ["ink", "body", "muted"] },
  // ... lines, accent, the violet ramp, states
];
```

The ORDER is part of the meaning — our violet ramp reads down in steps, and a
shuffled list invites somebody to break the series. We assert that every token
is in exactly one group, so a token added later cannot be editable in the API
and invisible on the screen.

### 3.3 The one strict thing: `#rrggbb`, lower case, nothing else

```ts
export const hexColour = z
  .string().trim().toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "Use a colour like #8558EC.");
```

Not `rgb()`, not a colour name, not three digits.

**This is a security control, not a style preference.** The stored value is
written into a `<style>` tag. A value that could contain `;` or `}` would be
writing CSS rather than a colour. The regex is the only reason it is safe to
put a stored value into a stylesheet at all — say so in a comment where you
write it, because somebody will later "improve" it to accept `rgba()`.

### 3.4 Storage: one nullable JSONB column, and NULL means *default*

```sql
ALTER TABLE "app_settings" ADD COLUMN "theme" JSONB;
```

Additive and nullable, so every existing row already means "nobody has changed
anything" and no backfill is needed.

**NULL is not a stored copy of the defaults, and that distinction matters.** A
column holding a copy goes stale the first time somebody retunes a colour in
the stylesheet, and then "Reset to the design" puts back last month's palette.
NULL means *ask the code*.

*(A note from our own experience: `prisma migrate dev` wanted to RESET the
database over this, because it reads our hand-written CHECK constraints as
drift. We wrote the migration by hand. Whatever your tool is, read the SQL it
generates before you commit it.)*

---

## 4. The readability guard — the part that makes this shippable

The owner chose **every** token rather than two brand colours. That is the
flexible answer and it is also the one that can make the application
unreadable: white text on a white surface is two colour pickers away.

### 4.1 It refuses; it does not warn

```ts
export function paletteProblem(theme: ThemeDto): string | null
```

**There is no way back from the other choice.** A palette is company-wide.
Somebody who saves white-on-white has made *Settings* unreadable too, for
everybody, and the screen that would let them undo it is the screen they can
no longer see. A warning they could click past is a door that locks behind
them.

Return a *sentence*, not a boolean: name the pair and the ratio so it can be
fixed rather than guessed at.

### 4.2 Not every pair — the pairs where failure means unreadable text

Checking all 25 against all 25 would refuse palettes nobody would ever look at
and turn the guard into something to be worked around. Ours is nine pairs:

| text | on | needs |
|---|---|---|
| `body` | `surface` | 4.5 |
| `body` | `page` | 4.5 |
| `ink` | `surface` | 4.5 |
| `muted` | `surface` | 3 |
| `on-violet` | `violet` | 3 |
| `on-accent` | `accent` | 3 |
| `violet-ink` | `violet-tint` | 3 |
| `negative` | `negative-tint` | 3 |
| `warning` | `warning-tint` | 3 |

4.5 is WCAG AA for body text; 3 is the large-text figure, which is what our
pill labels and muted lines are held to since they are 11–13px at weight 800
rather than paragraphs.

**Your list will be different and should be derived from your own design**, not
copied. The rule for choosing: a pair belongs here when failing it means text
somebody cannot read. It says nothing about taste — a lime app and a navy app
both pass.

The arithmetic is plain WCAG relative luminance:

```ts
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
```

**Check both light and dark.** A palette that passes in light and fails in dark
is a palette that has broken half the company.

---

## 5. Typography

### 5.1 Three roles, not eleven tokens

```ts
export const TYPOGRAPHY_ROLES = ["heading", "body", "button"] as const;
```

Those are the three a person actually means when they say "the font is wrong":
the headings, the body they read, and the buttons they press. **A settings
screen with eleven type controls is one nobody finishes.**

### 5.2 Self-hosted variable fonts, never a CDN link

We ship ten families as `@fontsource-variable/*` packages in the web bundle.
Three reasons, and all three apply to a finance app at least as strongly:

- The app renders the same with no internet beyond your own server.
- **No third party is told who opened a payroll page and when.**
- A typeface cannot change under the company because somebody re-released it.

**Variable, so a weight is a number rather than a file.** A static family ships
one file per weight; choosing 600 for a family that shipped 400 and 800 gets a
*synthesised* face that looks almost right. We hit exactly that with Archivo
and it cost an afternoon. A variable font has every weight in one file, so the
control can offer 100–900 honestly.

Each choice is `{ key, label, stack, note }` — the `note` is a sentence about
when that face is the right answer, shown beside it on the panel.

### 5.3 Size is a RATIO, and this is the subtle part

Our app sets type as exact pixels — `text-[13px]`, `text-[26px]` — because the
design does, and those numbers are a **hierarchy**. A control that forced every
heading to one size would flatten a designed scale into a wall.

So the control moves the whole scale. "Headings: 24" against a reference of 20
makes every heading a fifth larger and leaves the relationships exactly as
drawn.

It is applied with `zoom`, which multiplies an element's own computed size
rather than replacing it — the one property that can say *a fifth larger than
whatever this already was*.

**And then the correction that is easy to miss.** The body ratio goes on
`:root`, which the browser treats like its own zoom control: everything moves,
spacing included, so a larger body size makes a larger page rather than
crowded text in unchanged boxes. That carries the headings along with it — and
then "Headings: 20px" is a number that no longer describes anything. So
heading and button **divide the page ratio back out**:

```ts
const pageZoom    = ratio(s.bodySize,    DEFAULTS.bodySize);
const headingZoom = round(ratio(s.headingSize, DEFAULTS.headingSize) / pageZoom);
const buttonZoom  = round(ratio(s.buttonSize,  DEFAULTS.buttonSize)  / pageZoom);
```

Each control then means the size it says, whatever the other two are set to.

### 5.4 Emit nothing when nothing changed

```ts
if (headingZoom !== 1) lines.push(`h1,h2,h3,h4,h5,h6{zoom:${headingZoom};}`);
```

At the defaults there is no size rule at all, so an app nobody has touched
renders **byte for byte** as it did before this screen existed. That is what
makes the feature safe to ship: the null change is provably null.

### 5.5 Storage: ordinary columns, with a CHECK

Nine columns — three font keys, three weights, three sizes — with defaults
equal to what the app already renders. Weights are held by a CHECK
(`BETWEEN 100 AND 900 AND % 100 = 0`), and the Zod schema says the same thing
in a sentence a person can act on. **Both**: the schema puts the complaint
under the right box, the CHECK survives a route that forgets to validate.

---

## 6. Delivery — how it reaches the page

### 6.1 The read is PUBLIC. This is a decision, not an oversight

Our `GET /settings/theme` and `GET /settings/typography` need no session.

Reason: the sign-in screen is painted before anybody has signed in. A portal
that renders in the default colours until you log in is a portal that
**flashes**. What the route hands out is fifty hex values and nine numbers —
the same values anybody can read off the rendered page with a right click —
and nothing else. No timestamp, no name, no `updatedBy`.

**Check this against your own app before copying it.** If your finance app has
no public surface at all and you would rather not open one, the alternative is
to fetch behind the session and accept a flash on the login screen only. Say
which you chose and why.

### 6.2 The write is the Super Admin's alone

`settings.write` in our matrix, which is the Super Admin and nobody else. The
look of the company's portal is not something a role should be able to change
on a Tuesday. In your four-role model this is `super_admin`, not `cfo`.

### 6.3 A `<style>` block in `<head>`, and the ORDER is the mechanism

```tsx
const [typography, theme] = await Promise.all([
  publicApi<TypographySettings>("/settings/typography"),
  publicApi<ThemeDto>("/settings/theme"),
]);

// ... in <head>, AFTER the stylesheet:
<style id="app-typography" dangerouslySetInnerHTML={{ __html: typographyCss(typography ?? DEFAULTS) }} />
<style id="app-theme"      dangerouslySetInnerHTML={{ __html: themeCss(theme ?? DEFAULT_THEME) }} />
```

It redefines the same custom properties the stylesheet declares, and it wins
because it comes **later in the document** — same specificity, later rule. A
`<style>` placed before the stylesheet loses to the thing it is trying to
override. This is the whole mechanism and it is one line of ordering.

**Both reads fall back to the built-in defaults when the API cannot be
reached.** An app that looks right while its API is down beats one that is
correct about being broken.

### 6.4 Dark mode is an ATTRIBUTE, not a media query

```ts
export function themeCss(theme: ThemeDto): string {
  const block = (p: Palette) => THEME_TOKENS.map((t) => `--color-${t}:${p[t]}`).join(";");
  return `:root{${block(theme.light)}}` + `:root[data-theme="dark"]{${block(theme.dark)}}`;
}
```

Both blocks are emitted every time, so the toggle needs no second read.

And a tiny inline script in `<head>`, **before** anything paints:

```js
(function(){try{if(localStorage.getItem("theme")==="dark")
  document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()
```

An effect runs *after* the first paint, so without this the page flashes the
wrong theme on the way in. Light is the default and the absence of the
attribute **is** light, so the only thing this ever writes is `dark`. Put
`suppressHydrationWarning` on `<html>`, because the server's markup and the
client's first pass legitimately differ by one attribute.

---

## 7. The Settings screen

Two panels. Both preview by calling **the same function the layout calls**, so
the screen and the live page cannot disagree about what a choice looks like:

```tsx
<style dangerouslySetInnerHTML={{ __html: themeCss({ light: palette, dark: palette }) }} />
```

(Both keys set to the palette being edited, so the preview shows the tab you
are on rather than whichever theme the viewer happens to be in.)

Ours also has:

- **"Reset to the design"** — a POST that sets the column back to NULL.
- A **specimen sheet** underneath: every token, every button, every field,
  drawn from the live properties. It existed before the control did; making it
  editable is what turned a reference page into a screen.

---

## 8. What you must decide, and we cannot

1. **Do your colours already come from CSS custom properties?** If they are
   hard-coded in components, that is the actual work; this feature is trivial
   afterwards and impossible before.
2. **Public read, or behind the session?** §6.1. Your call, your reasons.
3. **Which pairs go in your contrast list?** §4.2. Derive from your design.
4. **Do you want the same ten typefaces?** Ours were chosen for an HR screen
   full of names. A finance app is columns of figures — you may want to weight
   the list towards faces with tabular numerals, and you should check that
   whatever you ship has them.
5. **Where does this live in your Settings?** Ours is `Settings → Design` and
   `Settings → Typography`.

---

## 9. Two warnings, both paid for

**Tailwind's preflight sets `margin: 0` on everything.** If you use Tailwind
and `<dialog>`, the browser's own `margin: auto` centring is gone and every
modal opens in the top-left corner. The owner reported exactly this on our
Budget screen today. Unrelated to theming and worth checking while you are in
the stylesheet.

**A `"use client"` module cannot take a component as a prop from a server
component.** We moved a small shared component into a client module this
afternoon; the icon prop it takes is a component, React refused it, and a
whole filter bar rendered nothing — while typechecking and linting clean. If
your settings panel takes icons as props, keep the module free of a directive
so it works from either side.

---

## 10. What we would like back

1. **Which of §8's five you chose**, one line each.
2. **Whether your app's colours were already properties or had to be made so**
   — that is the honest measure of how big this was, and the owner will ask.
3. **Anything in here that turned out to be wrong for your stack.** We would
   rather correct this brief than have two apps that disagree about how their
   own look is stored.

---

*Everything above is in use at `hrm.hellonizam.com`. If a claim here does not
match what you see, tell us — a sentence in a brief that is no longer true is
worse than no brief.*
