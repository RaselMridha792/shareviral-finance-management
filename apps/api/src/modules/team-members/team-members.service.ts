import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  canSeeCompensation,
  formatMoney,
  type CreateTeamMemberInput,
  type ListTeamQuery,
  type Paginated,
  type SetCompensationInput,
  type UpdateTeamMemberInput,
} from "@finance/shared";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { compensationHistory, teamMembers } from "../../db/schema";

/**
 * What anyone who can read the team may see about a person.
 *
 * The only money on it is `joiningSalary`, the figure agreed at hire — HR's own
 * paperwork, fixed on the joining date, and intentionally visible to them.
 *
 * Everything about what somebody is paid *now* is fetched separately through a
 * separately-gated endpoint, and this projection never joins
 * `compensation_history`. So no shape of this object can carry a current
 * salary, a raise, or a payroll figure — only the one number from the offer.
 */
export type TeamMemberDto = {
  id: string;
  employeeCode: string;
  fullName: string;
  engagementType: "employee" | "contractor";
  department: string | null;
  designation: string | null;
  joinedOn: string;
  endedOn: string | null;
  status: "active" | "on_leave" | "resigned" | "terminated";
  personalEmail: string | null;
  workEmail: string | null;
  phone: string | null;
  nid: string | null;
  etin: string | null;
  psrStatus: "unknown" | "submitted" | "not_submitted";
  psrAssessmentYear: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankRouting: string | null;
  walletProvider: string | null;
  walletNumber: string | null;
  address: string | null;
  notes: string | null;

  /* The personal half. HR's business, and none of it is pay. */
  photoUrl: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  spouseName: string | null;
  fatherName: string | null;
  motherName: string | null;
  bloodGroup: string | null;
  religion: string | null;
  passportNumber: string | null;
  permanentAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  reportingManagerId: string | null;
  probationUntil: string | null;
  confirmedOn: string | null;

  /**
   * The figure agreed at hire — the one salary HR may see. Numeric comes back
   * from the driver as a string, like every other amount in this app.
   */
  joiningSalary: string | null;

  /** Superseded by the two below; still returned so old data is not orphaned. */
  lastQualification: string | null;
  educationLevel: string | null;
  educationMajor: string | null;

  /* Papers on file — links, never uploads. */
  cvUrl: string | null;
  appointmentLetterUrl: string | null;

  /** Resolved on the detail read only; the list does not join for it. */
  reportingManagerName?: string | null;
};

@Injectable()
export class TeamMembersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTeamQuery): Promise<Paginated<TeamMemberDto>> {
    const filters = [isNull(teamMembers.deletedAt)];
    if (query.engagementType)
      filters.push(eq(teamMembers.engagementType, query.engagementType));
    if (query.status) filters.push(eq(teamMembers.status, query.status));
    if (query.department)
      filters.push(eq(teamMembers.department, query.department));
    if (query.q) {
      const term = `%${query.q}%`;
      const match = or(
        ilike(teamMembers.fullName, term),
        ilike(teamMembers.employeeCode, term),
        ilike(teamMembers.designation, term),
        ilike(teamMembers.phone, term),
      );
      if (match) filters.push(match);
    }

    const where = and(...filters);
    const offset = (query.page - 1) * query.pageSize;

