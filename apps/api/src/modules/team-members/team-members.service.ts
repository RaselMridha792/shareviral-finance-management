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
  type SetTeamSocialsInput,
  type UpsertEreturnInput,
  fiscalYearLabelLong,
  type UpdateTeamMemberInput,
} from "@finance/shared";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import {
  appSettings,
  compensationHistory,
  teamSocials,
  teamEreturns,
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
  /**
   * The company's own identifier, where somebody has one.
   *
   * Declared late. `projection` has returned this since the employee-ID
   * ordering went in and the screens read it, but this type never named it —
   * so it was there at runtime and invisible to the compiler, which is the
   * same drift in the other direction as a column missing from a projection.
   * Nothing changes at runtime; the type now says what the query already
   * answers with.
   */
  employeeCode: string | null;
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
  /* The three that arrived with the bank-details migration and, like
     `employeeCode` above, reached every screen without ever reaching here. */
  bankAccountHolder: string | null;
  bankBranch: string | null;
  bankSwift: string | null;
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
        /*
         * Employee ID first, and this one line is the whole fix. The owner, on
         * a screenshot of the list reading SVBE-06, SVBE-03, SVBE-04, SVBE-05:
         * "Team a ekhane ordering hobe Employee id hisebe ekhon may be A, b, c,
         * d ei serail dhorteche..eita data intact rekhei fix kora possible?"
         *
         * It was possible, and nothing was written to do it. Everybody on the
         * books joined the same day, so the old leading key separated nobody and
         * the sort fell through to `full_name` — the alphabet he was seeing. No
         * row held a wrong value; only the ORDER BY was wrong.
         *
         * `employee_code` is NULLABLE, and somebody without one must neither
         * vanish nor lead the list. Postgres puts NULLs last on ASC by default,
         * so an uncoded person keeps their place at the bottom of the list in
         * whatever order the keys below give them. Checked against this database
         * rather than assumed, because a wrong guess here hides a person.
         *
         * Plain text order, deliberately no natural sort. The codes in use are
         * `SVBE-` followed by two zero-padded digits, one width for everybody,
         * and padded numbers already sort correctly as text: `SVBE-09` does come
         * before `SVBE-10`. A natural sort would be machinery earning nothing.
         * It is the padding doing the work, so the padding is what has to hold —
         * an unpadded `SVBE-9` would sort after `SVBE-10`.
         *
         * The three keys that used to lead are kept behind it as tiebreaks, and
         * the last of them is not decoration: this list is paged with OFFSET, so
         * without a unique final key a row can appear on two pages and another
         * on none. While a code is still missing on some rows those three are
         * the entire order for those people.
         *
         * Payroll deliberately does not follow this. `eligibleMembers` and the
         * salary sheet stay on seniority — the sheet, its Excel and every
         * payslip trace to that one order — so this screen and that document are
         * now allowed to disagree about who row one is.
         */
        .orderBy(
          asc(teamMembers.employeeCode),
          asc(teamMembers.joinedOn),
          asc(teamMembers.fullName),
          asc(teamMembers.id),
        )
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

  /**
   * An employee ID belongs to one person.
   *
   * The unique index has been on this column since it was added, but nothing
   * could type into the column, so nothing ever hit it. Now that the drawer
   * can, a clash would surface as a bare "Internal server error" — the
   * exception filter turns any non-HTTP error into that — which tells whoever
   * typed it nothing at all. Checked here so the refusal can name the person
   * already holding it.
   *
   * Not a replacement for the index: two people saving the same ID in the same
   * second would both pass this and one would still be refused by the
   * database. This is for the case that actually happens.
   */
  private async assertEmployeeCodeFree(
    code: string | null | undefined,
    exceptId?: string,
  ) {
    if (!code) return;
    const [clash] = await this.db.client
      .select({ id: teamMembers.id, fullName: teamMembers.fullName })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.employeeCode, code),
          isNull(teamMembers.deletedAt),
          exceptId ? sql`${teamMembers.id} <> ${exceptId}::uuid` : undefined,
        ),
      )
      .limit(1);

    if (clash) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          employeeCode: [`${clash.fullName} already has that employee ID`],
        },
      });
    }
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
    await this.assertEmployeeCodeFree(memberInput.employeeCode);

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

    /*
     * Same rule as `create`: pay never touches `team_members`. On an edit the
     * figure lands as a raise effective today, through `setCompensation` and
     * everything it carries — the split snapshot, the closing of the previous
     * row, the sensitive audit line. A figure equal to what they are already
     * on is skipped rather than written twice, so saving the drawer without
     * touching the box does not manufacture a raise dated today.
     */
    const { currentSalary, ...memberInput } = input;
    await this.assertEmployeeCodeFree(memberInput.employeeCode, id);
    if (currentSalary !== undefined) {
      if (!hasPermission(actor.role, "team.compensation.write")) {
        throw new ForbiddenException(
          "Setting pay needs the compensation permission — leave Current salary blank",
        );
      }
      const now = await this.currentFigureOf(id);
      if (now === null || Number(now) !== Number(currentSalary)) {
        await this.setCompensation(
          id,
          {
            grossAmount: currentSalary,
            effectiveFrom: todayInDhaka(),
            changeReason: "Changed from the profile drawer",
          },
          actor,
        );
      }
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
          .set({ ...memberInput, updatedAt: new Date(), updatedBy: actor.id })
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

  /* ---------------------------------------------------------------------- */
  /*  Social accounts                                                        */
  /* ---------------------------------------------------------------------- */

  /** The accounts on a person's profile, in the order they were arranged. */
  async socials(teamMemberId: string) {
    await this.findOne(teamMemberId);

    return this.db.client
      .select({
        id: teamSocials.id,
        platform: teamSocials.platform,
        handle: teamSocials.handle,
        sortOrder: teamSocials.sortOrder,
      })
      .from(teamSocials)
      .where(
        and(
          isNull(teamSocials.deletedAt),
          eq(teamSocials.teamMemberId, teamMemberId),
        ),
      )
      .orderBy(asc(teamSocials.sortOrder), asc(teamSocials.platform));
  }

  /**
   * The whole list, replaced in one act.
   *
   * Declarative, like `syncMembers` and the subscription seats: a list somebody
   * edits has one truth — its final state — and sending a delta means three
   * requests that have to be read together to know what happened. One request,
   * one audit row, one before-image.
   *
   * A HARD delete of what is gone, and that is deliberate. Everything else in
   * this app is soft-deleted because somebody may need to answer a question
   * about it later; nobody will ever ask what a person's Instagram handle used
   * to be. Soft-deleting here would also collide with the partial unique index
   * the moment somebody removed a platform and added it back — the row would
   * be out of the way, but the audit log would fill with rows nobody reads.
   * The before-image in the audit row is the record that this changed.
   */
  async setSocials(
    teamMemberId: string,
    input: SetTeamSocialsInput,
    actor: AuthenticatedUser,
  ) {
    const member = await this.findOne(teamMemberId);

    return this.audit.mutate({
      action: "update",
      entityTable: "team_socials",
      entityId: teamMemberId,
      summary: `${actor.fullName} set ${member.fullName}'s social accounts (${input.socials.length})`,
      module: "team",
      read: async (tx) => {
        const rows = await tx
          .select()
          .from(teamSocials)
          .where(
            and(
              isNull(teamSocials.deletedAt),
              eq(teamSocials.teamMemberId, teamMemberId),
            ),
          );
        return { socials: rows };
      },
      run: async (tx) => {
        await tx
          .delete(teamSocials)
          .where(eq(teamSocials.teamMemberId, teamMemberId));

        if (input.socials.length === 0) return { socials: [] };

        const rows = await tx
          .insert(teamSocials)
          .values(
            input.socials.map((one, index) => ({
              teamMemberId,
              platform: one.platform,
              handle: one.handle,
              /* The order they arrived in, so the screen can put the one that
                 matters first and it stays there. */
              sortOrder: index,
              createdBy: actor.id,
              updatedBy: actor.id,
            })),
          )
          .returning();
        return { socials: rows };
      },
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  E-Return — one per fiscal year                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * A person's returns, newest year first, with the acknowledgement's id.
   *
   * The file is a `team_member` file of kind `e_return` that this row points
   * at, so the join is a left one: a return can be recorded as filed before the
   * receipt is to hand, and refusing to list it until the PDF arrives is how
   * the record never gets made at all.
   */
  async ereturns(teamMemberId: string) {
    await this.findOne(teamMemberId);

    return this.db.client
      .select({
        id: teamEreturns.id,
        fiscalYear: teamEreturns.fiscalYear,
        submittedOn: teamEreturns.submittedOn,
        notes: teamEreturns.notes,
        fileId: teamEreturns.fileId,
        fileName: files.originalName,
      })
      .from(teamEreturns)
      .leftJoin(files, eq(files.id, teamEreturns.fileId))
      .where(
        and(
          isNull(teamEreturns.deletedAt),
          eq(teamEreturns.teamMemberId, teamMemberId),
        ),
      )
      .orderBy(desc(teamEreturns.fiscalYear));
  }

  /**
   * Record a year's return, or correct the one already recorded.
   *
   * One per person per year is the owner's rule — *"Ata every year a 1 ta
   * hobe"* — and the database enforces it with a PARTIAL unique index. Partial
   * matters here: a year that was trashed and is being recorded again must not
   * collide with its own deleted row, which is the bug this repo hit the same
   * week on `compensation_history`.
   *
   * So the conflict target carries the same `where`, and the update clears
   * `deleted_at` — a year somebody is recording again is a year they have
   * decided is real.
   */
  async upsertEreturn(
    teamMemberId: string,
    input: UpsertEreturnInput,
    actor: AuthenticatedUser,
  ) {
    const member = await this.findOne(teamMemberId);

    return this.audit.mutate({
      action: "update",
      entityTable: "team_ereturns",
      entityId: teamMemberId,
      summary: `${actor.fullName} recorded ${member.fullName}'s ${fiscalYearLabelLong(input.fiscalYear)} e-Return`,
      module: "team",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(teamEreturns)
          .where(
            and(
              eq(teamEreturns.teamMemberId, teamMemberId),
              eq(teamEreturns.fiscalYear, input.fiscalYear),
            ),
          )
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .insert(teamEreturns)
          .values({
            teamMemberId,
            fiscalYear: input.fiscalYear,
            submittedOn: input.submittedOn ?? null,
            notes: input.notes ?? null,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .onConflictDoUpdate({
            target: [teamEreturns.teamMemberId, teamEreturns.fiscalYear],
            targetWhere: isNull(teamEreturns.deletedAt),
            set: {
              submittedOn: input.submittedOn ?? null,
              notes: input.notes ?? null,
              updatedAt: new Date(),
              updatedBy: actor.id,
            },
          })
          .returning();
        return row;
      },
    });
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
          /*
           * A row in the TRASH is not a salary on record.
           *
           * This asked whether any row existed at all, trashed ones included,
           * so somebody whose only salary row had been thrown away counted as
           * "already has pay" and was skipped. The effect was total silence:
           * they are not generated onto a payroll sheet (`buildLine` filters
           * `deleted_at is null`), the directory shows "Not set", and this —
           * the one action that exists to repair exactly that — neither offered
           * to fix them nor listed them among the skipped. Invisible in three
           * places at once.
           *
           * Every other reader of this table already filters the same way; this
           * was the one that did not.
           */
          sql`not exists (
            select 1 from ${compensationHistory}
            where ${compensationHistory.teamMemberId} = ${teamMembers.id}
              and ${compensationHistory.deletedAt} is null
          )`,
        ),
      )
      // Seniority, so the confirmation list and the audit rows read in the
      // order payroll does. This used to say "the same order the directory
      // shows" and that stopped being true when the directory moved to employee
      // ID above; the order here is left alone because what this writes is pay,
      // and everything else that touches pay is on seniority.
      .orderBy(
        asc(teamMembers.joinedOn),
        asc(teamMembers.fullName),
        asc(teamMembers.id),
      );

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

    /*
     * A figure re-set on a date that already has one AMENDS that row rather
     * than erroring. It used to refuse with "A figure already starts on that
     * date" — which read as a safeguard and was actually a trap: correcting a
     * typo five minutes later, or changing the figure twice in one day from
     * the edit drawer, hit a wall that told the person nothing useful. The
     * unique index stays; what changed is what a collision means. Each
     * amendment still writes its own audit row, so the trail keeps both
     * figures and who set them.
     */

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
              /* Not a row somebody has thrown away. Without this, recording a
                 raise stamps an end date onto a trashed row, and restoring it
                 later hands back a row closed against a change made after it
                 was deleted. */
              isNull(compensationHistory.deletedAt),
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
          .onConflictDoUpdate({
            target: [
              compensationHistory.teamMemberId,
              compensationHistory.effectiveFrom,
            ],
            /*
              `targetWhere` names the PARTIAL index, and it is not optional.

              `compensation_effective_idx` is unique on (team_member_id,
              effective_from) WHERE deleted_at is null. Postgres infers which
              index a conflict target means, and the inference has to match: a
              target with no `where` cannot use a partial index. Drop this line
              and every salary save fails with "no unique or exclusion
              constraint matching the ON CONFLICT specification" — which is why
              the migration and this line ship in one deploy.

              What it buys: a row in the TRASH no longer occupies its date. It
              used to, and that is how a figure came to be written into a
              trashed row — 200 back, nothing on screen, the person left on
              their old pay.
            */
            targetWhere: sql`${compensationHistory.deletedAt} is null`,
            set: {
              grossAmount: input.grossAmount,
              components,
              changeReason: input.changeReason,
              createdBy: actor.id,
              /*
                Kept, and now belt to the braces rather than the fix itself.

                With the index partial, this branch can only be reached by a
                LIVE row, whose three columns are already null. It stays because
                it costs nothing and because it is the thing that would keep the
                original bug shut if the index were ever widened again — which
                is exactly the mistake this pair exists to prevent.
              */
              deletedAt: null,
              deletedBy: null,
              deleteReason: null,
            },
          })
          .returning();
        return row;
      },
    });
  }

  /**
   * The figure a person is on right now, or null when none was ever set.
   * The same reading `currentCompensation` does for everybody, for one.
   */
  private async currentFigureOf(teamMemberId: string): Promise<string | null> {
    const [row] = await this.db.client
      .select({ grossAmount: compensationHistory.grossAmount })
      .from(compensationHistory)
      .where(
        and(
          eq(compensationHistory.teamMemberId, teamMemberId),
          isNull(compensationHistory.deletedAt),
          sql`${compensationHistory.effectiveFrom} <= ${todayInDhaka()}`,
        ),
      )
      .orderBy(desc(compensationHistory.effectiveFrom))
      .limit(1);
    return row?.grossAmount ?? null;
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
  // The company's own identifier for somebody, when they have one. Optional —
  // most of the people already on the books have none.
  employeeCode: teamMembers.employeeCode,
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
  /*
   * The three that were missing. They have to be here as well as in the
   * schema: the columns were storing correctly and the screen still read N/A,
   * because this object is what the API actually answers with.
   */
  bankAccountHolder: teamMembers.bankAccountHolder,
  bankBranch: teamMembers.bankBranch,
  bankSwift: teamMembers.bankSwift,
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
