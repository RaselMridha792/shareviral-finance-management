import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_THEME,
  DEFAULT_TYPOGRAPHY,
  FONT_CHOICES,
  THEME_GROUPS,
  THEME_TOKENS,
  appearanceCss,
  contrast,
  hexColourSchema,
  paletteProblem,
  readTheme,
  readTypography,
  themeCss,
  themeSchema,
  typographyCss,
  typographySchema,
  type ThemeDto,
  type TypographySettings,
} from "./appearance.ts";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("the palette", () => {
  it("puts every token in exactly one group", () => {
    const grouped = THEME_GROUPS.flatMap((group) => group.tokens);
    assert.deepEqual([...grouped].sort(), [...THEME_TOKENS].sort());
    assert.equal(new Set(grouped).size, grouped.length);
  });

  it("gives the design a value for every token, light and dark", () => {
    assert.ok(themeSchema.safeParse(DEFAULT_THEME).success);
  });

  it("takes #rrggbb and lower-cases it, and nothing else", () => {
    assert.equal(hexColourSchema.parse(" #8558EC "), "#8558ec");
    for (const bad of [
      "#fff",
      "rgb(1,2,3)",
      "red",
      "#8558ec;}body{display:none",
      "#8558ec}",
      "8558ec",
    ]) {
      assert.equal(hexColourSchema.safeParse(bad).success, false, bad);
    }
  });

  it("refuses a palette with a token missing or one extra", () => {
    const missing = copy(DEFAULT_THEME) as Record<
      string,
      Record<string, string>
    >;
    delete missing.light.ink;
    assert.equal(themeSchema.safeParse(missing).success, false);
    const extra = copy(DEFAULT_THEME) as Record<string, Record<string, string>>;
    extra.dark.shadow = "#000000";
    assert.equal(themeSchema.safeParse(extra).success, false);
  });

  it("reads a stored value that is not a theme as the design", () => {
    assert.equal(readTheme(null), null);
    assert.equal(readTheme({ light: { ink: "red" } }), null);
    assert.deepEqual(readTheme(DEFAULT_THEME), DEFAULT_THEME);
  });
});

describe("the readability guard", () => {
  it("measures contrast as WCAG does", () => {
    assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
    assert.equal(contrast("#ffffff", "#ffffff"), 1);
  });

  it("passes the design itself", () => {
    assert.equal(paletteProblem(DEFAULT_THEME), null);
  });

  it("refuses white on white, naming the pair and the ratio", () => {
    const theme = copy(DEFAULT_THEME);
    theme.light.ink = "#ffffff";
    const problem = paletteProblem(theme);
    assert.ok(problem);
    assert.match(
      problem,
      /^Light: Text \(#ffffff\) on Page \(#f1f3ec\) is 1\.1:1/,
    );
  });

  it("checks dark as well as light", () => {
    const theme = copy(DEFAULT_THEME);
    theme.dark.muted = "#1d2216";
    assert.match(paletteProblem(theme) ?? "", /^Dark: Secondary text/);
  });

  it("leaves taste alone: a navy brand with white buttons passes", () => {
    const theme: ThemeDto = copy(DEFAULT_THEME);
    for (const mode of ["light", "dark"] as const) {
      theme[mode].accent = "#1e3a8a";
      theme[mode]["accent-hover"] = "#1e40af";
      theme[mode]["on-accent"] = "#ffffff";
    }
    assert.equal(paletteProblem(theme), null);
  });
});

describe("the type", () => {
  it("offers only faces the design can name, each with its weights", () => {
    assert.equal(FONT_CHOICES[0].key, DEFAULT_TYPOGRAPHY.body.font);
    for (const font of FONT_CHOICES) assert.ok(font.min < font.max);
  });

  it("takes the design's own settings", () => {
    assert.ok(typographySchema.safeParse(DEFAULT_TYPOGRAPHY).success);
  });

  it("refuses a weight the face does not have, off the hundreds, or a size out of range", () => {
    const heavy = copy(DEFAULT_TYPOGRAPHY);
    heavy.heading = { font: "ibm-plex-sans", weight: 800, size: 28 };
    assert.equal(typographySchema.safeParse(heavy).success, false);
    const odd = copy(DEFAULT_TYPOGRAPHY);
    odd.body.weight = 450;
    assert.equal(typographySchema.safeParse(odd).success, false);
    const big = copy(DEFAULT_TYPOGRAPHY);
    big.body.size = 30;
    assert.equal(typographySchema.safeParse(big).success, false);
    const font = copy(DEFAULT_TYPOGRAPHY) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    font.body.font = "comic-sans";
    assert.equal(typographySchema.safeParse(font).success, false);
    assert.equal(readTypography(font), null);
  });
});

describe("the CSS", () => {
  it("writes nothing for the design — NULL, or values equal to it", () => {
    assert.equal(appearanceCss({ theme: null, typography: null }), "");
    assert.equal(typographyCss(copy(DEFAULT_TYPOGRAPHY)), "");
  });

  it("redefines every token for light and dark, beating the stylesheet by specificity", () => {
    const css = themeCss(DEFAULT_THEME);
    assert.ok(
      css.startsWith(':root:not([data-theme="dark"]){--sv-bg:#f1f3ec;'),
    );
    assert.ok(css.includes(':root:root[data-theme="dark"]{--sv-bg:#0c0f08;'));
    assert.equal(css.match(/--sv-/g)?.length, THEME_TOKENS.length * 2 + 1);
  });

  it("moves the page with the body size, and divides it back out of headings and buttons", () => {
    const settings: TypographySettings = copy(DEFAULT_TYPOGRAPHY);
    settings.body.size = 16;
    settings.heading.size = 28;
    const css = typographyCss(settings);
    assert.match(css, /html\{zoom:1\.103\}/);
    // Headings stay at 28px: 28/28 over 16/14.5.
    assert.match(css, /h1,h2,h3,h4,h5,h6\{zoom:0\.906\}/);
    assert.match(css, /\.sv-button\{zoom:0\.906\}/);
  });

  it("writes all three faces once any changes, weights only where changed", () => {
    const settings: TypographySettings = copy(DEFAULT_TYPOGRAPHY);
    settings.body.font = "inter";
    settings.heading.weight = 700;
    const css = typographyCss(settings);
    assert.match(css, /:root:root\{--sv-font:"Inter Variable"/);
    assert.match(
      css,
      /h1,h2,h3,h4,h5,h6\{font-family:"Plus Jakarta Sans Variable"[^}]*!important\}/,
    );
    assert.match(css, /h1,h2,h3,h4,h5,h6\{font-weight:700!important\}/);
    assert.doesNotMatch(css, /body\{font-weight/);
    assert.doesNotMatch(css, /zoom/);
  });
});
