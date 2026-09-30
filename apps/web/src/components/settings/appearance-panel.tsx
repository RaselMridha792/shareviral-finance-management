"use client";

import {
  DEFAULT_THEME,
  DEFAULT_TYPOGRAPHY,
  FONT_CHOICES,
  THEME_GROUPS,
  THEME_TOKEN_LABELS,
  TYPOGRAPHY_ROLES,
  TYPOGRAPHY_SIZES,
  fontOf,
  paletteProblem,
  themeCss,
  typographyCss,
  type FontKey,
  type ThemeDto,
  type ThemeToken,
  type TypographyRole,
  type TypographySettings,
} from "@finance/shared";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { PaletteIcon } from "@phosphor-icons/react/dist/ssr/Palette";
import { TextAaIcon } from "@phosphor-icons/react/dist/ssr/TextAa";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { settingsApi, type Appearance } from "@/lib/masters";

/**
 * Settings → Appearance (#124): the colours and typefaces every screen is
 * drawn in, for everybody.
 *
 * The owner, 30 Sep 2026: *"ami amader applications er color and fonts
 * gulake setting theke dynamic vabe control korbo"*. The design and the
 * reasons are the HR portal's Brief 3 (docs/briefs); the mechanism is
 * `@finance/shared`'s appearance.ts, and this panel previews with the same
 * functions the signed-in layout writes the saved choice with, so the two
 * cannot disagree about what a choice looks like.
 *
 * The preview is the whole app, live, while this panel is open — the colours
 * of the tab being edited, whichever theme the viewer is in — and it goes
 * when the panel does. Nobody else sees anything until Save.
 */
export function AppearancePanel({ initial }: { initial: Appearance }) {
  const [saved, setSaved] = useState<Appearance>(initial);

  return (
    <div className="flex flex-col gap-5">
      <ColoursCard saved={saved.theme} onSaved={(next) => setSaved(next)} />
      <TypeCard saved={saved.typography} onSaved={(next) => setSaved(next)} />
      <Specimen />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Saving                                                                     */
/* -------------------------------------------------------------------------- */

function useSave() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    which: string,
    call: () => Promise<Appearance>,
    done: (next: Appearance) => void,
    message: string,
  ) {
    setPending(which);
    setError(null);
    try {
      const next = await call();
      done(next);
      toast.show(message, "success");
      /* The layout's <style> is drawn on the server from the saved choice;
         this redraws it, so the app keeps the look once the panel closes. */
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That did not save. Try again.",
      );
    } finally {
      setPending(null);
    }
  }
  return { pending, error, run };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-(--sv-neg-tint) px-3 py-2 text-sm text-(--sv-neg)"
      data-appearance-error
    >
      {error}
    </p>
  );
}

/** Put back to the design, asked once in place — it is everybody's app. */
function ResetButton({
  what,
  disabled,
  pending,
  onReset,
}: {
  what: string;
  disabled: boolean;
  pending: boolean;
  onReset: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() => setAsking(true)}
        data-appearance-reset={what}
      >
        Reset to the design
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-(--sv-muted)">
        Every {what} back as the design has it, for everybody?
      </span>
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() => {
          setAsking(false);
          onReset();
        }}
        data-appearance-reset-confirm={what}
      >
        Yes, reset
      </Button>
      <Button type="button" size="sm" onClick={() => setAsking(false)}>
        Keep
      </Button>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Colours                                                                    */
/* -------------------------------------------------------------------------- */

type Mode = "light" | "dark";

