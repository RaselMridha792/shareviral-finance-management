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
 * ABOUT THE ICONS, because this is the part somebody will want to change.
 *
 * The owner asked for icons and this app draws every icon from **lucide-react**,
 * which ships no brand marks at all — there is no Facebook, Instagram, LinkedIn
 * or X export in it, and `ls node_modules/lucide-react/dist/esm/icons` confirms
 * that across all 2,025 of them. Two honest options were open: add a
 * brand-icon dependency, or draw the platforms some other way.
 *
 * This is the second, because adding a package to a live finance app at three
 * in the morning without being asked is not a decision to make on somebody's
 * behalf. Each platform gets its own brand colour and its own short mark, which
 * is what the eye actually uses to pick LinkedIn out of a row — the blue and
 * the "in", not the rounded corners. It reads at a glance and it is honest
 * about being a chip rather than a slightly-wrong trademark.
 *
 * If the owner wants the real marks it is one dependency and one swap of this
 * table. Nothing else here has to change.
 */
const MARK: Record<SocialPlatform, { short: string; bg: string; fg: string }> = {
  linkedin: { short: "in", bg: "#0A66C2", fg: "#FFFFFF" },
  facebook: { short: "f", bg: "#1877F2", fg: "#FFFFFF" },
  instagram: { short: "ig", bg: "#E1306C", fg: "#FFFFFF" },
  x: { short: "X", bg: "#0F1419", fg: "#FFFFFF" },
  youtube: { short: "▶", bg: "#FF0000", fg: "#FFFFFF" },
  github: { short: "gh", bg: "#24292F", fg: "#FFFFFF" },
  whatsapp: { short: "wa", bg: "#25D366", fg: "#0B3D20" },
  telegram: { short: "tg", bg: "#26A5E4", fg: "#FFFFFF" },
  website: { short: "web", bg: "#475569", fg: "#FFFFFF" },
  other: { short: "•", bg: "#64748B", fg: "#FFFFFF" },
};

function Mark({ platform }: { platform: SocialPlatform }) {
  const mark = MARK[platform] ?? MARK.other;
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold leading-none"
      style={{ background: mark.bg, color: mark.fg }}
    >
      {mark.short}
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
