import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import {
  createTeamMemberSchema,
  listTeamQuerySchema,
  setCompensationSchema,
  setTeamSocialsSchema,
  updateTeamMemberSchema,
  type CreateTeamMemberInput,
  type ListTeamQuery,
  type SetCompensationInput,
  type SetTeamSocialsInput,
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

  /**
   * Give everyone with no pay on record the figure they were hired at.
   *
   * Declared before `:id`, or "compensation" is read as a team member id and
   * the route 400s on the uuid parse — the same trap noted in
   * VendorsController.
   */
  /**
   * What everybody earns now, for the directory's salary column.
   *
   * Its own route behind its own permission, rather than a field on the team
   * list. A role without `team.compensation.read` gets a 403 here and a table
   * with no salary column — the figures never travel in the same response as
   * the names.
   */
  @Get("compensation/current")
  @RequirePermission("team.compensation.read")
  currentCompensation(@CurrentUser() actor: AuthenticatedUser) {
    this.team.assertCanSeeCompensation(actor);
    return this.team.currentCompensation();
  }

  @Post("compensation/from-joining-salary")
  @HttpCode(200)
  @RequirePermission("team.compensation.write")
  backfillCompensation(@CurrentUser() actor: AuthenticatedUser) {
    return this.team.backfillCompensationFromJoining(actor);
  }

  /*
   * Declared ABOVE `@Get(":id")`, and that is not a style choice.
   *
   * Nest matches in declaration order, so a literal segment written below a
   * `:param` route is never reached — `/team-members/socials` would be read as
   * a member whose id is the word "socials". This one has its own :id in front
   * so it cannot collide, but the pair stays together and stays above, because
   * the next literal route somebody adds here will not be so lucky.
   */
  @Get(":id/socials")
  @RequirePermission("team.read")
  socials(@Param("id") id: string) {
    return this.team.socials(uuidSchema.parse(id));
  }

  /**
   * The whole list, replaced.
   *
   * `team.write` rather than a permission of its own: a social handle is
   * directory information, the same kind of fact as a phone number, and it sits
   * behind the same door.
   */
  @Put(":id/socials")
  @RequirePermission("team.write")
  setSocials(
    @Param("id") id: string,
    @ZodBody(setTeamSocialsSchema) body: SetTeamSocialsInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.team.setSocials(uuidSchema.parse(id), body, actor);
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
