"use client";

import { useUsdRateContext } from "@/components/money/rate-provider";
import { useSettings } from "@/components/settings-provider";
import { formatDate } from "@/lib/utils";

/**
 * Where the dollar figures come from, said once for the whole app.
 *
 * Every taka amount in this system now carries a dollar equivalent under it, on
 * every screen. That was the point — the CEO funds the company in dollars and
 * reads in them — but it quietly broke a rule this app is built on: a
 * translated figure must say what rate produced it, or it is a number nobody
 * can check. Eight screens were showing `~$24,126.80` with nothing anywhere on
 * the page to say what that was worked out from.
 *
 * It sits in the shell rather than on each page for two reasons. One rate
 * governs the whole app, so repeating the sentence per screen would be saying
 * the same thing eight times. And the owner had the dashboard's version removed
 * for exactly that reason — it restated on every visit something worth knowing
 * once. This is that one place: a single quiet line at the foot of the page,
 * out of the way of the figures, and always there when there are figures to
 * explain.
 *
 * Nothing is drawn when no rate is on file. The dollar lines are not drawn
 * either in that case, so a caption would be explaining figures that are not
 * there.
 */
export function RateCaption() {
  const usd = useUsdRateContext();
  const settings = useSettings();

  if (!usd) return null;

  return (
    <p className="border-t border-border pt-4 text-xs text-muted-foreground">
      Dollar figures are approximate, translated from {settings.baseCurrency} at{" "}
      <span className="num">{usd.rate.toFixed(2)}</span> per USD
      {usd.asOf ? <> as of {formatDate(usd.asOf)}</> : null}. Every amount in
      this system is recorded in {settings.baseCurrency}.
    </p>
  );
}
