import { Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createTeamMemberSchema,
  listTeamQuerySchema,
  setCompensationSchema,
  updateTeamMemberSchema,
  type CreateTeamMemberInput,
  type ListTeamQuery,
  type SetCompensationInput,
  type UpdateTeamMemberInput,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { TeamMembersService } from "./team-members.service";

const uuidSchema = z.string().uuid("Not a valid id");

@Controller("team-members")
export class TeamMembersController {
  constructor(private readonly team: TeamMembersService) {}

  @Get()
  @RequirePermission("team.read")
  list(@ZodQuery(listTeamQuerySchema) query: ListTeamQuery) {
    return this.team.list(query);
  }

  @Get(":id")
  @RequirePermission("team.read")
  findOne(@Param("id") id: string) {
    return this.team.findOne(uuidSchema.parse(id));
  }

  @Post()
  @RequirePermission("team.write")
  create(
    @ZodBody(createTeamMemberSchema) body: CreateTeamMemberInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.team.create(body, actor);
  }

  @Patch(":id")
  @RequirePermission("team.write")
  update(
    @Param("id") id: string,
    @ZodBody(updateTeamMemberSchema) body: UpdateTeamMemberInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.team.update(uuidSchema.parse(id), body, actor);
  }

  /**
   * Pay. Behind its own permission, which HR does not hold — this is the
   * boundary the whole permission system exists to keep.
   */
  @Get(":id/compensation")
  @RequirePermission("team.compensation.read")
  compensation(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    this.team.assertCanSeeCompensation(actor);
    return this.team.compensationHistory(uuidSchema.parse(id));
  }

  @Post(":id/compensation")
  @RequirePermission("team.compensation.write")
  setCompensation(
    @Param("id") id: string,
    @ZodBody(setCompensationSchema) body: SetCompensationInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    this.team.assertCanSeeCompensation(actor);
    return this.team.setCompensation(uuidSchema.parse(id), body, actor);
  }
}