    const [items, [{ total }]] = await Promise.all([
      this.db.client
        .select(projection)
        .from(teamMembers)
        .where(where)
        .orderBy(asc(teamMembers.employeeCode))
        .limit(query.pageSize)
        .offset(offset),
      this.db.client.select({ total: count() }).from(teamMembers).where(where),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  /**
   * One person, with their manager's name resolved.
   *
   * A self-join rather than a foreign key: a manager who leaves is
   * soft-deleted, and a hard reference would either block that or drag the
   * reports' records along with it. A dangling id simply shows nothing.
   */
  async findOne(id: string): Promise<TeamMemberDto> {
    const manager = alias(teamMembers, "manager");

    const [row] = await this.db.client
      .select({
        ...projection,
        reportingManagerName: manager.fullName,
      })
      .from(teamMembers)
      .leftJoin(manager, eq(teamMembers.reportingManagerId, manager.id))
      .where(and(eq(teamMembers.id, id), isNull(teamMembers.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("No such team member");
    return row;
  }

  async create(input: CreateTeamMemberInput, actor: AuthenticatedUser) {
    await this.assertCodeFree(input.employeeCode);

    return this.audit.mutate({
      action: "create",
      entityTable: "team_members",
      summary: `Added ${input.fullName} (${input.employeeCode}) as ${input.engagementType}`,
      module: "team",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [row] = await tx
          .insert(teamMembers)
          .values({ ...input, createdBy: actor.id, updatedBy: actor.id })
          .returning(projection);
        return row;
      },
    });
  }

  async update(
    id: string,
    input: UpdateTeamMemberInput,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.findOne(id);

    if (
      input.employeeCode &&
      input.employeeCode.toLowerCase() !== existing.employeeCode.toLowerCase()
    ) {
      await this.assertCodeFree(input.employeeCode, id);
    }

    return this.audit.mutate({
      action: "update",
      entityTable: "team_members",
      entityId: id,
      summary: describeUpdate(existing, input),
      module: "team",
      read: async (tx) => {
        const [row] = await tx
          .select(projection)
          .from(teamMembers)
          .where(eq(teamMembers.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(teamMembers)
          .set({ ...input, updatedAt: new Date(), updatedBy: actor.id })
          .where(eq(teamMembers.id, id))
          .returning(projection);
        return row;
      },
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Compensation — separately gated                                        */
  /* ---------------------------------------------------------------------- */

  async compensationHistory(teamMemberId: string) {
    await this.findOne(teamMemberId);

    return this.db.client
      .select()
      .from(compensationHistory)
      .where(eq(compensationHistory.teamMemberId, teamMemberId))
      .orderBy(desc(compensationHistory.effectiveFrom));
  }

  /** What someone was on for a given date — the figure payroll picks up. */
  async compensationOn(teamMemberId: string, date: string) {
    const [row] = await this.db.client
      .select()
      .from(compensationHistory)
      .where(
        and(
          eq(compensationHistory.teamMemberId, teamMemberId),
          sql`${compensationHistory.effectiveFrom} <= ${date}`,
        ),
      )
      .orderBy(desc(compensationHistory.effectiveFrom))
      .limit(1);

    return row ?? null;
  }

  async setCompensation(
    teamMemberId: string,
    input: SetCompensationInput,
    actor: AuthenticatedUser,
  ) {
    const member = await this.findOne(teamMemberId);

    const [clash] = await this.db.client
      .select({ id: compensationHistory.id })
      .from(compensationHistory)
      .where(
        and(
          eq(compensationHistory.teamMemberId, teamMemberId),
          eq(compensationHistory.effectiveFrom, input.effectiveFrom),
        ),
      )
      .limit(1);

    if (clash) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          effectiveFrom: ["A figure already starts on that date"],
        },
      });
    }

    return this.audit.mutate({
      action: "update",
      entityTable: "compensation_history",
      entityId: teamMemberId,
      summary: `Set ${member.fullName}'s pay to ${formatMoney(input.grossAmount)} from ${input.effectiveFrom}`,
      module: "team",
      // Salary figures must not be readable from the audit log by anyone
      // without permission to see them.
      isSensitive: true,
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(compensationHistory)
          .where(eq(compensationHistory.teamMemberId, teamMemberId))
          .orderBy(desc(compensationHistory.effectiveFrom))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        // Close the previous entry the day before this one starts.
        await tx
          .update(compensationHistory)
          .set({
            effectiveTo: sql`(${input.effectiveFrom}::date - interval '1 day')::date`,
          })
          .where(
            and(
              eq(compensationHistory.teamMemberId, teamMemberId),
              isNull(compensationHistory.effectiveTo),
              sql`${compensationHistory.effectiveFrom} < ${input.effectiveFrom}`,
            ),
          );

        const [row] = await tx
          .insert(compensationHistory)
          .values({
            teamMemberId,
            grossAmount: input.grossAmount,
            effectiveFrom: input.effectiveFrom,
            changeReason: input.changeReason,
            createdBy: actor.id,
          })
          .returning();
        return row;
      },
    });
  }

  /** Belt and braces on top of the endpoint guard. */
  assertCanSeeCompensation(actor: AuthenticatedUser) {
    if (!canSeeCompensation(actor.role)) {
      throw new NotFoundException("No such resource");
    }
  }

  private async assertCodeFree(code: string, exceptId?: string) {
    const [clash] = await this.db.client
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          sql`lower(${teamMembers.employeeCode}) = ${code.toLowerCase()}`,
          isNull(teamMembers.deletedAt),
        ),
      )
      .limit(1);

    if (clash && clash.id !== exceptId) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { employeeCode: ["That code is already used"] },
      });
    }
  }
}

