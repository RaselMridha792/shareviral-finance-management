import { canSeeCompensation, hasPermission } from "@finance/shared";

import { TeamMemberScreen } from "@/components/team/team-member-screen";
import { getSession } from "@/lib/api-client";
import {
  payrollApi,
  teamApi,
  type CompensationDto,
  type MemberPayslipDto,
} from "@/lib/payroll";

export const dynamic = "force-dynamic";

export default async function TeamMemberPage({
  params,
}: PageProps<"/team/[id]">) {
  const { id } = await params;

  const [member, user] = await Promise.all([teamApi.get(id), getSession()]);

  // Not fetched at all when the role cannot see pay — there is no request to
  // intercept and no payload to leak.
  //
  // Payslips are behind `payroll.read`, a second permission that `canSeeCompensation`
  // says nothing about. Every role holding one holds the other today, but this
  // asks rather than assumes: the day that stops being true, the page renders
  // without the card instead of throwing a 403 at whoever opens the tab.
  let compensation: CompensationDto[] = [];
  let payslips: MemberPayslipDto[] = [];
  if (canSeeCompensation(user?.role)) {
    [compensation, payslips] = await Promise.all([
      teamApi.compensation(id),
      hasPermission(user?.role, "payroll.read")
        ? payrollApi.memberPayslips(id)
        : Promise.resolve<MemberPayslipDto[]>([]),
    ]);
  }

  return (
    <TeamMemberScreen
      member={member}
      compensation={compensation}
      payslips={payslips}
    />
  );
}
