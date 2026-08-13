import { Module } from "@nestjs/common";

import { TeamMembersController } from "./team-members.controller";
import { TeamMembersService } from "./team-members.service";

@Module({
  controllers: [TeamMembersController],
  providers: [TeamMembersService],
  exports: [TeamMembersService],
})
export class TeamMembersModule {}