const projection = {
  id: teamMembers.id,
  employeeCode: teamMembers.employeeCode,
  fullName: teamMembers.fullName,
  engagementType: teamMembers.engagementType,
  department: teamMembers.department,
  designation: teamMembers.designation,
  joinedOn: teamMembers.joinedOn,
  endedOn: teamMembers.endedOn,
  status: teamMembers.status,
  personalEmail: teamMembers.personalEmail,
  workEmail: teamMembers.workEmail,
  phone: teamMembers.phone,
  nid: teamMembers.nid,
  etin: teamMembers.etin,
  psrStatus: teamMembers.psrStatus,
  psrAssessmentYear: teamMembers.psrAssessmentYear,
  bankName: teamMembers.bankName,
  bankAccountNumber: teamMembers.bankAccountNumber,
  bankRouting: teamMembers.bankRouting,
  walletProvider: teamMembers.walletProvider,
  walletNumber: teamMembers.walletNumber,
  address: teamMembers.address,
  notes: teamMembers.notes,

  /**
   * The personal half of an employment record.
   *
   * All of it is HR's business. The salary boundary still holds where it
   * matters: `compensation_history` lives in its own table, this projection
   * does not join it, and adding fields here cannot reach it. The one money
   * column below is `joiningSalary`, which is on `team_members` by decision —
   * the offer figure, not the payroll one.
   */
  photoUrl: teamMembers.photoUrl,
  dateOfBirth: teamMembers.dateOfBirth,
  gender: teamMembers.gender,
  maritalStatus: teamMembers.maritalStatus,
  spouseName: teamMembers.spouseName,
  fatherName: teamMembers.fatherName,
  motherName: teamMembers.motherName,
  bloodGroup: teamMembers.bloodGroup,
  religion: teamMembers.religion,
  passportNumber: teamMembers.passportNumber,
  permanentAddress: teamMembers.permanentAddress,
  emergencyContactName: teamMembers.emergencyContactName,
  emergencyContactRelation: teamMembers.emergencyContactRelation,
  emergencyContactPhone: teamMembers.emergencyContactPhone,
  reportingManagerId: teamMembers.reportingManagerId,
  probationUntil: teamMembers.probationUntil,
  confirmedOn: teamMembers.confirmedOn,
  joiningSalary: teamMembers.joiningSalary,
  lastQualification: teamMembers.lastQualification,
  educationLevel: teamMembers.educationLevel,
  educationMajor: teamMembers.educationMajor,
  cvUrl: teamMembers.cvUrl,
  appointmentLetterUrl: teamMembers.appointmentLetterUrl,
};

function describeUpdate(
  existing: TeamMemberDto,
  input: UpdateTeamMemberInput,
): string {
  const parts: string[] = [];
  if (input.fullName && input.fullName !== existing.fullName) {
    parts.push(`renamed to ${input.fullName}`);
  }
  if (input.status && input.status !== existing.status) {
    parts.push(`status ${existing.status} → ${input.status}`);
  }
  if (input.designation && input.designation !== existing.designation) {
    parts.push(`designation → ${input.designation}`);
  }
  const detail = parts.length ? parts.join(", ") : "details updated";
  return `${existing.fullName} (${existing.employeeCode}): ${detail}`;
}
