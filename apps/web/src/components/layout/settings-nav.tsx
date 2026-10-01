"use client";

import { hasPermission, type Role } from "@finance/shared";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  settingsSectionFor,
  type SettingsSection,
  type SettingsSectionId,
} from "@/components/settings/sections";
import { aiApi } from "@/lib/ai";
import { emailApi, trashApi } from "@/lib/api-client";
import { auditApi } from "@/lib/audit";
import { connectionsApi } from "@/lib/connections";
import { usersApi } from "@/lib/users";
import { cn } from "@/lib/utils";
import { useRailCompact } from "@/components/layout/sidebar-state";

/**
 * The rail while Settings is open, as the September 2026 handoff draws it.
 *
 * The main nav steps aside for a way back to the dashboard and Settings' own
 * sections, grouped, each with its icon tile, its name and a line under it —
 * in place of the row of tabs the screen used to carry.
 *
 * A section is a `?tab=` on the same page, changed with `history.pushState`
 * rather than a navigation: Next keeps `useSearchParams` in step with it, the
 * screen redraws its panel from the new value, and the page's own data — the
 * settings, the category tree, the user list — is not fetched again for what
 * is only a different panel of it. Back and forward walk the sections.
 */

type Badge = { text: string; tone: "count" | "positive" | "off" | "warning" };

const BADGE_TONES: Record<Badge["tone"], string> = {
  count: "bg-(--sv-violet) text-white",
  positive: "bg-(--sv-pos-tint) text-(--sv-pos)",
  off: "bg-(--sv-subtle) text-(--sv-muted)",
  warning: "bg-(--sv-warn-tint) text-(--sv-warn)",
};

/**
 * The counts and states beside a section's name: how many people can sign in,
 * how long the trail is, what is in the trash, whether the assistant and the
 * mail are switched on.
 *
 * Each is asked for only when this reader may open the section, and each is
 * on its own — one that fails leaves its section without a badge rather than
 * taking the others with it. A badge is a hint, not a figure anybody files.
 */
function useBadges(role: Role | undefined) {
  const [badges, setBadges] = useState<
    Partial<Record<SettingsSectionId, Badge>>
  >({});

  useEffect(() => {
    let live = true;
    const put = (id: SettingsSectionId, badge: Badge | null) => {
      if (live && badge) setBadges((current) => ({ ...current, [id]: badge }));
    };
    const allowed = (id: SettingsSectionId) =>
      canOpen(
        role,
        SETTINGS_SECTIONS.find((section) => section.id === id)!,
      );
    const count = (n: number): Badge | null =>
      n > 0 ? { text: n.toLocaleString("en-US"), tone: "count" } : null;

    if (allowed("users"))
      usersApi
        .list()
        .then((page) => put("users", count(page.total)))
        .catch(() => {});
    if (allowed("audit"))
      auditApi
        .list()
        .then((page) => put("audit", count(page.total)))
        .catch(() => {});
    trashApi
      .summary()
      .then((kinds) =>
        put("trashed", count(kinds.reduce((sum, kind) => sum + kind.count, 0))),
      )
      .catch(() => {});
    if (allowed("assistant"))
      aiApi
        .availability()
        .then((status) =>
          put(
            "assistant",
            status.configured
              ? { text: "On", tone: "positive" }
              : { text: "Off", tone: "off" },
          ),
        )
        .catch(() => {});
    if (allowed("connections"))
      connectionsApi
        .google()
        .then((google) =>
          put(
            "connections",
            google.configured
              ? { text: "On", tone: "positive" }
              : { text: "Off", tone: "off" },
          ),
        )
        .catch(() => {});
    if (allowed("email"))
      emailApi
        .status()
        .then((status) =>
          put(
            "email",
            status.blockedBy
              ? { text: "Not sending", tone: "warning" }
              : { text: "Ready", tone: "positive" },
          ),
        )
        .catch(() => {});

    // Once per visit to Settings: the rail is not unmounted between sections.
    return () => {
      live = false;
    };
  }, [role]);

  return badges;
}

function canOpen(role: Role | undefined, section: SettingsSection) {
  return !section.permission || hasPermission(role, section.permission);
}

