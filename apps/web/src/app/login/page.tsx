import { todayInDhaka } from "@finance/shared";

import { BrandPanel } from "@/components/auth/brand-panel";
import { LoginForm, type ArrivalNotice } from "@/components/auth/login-form";

export const metadata = {
  title: "Sign in · SFM",
};

export const dynamic = "force-dynamic";

/**
 * Sign-in, as the September 2026 handoff draws it: the form on the left, what
 * the app is on the right, and below 860px only the form.
 *
 * The form comes first in the document as well as on screen, so a keyboard or
 * a screen reader reaches the fields before the brochure.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  /** Why they are back here, when something sent them. */
  const notice: ArrivalNotice | null =
    params.reason === "idle"
      ? "idle"
      : params.reason === "signed-out"
        ? "signed-out"
        : null;
  /*
   * Read here, on each request, and never as NEXT_PUBLIC_: those are inlined
   * when CI builds the image, so a key could not be set or taken off without
   * a rebuild. No key, no box (captcha.service.ts is off without its secret).
   */
  const captchaSiteKey = process.env.TURNSTILE_SITE_KEY?.trim() || null;

  return (
    <main className="sv sv-light sv-login">
      <section className="flex min-w-0 flex-1 flex-col bg-(--sv-surface) px-[clamp(24px,3vw,44px)] py-[clamp(14px,3vh,28px)]">
        <LoginForm
          next={next}
          notice={notice}
          captchaSiteKey={captchaSiteKey}
        />

        <p className="flex-none text-[12px] text-(--sv-muted)">
          © {todayInDhaka().slice(0, 4)} ShareViral
        </p>
      </section>

      <BrandPanel />
    </main>
  );
}
