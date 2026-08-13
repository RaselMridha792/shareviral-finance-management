import { LoginForm } from "@/components/auth/login-form";

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
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            SFM
          </span>
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
