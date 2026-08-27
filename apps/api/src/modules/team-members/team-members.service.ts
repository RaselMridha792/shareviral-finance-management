import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  canSeeCompensation,
  hasPermission,
  DEFAULT_SALARY_SPLIT,
  formatMoney,
  salarySplitSchema,
  splitSalary,
  todayInDhaka,
  type CreateTeamMemberInput,
  type ListTeamQuery,
  type Paginated,
  type SetCompensationInput,
  type UpdateTeamMemberInput,
} from "@finance/shared";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import {
  appSettings,
  compensationHistory,
  files,
  teamMembers,
} from "../../db/schema";

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
  fullName: string;
  engagementType: "employee" | "contractor";
  /** Null until somebody says. Not defaulted — see the migration's note. */
  employmentType: "onsite" | "remote" | "hybrid" | "contractual" | null;
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
  bloodGroup: string | null;
  permanentAddress: string | null;

  /**
   * Retained, no longer collected.
   *
   * Not on the company's employee sheet, so the form stopped offering them and
   * the shared schema stopped accepting them. Still read back, because rows
   * written before that decision carry values and a profile that silently
   * dropped them would look like data loss.
   */
  maritalStatus: string | null;
  spouseName: string | null;
  fatherName: string | null;
  motherName: string | null;
  religion: string | null;
  passportNumber: string | null;
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

  /**
   * Papers on file.
   *
   * These are Google Drive links, and they stay — eighteen people have values
   * in them. Since 2026-08-16 a record can also carry files this server holds;
   * those are fetched from `/files/team-member/:id`, which is where the
   * permission on a document that names a salary is applied.
   */
  cvUrl: string | null;
  appointmentLetterUrl: string | null;

  /**
   * The uploaded photograph, if there is one, as a file id.
   *
   * Optional because it is read with a subquery that `returning()` cannot run:
   * the create and update responses leave it out rather than claim there is no
   * photo. Present on every read — the list and the profile — which is where
   * anything renders a face.
   */
  photoFileId?: string | null;
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
        ilike(teamMembers.designation, term),
        ilike(teamMembers.phone, term),
      );
      if (match) filters.push(match);
    }

    const where = and(...filters);
    const offset = (query.page - 1) * query.pageSize;

    const [items, [{ total }]] = await Promise.all([
      this.db.client
        // `projection`, not `readProjection`: the directory is a table of
        // names and shows no faces, and a subquery per row for something no
        // screen renders is cost with nothing on the other side of it. When
        // the list grows avatars, this is the line that changes.
        .select(projection)
        .from(teamMembers)
        .where(where)
        .orderBy(asc(teamMembers.fullName))
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
   * One person.
   *
   * This used to self-join for the reporting manager's name. Nothing renders
   * that any more — the field is no longer collected — and a join whose result
   * reaches no screen is cost with nothing on the other side of it.
   */
  async findOne(id: string): Promise<TeamMemberDto> {
    const [row] = await this.db.client
      .select(readProjection)
      .from(teamMembers)
      .leftJoin(files, livePhoto)
      .where(and(eq(teamMembers.id, id), isNull(teamMembers.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("No such team member");
    return row;
  }

  async create(input: CreateTeamMemberInput, actor: AuthenticatedUser) {
    /*
     * `currentSalary` is not a team_members column and must not reach the
     * insert. It is pay, so it goes to compensation_history — inside the same
     * transaction, with its own sensitive audit row, exactly as a raise from
     * the Pay tab would be written.
     *
     * The permission check is here and not only in the form: HR holds
     * team.write and can open this drawer, but does not hold
     * team.compensation.write and must not gain a pay-write path through it.
     * A request carrying the field from a role without the permission is
     * refused loudly rather than quietly dropped — silence would teach the
     * sender the figure was saved.
     */
    const { currentSalary, ...memberInput } = input;
    if (currentSalary !== undefined) {
      if (!hasPermission(actor.role, "team.compensation.write")) {
        throw new ForbiddenException(
          "Setting pay needs the compensation permission — leave Current salary blank",
        );
      }
    }

    return this.audit.mutate({
      action: "create",
      entityTable: "team_members",
      summary: `Added ${input.fullName} as ${input.engagementType}`,
      module: "team",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [row] = await tx
          .insert(teamMembers)
          .values({ ...memberInput, createdBy: actor.id, updatedBy: actor.id })
          .returning(projection);

        if (currentSalary !== undefined) {
          /*
           * The split, worked out once and frozen with the figure — the same
           * snapshot setCompensation takes, for the same reason: the rule in
           * Settings can change, and this figure's breakdown must not.
           */
          const [settings] = await tx
            .select({ salarySplit: appSettings.salarySplit })
            .from(appSettings)
            .limit(1);
          const parsed = salarySplitSchema.safeParse(settings?.salarySplit);
          await tx.insert(compensationHistory).values({
            teamMemberId: row.id,
            grossAmount: currentSalary,
            components: splitSalary(
              currentSalary,
              parsed.success && parsed.data.length
                ? parsed.data
                : DEFAULT_SALARY_SPLIT,
            ),
            effectiveFrom: memberInput.joinedOn,
            changeReason: "Set when they were added",
            createdBy: actor.id,
          });
          await this.audit.record(tx, {
            action: "update",
            entityTable: "compensation_history",
            entityId: row.id,
            module: "team",
            isSensitive: true,
            summary: `Set ${memberInput.fullName}'s pay to ${formatMoney(currentSalary)} from ${memberInput.joinedOn}, given when they were added`,
          });
        }

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
      .where(
        and(
          isNull(compensationHistory.deletedAt),
          eq(compensationHistory.teamMemberId, teamMemberId),
        ),
      )
      .orderBy(desc(compensationHistory.effectiveFrom));
  }

  /** What someone was on for a given date — the figure payroll picks up. */
  async compensationOn(teamMemberId: string, date: string) {
    const [row] = await this.db.client
      .select()
      .from(compensationHistory)
      .where(
        and(
          // A deleted salary row must not decide anybody's pay.
          isNull(compensationHistory.deletedAt),
          eq(compensationHistory.teamMemberId, teamMemberId),
          sql`${compensationHistory.effectiveFrom} <= ${date}`,
        ),
      )
      .orderBy(desc(compensationHistory.effectiveFrom))
      .limit(1);

    return row ?? null;
  }

  /**
   * Give everyone with no pay on record the figure they were hired at.
   *
   * The salary sheet reads `compensation_history` — what somebody earns now,
   * and since when. `team_members.joiningSalary` is a different fact: what was
   * agreed on the day they joined. Eighteen people were imported with the
   * second and none of the first, so building a payroll run skipped every one
   * of them and the sheet came out empty, with no way forward but opening
   * eighteen profiles.
   *
   * Two decisions worth stating, because the easy version of this is wrong:
   *
   * The joining salary is **not** used silently at payroll time. It can be
   * years old, and a run that quietly pays somebody their 2024 figure is a
   * wrong payment nobody notices. This is an action a person takes, once, and
   * every row it writes is in the audit log with the amount.
   *
   * Each record starts from that person's **own joining date**, not from one
   * date chosen for everybody. That is what the figure actually means, and it
   * makes an earlier month's payroll compute correctly too rather than only
   * the month somebody happened to run this from.
   *
   * Only people with no pay record at all are touched. Anybody already set up
   * is left exactly as they are — this can never overwrite a raise.
   */
  async backfillCompensationFromJoining(actor: AuthenticatedUser) {
    const candidates = await this.db.client
      .select({
        id: teamMembers.id,
        fullName: teamMembers.fullName,
        joinedOn: teamMembers.joinedOn,
        joiningSalary: teamMembers.joiningSalary,
      })
      .from(teamMembers)
      .where(
        and(
          isNull(teamMembers.deletedAt),
          eq(teamMembers.engagementType, "employee"),
          sql`not exists (
            select 1 from ${compensationHistory}
            where ${compensationHistory.teamMemberId} = ${teamMembers.id}
          )`,
        ),
      )
      .orderBy(asc(teamMembers.fullName));

    const ready = candidates.filter(
      (c) => c.joiningSalary != null && Number(c.joiningSalary) > 0,
    );
    const withoutFigure = candidates
      .filter((c) => c.joiningSalary == null || Number(c.joiningSalary) <= 0)
      .map((c) => c.fullName);

    if (!ready.length) {
      return { created: 0, names: [], skipped: withoutFigure };
    }

    await this.db.transaction(async (tx) => {
      for (const person of ready) {
        await tx.insert(compensationHistory).values({
          teamMemberId: person.id,
          grossAmount: person.joiningSalary as string,
          effectiveFrom: person.joinedOn,
          changeReason: "Set from the salary agreed at joining",
          createdBy: actor.id,
        });

        // One row each rather than one for the batch: an audit trail that says
        // "eighteen salaries were set" answers none of the questions anybody
        // asks it later.
        await this.audit.record(tx, {
          action: "update",
          entityTable: "compensation_history",
          entityId: person.id,
          module: "team",
          isSensitive: true,
          summary: `Set ${person.fullName}'s pay to ${formatMoney(person.joiningSalary as string)} from ${person.joinedOn}, taken from their joining salary`,
        });
      }
    });

    return {
      created: ready.length,
      names: ready.map((p) => p.fullName),
      skipped: withoutFigure,
    };
  }

  /**
   * What everybody earns now, keyed by person.
   *
   * A separate call rather than a column on `TeamMemberDto`, and that is the
   * whole point. The team projection has never been able to carry a pay
   * figure — not "does not", *cannot*, because it never joins
   * `compensation_history` — and that is what makes the boundary structural
   * instead of a promise a future field could quietly break. The directory
   * asks for this second thing only when the role holds the permission, and a
   * role that does not simply gets a table with no salary column.
   *
   * Latest figure effective on or before today, per person. Somebody with no
   * record at all is absent from the map, which the screen shows as "not set"
   * — the same people the salary sheet skips, visible before payroll day
   * rather than on it.
   */
  async currentCompensation(): Promise<
    Array<{ teamMemberId: string; grossAmount: string; currency: string }>
  > {
    const rows = await this.db.client
      .select({
        teamMemberId: compensationHistory.teamMemberId,
        grossAmount: compensationHistory.grossAmount,
        currency: compensationHistory.currency,
        effectiveFrom: compensationHistory.effectiveFrom,
      })
      .from(compensationHistory)
      .where(
        and(
          isNull(compensationHistory.deletedAt),
          sql`${compensationHistory.effectiveFrom} <= ${todayInDhaka()}`,
        ),
      )
      .orderBy(
        compensationHistory.teamMemberId,
        desc(compensationHistory.effectiveFrom),
      );

    // First row per person wins, which the ordering above has already decided.
    // Done here rather than with `distinct on` so the rule is readable and the
    // query is one drizzle understands without a raw fragment.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.teamMemberId)) latest.set(row.teamMemberId, row);
    }

    return [...latest.values()].map(
      ({ teamMemberId, grossAmount, currency }) => ({
        teamMemberId,
        grossAmount,
        currency,
      }),
    );
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

    /**
     * The split, worked out once and frozen with the figure.
     *
     * Not computed when a payslip is drawn: the rule lives in Settings and can
     * change, and a payslip for March must go on showing March's split. This is
     * the same reason the payroll line snapshots its own breakdown — that one
     * is per month, this one is per raise.
     */
    const [settings] = await this.db.client
      .select({ salarySplit: appSettings.salarySplit })
      .from(appSettings)
      .limit(1);
    const parsed = salarySplitSchema.safeParse(settings?.salarySplit);
    const components = splitSalary(
      input.grossAmount,
      parsed.success && parsed.data.length ? parsed.data : DEFAULT_SALARY_SPLIT,
    );

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
            components,
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
}

const projection = {
  id: teamMembers.id,
  fullName: teamMembers.fullName,
  engagementType: teamMembers.engagementType,
  employmentType: teamMembers.employmentType,
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
  bloodGroup: teamMembers.bloodGroup,
  permanentAddress: teamMembers.permanentAddress,

  /**
   * Retained, no longer collected.
   *
   * None of these are on the company's employee sheet. The form no longer
   * offers them and `createTeamMemberSchema` no longer accepts them, so
   * nothing new is written here — but rows filled in before that decision keep
   * their values, and reading them back is what makes "the columns are still
   * there" mean something. Removing one from this list is the last step, not
   * the first.
   */
  maritalStatus: teamMembers.maritalStatus,
  spouseName: teamMembers.spouseName,
  fatherName: teamMembers.fatherName,
  motherName: teamMembers.motherName,
  religion: teamMembers.religion,
  passportNumber: teamMembers.passportNumber,
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

/**
 * The projection plus the uploaded photograph.
 *
 * Kept separate from `projection` above because that one is also handed to
 * `returning()` on insert and update, and `returning()` can only name columns
 * of the table being written.
 *
 * Paired with the left join in `findOne`, and it does not work without it.
 *
 * It was a correlated subquery first, and it was broken in the same way the
 * accounts balance was broken on the same day, written in the same hour:
 * inside a `sql` template drizzle renders a column as its bare name, so
 * `where f.team_member_id = ${teamMembers.id}` became
 * `where f.team_member_id = "id"`, and inside `from files f` that "id" is the
 * file's own. The condition asked whether a file's owner is its own id, which
 * is never true, so every person came back with no photograph and the avatar
 * fell back to initials — with no error anywhere, because NULL is a perfectly
 * good answer to "which photo".
 *
 * The join is written with `eq()` and `and()`, which qualify. At most one row
 * can match: uploading a photograph retires the previous one in the same
 * transaction, so there is never a second live `profile_photo` to duplicate
 * the person.
 */
const readProjection = {
  ...projection,
  photoFileId: files.id,
};

const livePhoto = and(
  eq(files.teamMemberId, teamMembers.id),
  eq(files.kind, "profile_photo"),
  isNull(files.deletedAt),
);

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
  return `${existing.fullName}: ${detail}`;
}
