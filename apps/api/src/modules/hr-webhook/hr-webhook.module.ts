import { Module } from "@nestjs/common";

import { HrWebhookService } from "./hr-webhook.service";

/**
 * The webhook that tells the HR portal about decisions as they are made
 * (#128). Depends on nothing but the global database, so HR Requests, HR
 * Budget and payroll can all import it without a cycle. Its address and
 * secret are read from the environment when the API starts.
 */
@Module({
  providers: [HrWebhookService],
  exports: [HrWebhookService],
})
export class HrWebhookModule {}
