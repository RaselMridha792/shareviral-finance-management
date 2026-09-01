"use client";

import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  socialUrl,
  type SocialPlatform,
} from "@finance/shared";
import { LoaderCircle, Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { teamApi, type TeamSocialDto } from "@/lib/payroll";
import { BRAND_MARKS } from "./brand-marks";

/**
 * Where somebody can be found, on a team member's profile.
 *
 * The owner: *"Team member ar social media add korte hobe eta ekta section
 * thakbe jekhane tara add new add new kore social media account add korte
 * parbe. eta obossoi icons soho hobe."*
 *
 * The whole list is sent in one request rather than a row at a time — the shape
 * the payroll picker and the subscription seats already use. A list somebody
 * edits has one truth, its final state, and one request means one audit row
 * instead of three that have to be read together.
 */

/**
 * ABOUT THE ICONS.
 *
 * The owner asked for real logos, and lucide-react — which draws every other
 * icon in this app — ships none: 2,000-odd icons and not one brand. So seven of
 * the ten platforms draw their actual mark, inlined from simple-icons (CC0) in
 * `brand-marks.ts`; see that file for why the paths are written down rather
 * than imported.
 *
 * The other three keep the lettered chip:
 *
 *   linkedin  simple-icons removed it after a trademark request, so there is no
 *             CC0 mark. An approximation of a trademark is worse than none, and
 *             the LinkedIn blue with "in" on it is what the eye uses to find it
 *             in a row anyway.
 *   website   has no brand by definition.
 *   other     likewise.
 *
 * Both shapes are the same size and sit on the same baseline, so a row mixing
 * them reads as one row rather than as two kinds of thing.
 */
const CHIP: Record<string, { short: string; bg: string; fg: string }> = {
  linkedin: { short: "in", bg: "#0A66C2", fg: "#FFFFFF" },
  website: { short: "web", bg: "#475569", fg: "#FFFFFF" },
  other: { short: "•", bg: "#64748B", fg: "#FFFFFF" },
};

function Mark({ platform }: { platform: SocialPlatform }) {
  const brand = BRAND_MARKS[platform];
  if (brand) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        role="img"
        className="size-5 shrink-0"
        fill={brand.hex}
      >
        <path d={brand.path} />
      </svg>
    );
  }

  const chip = CHIP[platform] ?? CHIP.other;
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold leading-none"
      style={{ background: chip.bg, color: chip.fg }}
    >
      {chip.short}
    </span>
  );
}

export function SocialAccounts({
  memberId,
  memberName,
  socials,
  canWrite,
  onSaved,
}: {
  memberId: string;
  memberName: string;
  socials: TeamSocialDto[];
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Social media"
        description="Where they can be found"
        action={
          canWrite ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Plus className="size-3.5" />
              {socials.length ? "Edit" : "Add"}
            </Button>
          ) : null
        }
      />
      <CardBody>
        {socials.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing recorded. {canWrite ? "Add an account above." : null}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {socials.map((one) => {
              const href = socialUrl(one.platform, one.handle);
              const label = SOCIAL_PLATFORM_LABELS[one.platform] ?? one.platform;
              const body = (
                <>
                  <Mark platform={one.platform} />
                  <span className="min-w-0">
                    <span className="block text-xs text-muted-foreground">
                      {label}
                    </span>
                    <span className="block max-w-52 truncate text-sm">
                      {one.handle}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={one.id}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      /* Third-party addresses typed by whoever added them —
                         `noopener` is worth ruling out once rather than per
                         link. */
                      rel="noreferrer noopener"
                      title={`Open ${label}`}
                      className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 transition hover:border-link hover:bg-surface-muted"
                    >
                      {body}
                    </a>
                  ) : (
                    /* A phone number is not a path, and "other" is by
                       definition unknown. Plain text beats a link that lands
                       somewhere wrong. */
                    <span
                      title={`${label} — nothing to open`}
                      className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1.5"
                    >
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>

      {editing ? (
        <SocialsForm
          memberId={memberId}
          memberName={memberName}
          socials={socials}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      ) : null}
    </Card>
  );
}

/** One row being edited. `key` is local — the saved rows have no stable one. */
type Draft = { key: number; platform: SocialPlatform; handle: string };

function SocialsForm({
  memberId,
  memberName,
  socials,
  onClose,
  onSaved,
}: {
  memberId: string;
  memberName: string;
  socials: TeamSocialDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Draft[]>(() =>
    socials.map((one, index) => ({
      key: index,
      platform: one.platform,
      handle: one.handle,
    })),
  );
  const [nextKey, setNextKey] = useState(socials.length);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The platforms not already on the list, so "add another" cannot offer a
     duplicate the server would refuse. */
  const free = SOCIAL_PLATFORMS.filter(
    (id) => !rows.some((row) => row.platform === id),
  );

  const add = () => {
    const platform = free[0] ?? "other";
    setRows((current) => [...current, { key: nextKey, platform, handle: "" }]);
    setNextKey((n) => n + 1);
  };

  async function save() {
    setPending(true);
    setError(null);
    try {
      await teamApi.setSocials(memberId, {
        /* Blank rows are dropped rather than refused: somebody who added a row
           and changed their mind should be able to save, not hunt for the one
           empty box. */
        socials: rows
          .filter((row) => row.handle.trim() !== "")
          .map((row) => ({ platform: row.platform, handle: row.handle.trim() })),
      });
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "That did not save.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${memberName} — social media`}
      description="One account per platform. The handle or the whole address, whichever you have."
    >
      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on the list yet.
          </p>
        ) : null}

        {rows.map((row, index) => (
          <div key={row.key} className="flex items-end gap-2">
            <Field label={index === 0 ? "Platform" : ""} className="w-40 shrink-0">
              <Select
                value={row.platform}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((one) =>
                      one.key === row.key
                        ? {
                            ...one,
                            platform: event.target.value as SocialPlatform,
                          }
                        : one,
                    ),
                  )
                }
              >
                {SOCIAL_PLATFORMS.map((id) => (
                  <option
                    key={id}
                    value={id}
                    /* Already on the list, unless it is this row's own. */
                    disabled={
                      id !== row.platform &&
                      rows.some((one) => one.platform === id)
                    }
                  >
                    {SOCIAL_PLATFORM_LABELS[id]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={index === 0 ? "Handle or address" : ""}
              className="min-w-0 flex-1"
            >
              <Input
                value={row.handle}
                maxLength={300}
                placeholder="@nizam  or  https://…"
                onChange={(event) =>
                  setRows((current) =>
                    current.map((one) =>
                      one.key === row.key
                        ? { ...one, handle: event.target.value }
                        : one,
                    ),
                  )
                }
              />
            </Field>

            <button
              type="button"
              onClick={() =>
                setRows((current) => current.filter((one) => one.key !== row.key))
              }
              aria-label="Remove this account"
              title="Remove this account"
              className="mb-1 cursor-pointer rounded p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-negative"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}

        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={add}
            /* Ten platforms, one account each — there is nothing left to add
               once they are all on the list. */
            disabled={free.length === 0}
          >
            <Plus className="size-3.5" />
            Add another
          </Button>
        </div>

        {error ? <p className="text-sm text-negative">{error}</p> : null}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          onClick={() => void save()}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </Drawer>
  );
}
