import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent";
import { ReceiptIcon } from "@phosphor-icons/react/dist/ssr/Receipt";
import { SparkleIcon } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { TrendUpIcon } from "@phosphor-icons/react/dist/ssr/TrendUp";

/**
 * The right-hand half of the sign-in page: what this app is, to somebody who
 * has not signed in yet. Nothing on it is live — it is the same four sentences
 * for everybody, and it says nothing a stranger at the door should not read.
 *
 * Its three optional parts drop out as the window gets shorter rather than
 * being squeezed: the badge below 640px of height, the module cards below 600.
 * The handoff did that with a resize listener; a media query does the same
 * without JavaScript, and on the first paint rather than after it.
 */
const MODULES = [
  {
    Icon: BankIcon,
    title: "Accounts & cash",
    note: "Balances, cash in and transfers",
  },
  {
    Icon: ReceiptIcon,
    title: "Expenses",
    note: "Operating costs and subscriptions",
  },
  { Icon: MoneyIcon, title: "Payroll", note: "Monthly runs and payslips" },
  {
    Icon: PercentIcon,
    title: "Tax & reports",
    note: "TDS and monthly statements",
  },
] as const;

export function BrandPanel() {
  return (
    <section
      aria-label="About ShareViral Finance"
      className="sv-login-brand sv-grid"
    >
      <div aria-hidden="true" className="sv-login-decor">
        <span className="glow" />
        <span className="halo" />
        <span className="halo-dashed" />
        <span className="haze" />
        <span className="chip" />
        <span className="dot" />
        <span className="hoop" />
      </div>

      <div className="relative flex flex-none items-center gap-3">
        <span className="grid size-[42px] place-items-center rounded-[11px] bg-(--sv-accent) text-(--sv-on-accent) shadow-[0_6px_16px_rgb(6_8_0/0.12)]">
          <TrendUpIcon weight="duotone" size={24} />
        </span>
        <div className="leading-[1.1]">
          <p className="text-[18px] font-extrabold tracking-[-0.02em]">
            ShareViral
          </p>
          <p className="text-[10.5px] tracking-[0.16em] text-(--sv-violet-ink) uppercase">
            Finance
          </p>
        </div>
      </div>

      <div className="relative flex min-h-0 max-w-[540px] flex-1 flex-col justify-center gap-[clamp(16px,3vh,28px)] py-[clamp(12px,2vh,24px)]">
        <div>
          <p className="sv-badge mb-[clamp(10px,1.8vh,16px)] hidden items-center gap-2 rounded-full bg-(--sv-surface) py-[5px] pr-3 pl-1.5 text-[12.5px] font-extrabold text-(--sv-ink-soft) [@media(min-height:640px)]:inline-flex">
            <span className="grid size-[22px] place-items-center rounded-full bg-(--sv-accent) text-(--sv-on-accent)">
              <SparkleIcon weight="duotone" size={13} />
            </span>
            Books, payroll and tax in one app
          </p>
          <h2 className="text-[clamp(28px,5vh,42px)] leading-[1.06] font-extrabold tracking-[-0.03em] text-balance">
            The company’s books, in one place.
          </h2>
          <p className="mt-[clamp(8px,1.4vh,12px)] max-w-[44ch] text-[15px] leading-normal text-pretty text-(--sv-body)">
            Record every taka as it moves, run payroll once a month and close
            each period with a statement that adds up.
          </p>
        </div>

        <div className="hidden max-w-[520px] [@media(min-height:600px)]:block">
          <p className="mb-2.5 text-[11px] font-extrabold tracking-[0.14em] text-(--sv-violet-ink) uppercase">
            What’s inside
          </p>
          <ul className="grid grid-cols-2 gap-2.5">
            {MODULES.map(({ Icon, title, note }) => (
              <li
                key={title}
                className="sv-module flex min-w-0 flex-col gap-2.5 rounded-[11px] bg-(--sv-surface) p-[13px]"
              >
                <span className="grid size-10 place-items-center rounded-[11px] bg-(--sv-accent) text-(--sv-on-accent)">
                  <Icon weight="duotone" size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] leading-[1.25] font-extrabold">
                    {title}
                  </span>
                  <span className="mt-[3px] block text-[12.5px] leading-[1.35] text-(--sv-muted)">
                    {note}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="relative flex flex-none items-center gap-2 text-[12px] text-(--sv-violet-ink)">
        <LockSimpleIcon weight="duotone" size={15} />
        Encrypted connection · ShareViral Finance
      </p>
    </section>
  );
}
