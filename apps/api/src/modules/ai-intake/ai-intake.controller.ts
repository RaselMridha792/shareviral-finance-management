import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { aiIntakeRequestSchema, type AiIntakeRequest } from "@finance/shared";

import { RequirePermission } from "../../common/decorators/auth.decorators";
import { ZodBody } from "../../common/pipes/zod-validation.pipe";
import { AiIntakeService } from "./ai-intake.service";

/**
 * Two read-only endpoints and one that resolves names to ids.
 *
 * None of them write. Saving happens when the person presses Save on the
 * filled-in form, which posts to the ordinary endpoint for that record — so
 * the assistant cannot reach anything their role could not reach by typing.
 */
@Controller("ai")
export class AiIntakeController {
  constructor(private readonly ai: AiIntakeService) {}

  @Get("availability")
  @RequirePermission("ai.use")
  availability() {
    return this.ai.availability();
  }

  @Post("turn")
  @HttpCode(200)
  @RequirePermission("ai.use")
  turn(@ZodBody(aiIntakeRequestSchema) body: AiIntakeRequest) {
    return this.ai.turn(body);
  }

  /** Category and account names to ids, checked against what exists. */
  @Post("resolve")
  @HttpCode(200)
  @RequirePermission("ai.use")
  resolve(@Body("draft") draft: Record<string, unknown>) {
    return this.ai.resolve(draft ?? {});
  }
}