function samePalette(a: ThemeDto, b: ThemeDto) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ColoursCard({
  saved,
  onSaved,
}: {
  saved: ThemeDto | null;
  onSaved: (next: Appearance) => void;
}) {
  const start = saved ?? DEFAULT_THEME;
  const [theme, setTheme] = useState<ThemeDto>(start);
  const [mode, setMode] = useState<Mode>("light");
  const { pending, error, run } = useSave();

  const problem = paletteProblem(theme);
  const dirty = !samePalette(theme, start);
  const isDesign = samePalette(theme, DEFAULT_THEME);

  function set(token: ThemeToken, value: string) {
    setTheme((current) => ({
      ...current,
      [mode]: { ...current[mode], [token]: value },
    }));
  }

  /*
   * The tab being edited, on whichever theme the viewer is in — but only
   * while it can be read. White text tried on a white card would otherwise
   * make this very panel unreadable, and the box to put it back is on it;
   * so an unreadable try keeps showing the last readable one, and the guard
   * below says why.
   */
  const shown = { light: theme[mode], dark: theme[mode] };
  const [readable, setReadable] = useState<ThemeDto>(shown);
  if (!paletteProblem(shown) && !samePalette(shown, readable)) {
    setReadable(shown);
  }
  const preview = themeCss(paletteProblem(shown) ? readable : shown);

  return (
    <Card>
      <style
        id="sv-appearance-preview-colours"
        dangerouslySetInnerHTML={{ __html: preview }}
      />
      <CardHeader
        title="Colours"
        icon={PaletteIcon}
        description="Every colour the design uses, in light and in dark. The app shows your changes as you make them; nobody else sees them until you save."
        action={
          <Segmented
            label="Which theme"
            value={mode}
            onChange={setMode}
            options={[
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
            ]}
          />
        }
      />
      <CardBody className="flex flex-col gap-6 px-5 py-5">
        {THEME_GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2.5">
            <div>
              <h3 className="text-[15px] font-extrabold">{group.title}</h3>
              <p className="text-[12.5px] text-(--sv-muted)">{group.note}</p>
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
              {group.tokens.map((token) => (
                <ColourRow
                  key={`${mode}-${token}`}
                  token={token}
                  value={theme[mode][token]}
                  onChange={(value) => set(token, value)}
                />
              ))}
            </div>
          </section>
        ))}

        {problem ? (
          <p
            role="alert"
            className="rounded-lg bg-(--sv-warn-tint) px-3 py-2 text-sm text-(--sv-warn)"
            data-appearance-problem
          >
            {problem} It cannot be saved until it can be read.
          </p>
        ) : null}
        <ErrorLine error={error} />

        <div className="flex flex-wrap items-center gap-2 border-t border-(--sv-line) pt-4">
          <Button
            type="button"
            variant="primary"
            disabled={!dirty || Boolean(problem) || pending !== null}
            onClick={() =>
              void run(
                "save",
                () => settingsApi.saveTheme(theme),
                onSaved,
                "Colours saved — everybody sees them now.",
              )
            }
            data-appearance-save="colours"
          >
            {pending === "save" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
            Save colours
          </Button>
          <Button
            type="button"
            disabled={!dirty}
            onClick={() => setTheme(start)}
          >
            Undo changes
          </Button>
          <span className="flex-1" />
          <ResetButton
            what="colour"
            disabled={(saved === null && isDesign) || pending !== null}
            pending={pending !== null}
            onReset={() =>
              void run(
                "reset",
                () => settingsApi.resetTheme(),
                (next) => {
                  setTheme(DEFAULT_THEME);
                  onSaved(next);
                },
                "Colours are the design's again.",
              )
            }
          />
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * One colour: the picker, its name and what it paints, and the hex — typed
 * or pasted. A hex is taken only once it is a whole `#rrggbb`; half-typed, it
 * waits rather than painting the app in whatever it says so far.
 */
function ColourRow({
  token,
  value,
  onChange,
}: {
  token: ThemeToken;
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [last, setLast] = useState(value);
  /* Follows a change from outside — the picker, Undo, Reset, the tabs. */
  if (value !== last) {
    setLast(value);
    setText(value);
  }
  const label = THEME_TOKEN_LABELS[token];

  return (
    <div
      className="flex items-center gap-3 rounded-[11px] bg-(--sv-subtle) px-3 py-2.5"
      data-appearance-token={token}
    >
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        aria-label={`${label.label} colour`}
        className="size-9 flex-none cursor-pointer rounded-lg border border-(--sv-line) bg-transparent p-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-extrabold">{label.label}</p>
        <p className="truncate text-[12px] text-(--sv-muted)">{label.note}</p>
      </div>
      <input
        value={text}
        onChange={(event) => {
          const next = event.target.value.trim().toLowerCase();
          setText(next);
          if (/^#[0-9a-f]{6}$/.test(next)) onChange(next);
        }}
        onBlur={() => setText(value)}
        maxLength={7}
        spellCheck={false}
        aria-label={`${label.label} hex`}
        className="num h-9 w-[92px] flex-none rounded-lg border border-(--sv-line) bg-(--sv-surface) px-2 text-[13px]"
        data-appearance-hex={token}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Type                                                                       */
/* -------------------------------------------------------------------------- */

const ROLE_NAMES: Record<TypographyRole, string> = {
  heading: "Headings",
  body: "Text",
  button: "Buttons",
};

function TypeCard({
  saved,
  onSaved,
}: {
  saved: TypographySettings | null;
  onSaved: (next: Appearance) => void;
}) {
  const start = saved ?? DEFAULT_TYPOGRAPHY;
  const [type, setType] = useState<TypographySettings>(start);
  const { pending, error, run } = useSave();
  const dirty = JSON.stringify(type) !== JSON.stringify(start);
  const isDesign = JSON.stringify(type) === JSON.stringify(DEFAULT_TYPOGRAPHY);

  function set(
    role: TypographyRole,
    change: Partial<TypographySettings[TypographyRole]>,
  ) {
    setType((current) => {
      const next = { ...current[role], ...change };
      /* A face that does not carry the weight takes its nearest one. */
      const font = fontOf(next.font);
      next.weight = Math.min(font.max, Math.max(font.min, next.weight));
      return { ...current, [role]: next };
    });
  }

  return (
    <Card>
      <style
        id="sv-appearance-preview-type"
        dangerouslySetInnerHTML={{ __html: typographyCss(type) }}
      />
      <CardHeader
        title="Typefaces and sizes"
        icon={TextAaIcon}
        description="For headings, the text you read, and buttons. A size moves that whole scale in step, so the design's larger and smaller stay as drawn."
      />
      <CardBody className="flex flex-col gap-4 px-5 py-5">
        {TYPOGRAPHY_ROLES.map((role) => {
          const style = type[role];
          const font = fontOf(style.font);
          const size = TYPOGRAPHY_SIZES[role];
          const weights: number[] = [];
          for (let w = font.min; w <= font.max; w += 100) weights.push(w);
          return (
            <div
              key={role}
              className="grid grid-cols-1 gap-3 rounded-[11px] bg-(--sv-subtle) px-4 py-3.5 md:grid-cols-[140px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-start"
              data-appearance-role={role}
            >
              <p className="pt-2 text-[14.5px] font-extrabold">
                {ROLE_NAMES[role]}
              </p>
              <Field label="Typeface" hint={font.note}>
                <Select
                  value={style.font}
                  onChange={(event) =>
                    set(role, { font: event.target.value as FontKey })
                  }
                  data-appearance-font={role}
                >
                  {FONT_CHOICES.map((choice) => (
                    <option key={choice.key} value={choice.key}>
                      {choice.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Weight" hint={`${font.min} to ${font.max}`}>
                <Select
                  value={String(style.weight)}
                  onChange={(event) =>
                    set(role, { weight: Number(event.target.value) })
                  }
                  data-appearance-weight={role}
                >
                  {weights.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Size (px)"
                hint={`${size.reference}; ${size.min} to ${size.max}`}
              >
                <SizeInput
                  value={style.size}
                  min={size.min}
                  max={size.max}
                  step={size.step}
                  onChange={(value) => set(role, { size: value })}
                  role={role}
                />
              </Field>
            </div>
          );
        })}

        <ErrorLine error={error} />

        <div className="flex flex-wrap items-center gap-2 border-t border-(--sv-line) pt-4">
          <Button
            type="button"
            variant="primary"
            disabled={!dirty || pending !== null}
            onClick={() =>
              void run(
                "save",
                () => settingsApi.saveTypography(type),
                onSaved,
                "Type saved — everybody sees it now.",
              )
            }
            data-appearance-save="type"
          >
            {pending === "save" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
            Save type
          </Button>
          <Button
            type="button"
            disabled={!dirty}
            onClick={() => setType(start)}
          >
            Undo changes
          </Button>
          <span className="flex-1" />
          <ResetButton
            what="typeface and size"
            disabled={(saved === null && isDesign) || pending !== null}
            pending={pending !== null}
            onReset={() =>
              void run(
                "reset",
                () => settingsApi.resetTypography(),
                (next) => {
                  setType(DEFAULT_TYPOGRAPHY);
                  onSaved(next);
                },
                "Type is the design's again.",
              )
            }
          />
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * A size, typed. It takes a figure only when it is one the control allows —
 * in range, on the step — and otherwise waits, so typing "1" on the way to
 * "16" does not shrink the whole app to 1px for a keystroke.
 */
function SizeInput({
  value,
  min,
  max,
  step,
  onChange,
  role,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  role: TypographyRole;
}) {
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(String(value));
  }
  return (
    <Input
      value={text}
      inputMode="decimal"
      className="num"
      onChange={(event) => {
        setText(event.target.value);
        const n = Number(event.target.value);
        if (
          Number.isFinite(n) &&
          n >= min &&
          n <= max &&
          Math.abs(n / step - Math.round(n / step)) < 1e-9
        )
          onChange(n);
      }}
      onBlur={() => setText(String(value))}
      data-appearance-size={role}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  How it reads                                                               */
/* -------------------------------------------------------------------------- */

/** A little of everything, drawn from the live properties — a proof sheet. */
function Specimen() {
  return (
    <Card>
      <CardHeader
        title="How it reads"
        icon={EyeIcon}
        description="Drawn from the same colours and type as every screen."
      />
      <CardBody
        className="flex flex-col gap-4 px-5 py-5"
        data-appearance-specimen
      >
        <h2 className="text-[22px] font-extrabold tracking-[-0.02em]">
          Salary sheet — September 2026
        </h2>
        <p className="max-w-[70ch] text-sm">
          Twelve people are paid from M/S. EXPROVIA on 30/09/2026. The bank file
          is ready; the payslips go out once the sheet is marked paid.{" "}
          <a href="#specimen" className="text-(--link) underline">
            Open the bank advice
          </a>
        </p>
        <div className="grid max-w-[520px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          <span className="text-(--sv-muted)">Gross</span>
          <span className="num text-right">৳ 12,48,500.00</span>
          <span className="text-(--sv-muted)">Tax withheld</span>
          <span className="num text-right text-(--sv-neg)">− ৳ 41,120.50</span>
          <span className="text-(--sv-muted)">Received this month</span>
          <span className="num text-right text-(--sv-pos)">
            + ৳ 9,80,000.00
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary">
            Mark as paid
          </Button>
          <Button type="button">Download CSV</Button>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
          <span className="rounded-full bg-(--sv-pos-tint) px-2.5 py-1 text-[12px] font-extrabold text-(--sv-pos)">
            Paid
          </span>
          <span className="rounded-full bg-(--sv-warn-tint) px-2.5 py-1 text-[12px] font-extrabold text-(--sv-warn)">
            Waiting
          </span>
          <span className="rounded-full bg-(--sv-neg-tint) px-2.5 py-1 text-[12px] font-extrabold text-(--sv-neg)">
            Refused
          </span>
          <span className="rounded-full bg-(--sv-violet-tint) px-2.5 py-1 text-[12px] font-extrabold text-(--sv-violet-ink)">
            Selected
          </span>
          <span className="rounded-full bg-(--sv-violet) px-2 py-0.5 text-[11px] font-extrabold text-white">
            12
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
