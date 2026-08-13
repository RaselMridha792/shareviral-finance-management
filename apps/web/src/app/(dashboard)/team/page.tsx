import { TeamScreen } from "@/components/team/team-screen";
import { teamApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team · SFM" };

export default async function TeamPage() {
  const page = await teamApi.list();
  return <TeamScreen initialPage={page} />;
}
