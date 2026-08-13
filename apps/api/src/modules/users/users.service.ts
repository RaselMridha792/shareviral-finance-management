import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ROLE_LABELS, type Paginated } from "@finance/shared";
import bcrypt from "bcryptjs";
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { users } from "../../db/schema";
import { BCRYPT_ROUNDS } from "../auth/auth.service";
import { TokenService } from "../auth/token.service";
import type {
  CreateUserInput,
  ListUsersQuery,
  ResetPasswordInput,
  UpdateUserInput,
} from "./users.schemas";

export type UserDto = {
  id: string;
  email: string;
  fullName: string;
  role: (typeof users.$inferSelect)["role"];
  status: (typeof users.$inferSelect)["status"];
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  createdAt: Date;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {}

  async list(query: ListUsersQuery): Promise<Paginated<UserDto>> {
    const filters = [isNull(users.deletedAt)];
    if (query.role) filters.push(eq(users.role, query.role));
    if (query.status) filters.push(eq(users.status, query.status));
    if (query.q) {
      const term = `%${query.q}%`;
      const match = or(ilike(users.fullName, term), ilike(users.email, term));
      if (match) filters.push(match);
    }

    const where = and(...filters);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, [{ total }]] = await Promise.all([
      this.db.client
        .select(projection)
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(query.pageSize)
        .offset(offset),
      this.db.client.select({ total: count() }).from(users).where(where),
    ]);

    return {
      items: rows,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  async findOne(id: string): Promise<UserDto> {
    const [row] = await this.db.client
      .select(projection)
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("No such user");
    return row;
  }

  async create(input: CreateUserInput, actor: AuthenticatedUser) {
    const [clash] = await this.db.client
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);

    if (clash) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { email: ["Someone already uses that email"] },
      });
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    return this.audit.mutate({
      action: "create",
      entityTable: "users",
      summary: `Added ${input.fullName} as ${ROLE_LABELS[input.role]}`,
      module: "users",
      // Nothing exists before a create, so there is no prior state to read.
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            email: input.email,
            fullName: input.fullName,
            role: input.role,
            passwordHash,
            mustChangePassword: input.mustChangePassword,
            status: "active",
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning(projection);
        return created;
      },
    });
  }

  async update(id: string, input: UpdateUserInput, actor: AuthenticatedUser) {
    const existing = await this.findOne(id);

    // Without this, an admin could demote or disable the last super_admin and
    // lock everyone out of settings and user management permanently.
    if (existing.role === "super_admin") {
      const demoting = input.role && input.role !== "super_admin";
      const disabling = input.status && input.status !== "active";
      if (demoting || disabling) {
        const remaining = await this.countActiveSuperAdmins();
        if (remaining <= 1) {
          throw new ForbiddenException(
            "This is the last Super Admin — promote someone else first",
          );
        }
      }
    }

    // A role change must invalidate tokens issued under the old permissions.
    const roleChanged = Boolean(input.role && input.role !== existing.role);
    const deactivated = Boolean(input.status && input.status !== "active");

    const updated = await this.audit.mutate({
      action: "update",
      entityTable: "users",
      entityId: id,
      summary: buildUpdateSummary(existing, input),
      module: "users",
      read: async (tx) => {
        const [row] = await tx
          .select(projection)
          .from(users)
          .where(eq(users.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(users)
          .set({
            ...(input.fullName ? { fullName: input.fullName } : {}),
            ...(input.role ? { role: input.role } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(roleChanged || deactivated
              ? { tokenVersion: sql`${users.tokenVersion} + 1` }
              : {}),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(users.id, id))
          .returning(projection);
        return row;
      },
    });

    if (roleChanged || deactivated) {
      await this.tokens.revokeAllForUser(
        id,
        roleChanged ? "role changed" : "account disabled",
      );
    }

    return updated;
  }

  async resetPassword(
    id: string,
    input: ResetPasswordInput,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.findOne(id);
    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

    await this.audit.mutate({
      action: "update",
      entityTable: "users",
      entityId: id,
      summary: `Reset the password for ${existing.fullName}`,
      module: "users",
      read: async (tx) => {
        const [row] = await tx
          .select({
            passwordChangedAt: users.passwordChangedAt,
            mustChangePassword: users.mustChangePassword,
          })
          .from(users)
          .where(eq(users.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(users)
          .set({
            passwordHash,
            passwordChangedAt: new Date(),
            mustChangePassword: input.mustChangePassword,
            failedLoginCount: 0,
            lockedUntil: null,
            tokenVersion: sql`${users.tokenVersion} + 1`,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(users.id, id));
      },
    });

    await this.tokens.revokeAllForUser(id, "password reset by an admin");
    return { reset: true };
  }

  private async countActiveSuperAdmins(): Promise<number> {
    const [{ total }] = await this.db.client
      .select({ total: count() })
      .from(users)
      .where(
        and(
          eq(users.role, "super_admin"),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      );
    return Number(total);
  }
}

const projection = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: users.role,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
};

function buildUpdateSummary(existing: UserDto, input: UpdateUserInput): string {
  const parts: string[] = [];
  if (input.fullName && input.fullName !== existing.fullName) {
    parts.push(`renamed to ${input.fullName}`);
  }
  if (input.role && input.role !== existing.role) {
    parts.push(
      `role ${ROLE_LABELS[existing.role]} → ${ROLE_LABELS[input.role]}`,
    );
  }
  if (input.status && input.status !== existing.status) {
    parts.push(`status ${existing.status} → ${input.status}`);
  }
  const detail = parts.length ? parts.join(", ") : "no effective change";
  return `Updated ${existing.fullName}: ${detail}`;
}