export function SettingsNav({ onNavigate }: { onNavigate?: () => void }) {
  const role = useSession().role;
  const can = (section: SettingsSection) => canOpen(role, section);
  const current = settingsSectionFor(useSearchParams().get("tab"), can);
  const badges = useBadges(role);
  /* The icons-only rail (1 Oct 2026): each section its tile, named on
     hover; the groups kept apart by a hairline, the badges left out. */
  const compact = useRailCompact();

  return (
    <nav
      aria-label="Settings"
      className={cn(
        "flex flex-1 flex-col overflow-x-hidden overflow-y-auto pt-3 pb-4",
        compact ? "px-2" : "px-2.5",
      )}
    >
      <Link
        href="/"
        onClick={onNavigate}
        aria-label={compact ? "Back to dashboard" : undefined}
        title={compact ? "Back to dashboard" : undefined}
        className={cn(
          "sv-button-quiet mb-2 flex items-center gap-[11px] rounded-[11px] bg-(--sv-subtle) text-[14px] font-extrabold",
          compact ? "justify-center py-[9px]" : "py-[9px] pr-3 pl-[9px]",
        )}
      >
        <span className="sv-back-tile grid size-8 flex-none place-items-center rounded-lg bg-(--sv-surface)">
          <ArrowLeftIcon
            weight="duotone"
            size={17}
            className="text-(--sv-violet)"
          />
        </span>
        {compact ? null : "Back to dashboard"}
      </Link>

      <p
        className={cn(
          "flex items-center gap-[9px] pt-2 pb-0.5 text-[17px] font-extrabold",
          compact ? "justify-center" : "px-3",
        )}
        title={compact ? "Settings" : undefined}
      >
        <GearSixIcon
          weight="duotone"
          size={20}
          className="text-(--sv-violet)"
        />
        {compact ? null : "Settings"}
      </p>

      {SETTINGS_GROUPS.map((group) => {
        const sections = SETTINGS_SECTIONS.filter(
          (section) => section.group === group && can(section),
        );
        if (sections.length === 0) return null;
        return (
          <div key={group} className="flex flex-col">
            {compact ? (
              <span
                aria-hidden="true"
                className="mx-3 my-2.5 h-px bg-(--sv-line)"
              />
            ) : (
              <p className="px-3 pt-3.5 pb-1.5 text-[11px] font-extrabold tracking-[0.14em] whitespace-nowrap text-(--sv-muted) uppercase">
                {group}
              </p>
            )}
            {sections.map((section) => {
              const active = section.id === current.id;
              const badge = badges[section.id];
              const Glyph = section.icon;
              return (
                <a
                  key={section.id}
                  href={`/settings?tab=${section.id}`}
                  aria-current={active ? "page" : undefined}
                  data-active={active || undefined}
                  onClick={(event) => {
                    // A new tab or window is a real navigation; leave it be.
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.button !== 0
                    )
                      return;
                    event.preventDefault();
                    if (!active)
                      window.history.pushState(
                        null,
                        "",
                        `/settings?tab=${section.id}`,
                      );
                    window.scrollTo(0, 0);
                    onNavigate?.();
                  }}
                  aria-label={compact ? section.label : undefined}
                  title={compact ? section.label : undefined}
                  className={cn(
                    "sv-nav-row mb-[3px] flex w-full items-center gap-[11px] rounded-[11px] py-2",
                    compact ? "justify-center" : "pr-2.5 pl-[9px]",
                  )}
                >
                  <span className="sv-nav-tile grid size-8 flex-none place-items-center rounded-lg">
                    <Glyph weight="duotone" size={18} />
                  </span>
                  {compact ? null : (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-extrabold">
                        {section.label}
                      </span>
                      <span className="block truncate text-[12px] font-semibold text-(--sv-muted)">
                        {section.hint}
                      </span>
                    </span>
                  )}
                  {badge && !compact ? (
                    <span
                      className={cn(
                        "flex-none rounded-full px-2 py-[3px] text-[10.5px] font-extrabold tabular-nums",
                        BADGE_TONES[badge.tone],
                      )}
                    >
                      {badge.text}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
