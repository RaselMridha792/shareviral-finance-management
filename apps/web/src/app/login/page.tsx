import { LoginForm } from "@/components/auth/login-form";
import { BrandMark } from "@/components/layout/brand-mark";

export const metadata = {
  title: "Sign in · SFM",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          {/* The mark carries its own rounded square, so it needs no coloured
              box behind it — the same component the signed-in rail uses. */}
          <BrandMark className="size-9 shrink-0" />
          <div>
            <p className="text-sm font-semibold tracking-tight">
              ShareViral Finance
            </p>
            <p className="text-xs text-muted-foreground">Management portal</p>
          </div>
        </div>

        <LoginForm next={next} />

        <p className="mt-6 text-xs text-muted-foreground">
          Company use only. Every sign-in attempt is recorded.
        </p>
      </div>
    </main>
  );
}
