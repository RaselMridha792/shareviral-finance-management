import { canSeeCompensation } from "@finance/shared";

import { TeamMemberScreen } from "@/components/team/team-member-screen";
import { getSession } from "@/lib/api-client";
import { teamApi, type CompensationDto } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export default async function TeamMemberPage({
  params,
}: PageProps<"/team/[id]">) {
  const { id } = await params;

  const [member, user] = await Promise.all([teamApi.get(id), getSession()]);

  // Not fetched at all when the role cannot see pay — there is no request to
  // intercept and no payload to leak.
  let compensation: CompensationDto[] = [];
  if (canSeeCompensation(user?.role)) {
    compensation = await teamApi.compensation(id);
  }

  return <TeamMemberScreen member={member} compensation={compensation} />;
}
