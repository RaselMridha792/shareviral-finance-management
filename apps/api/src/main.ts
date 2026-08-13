import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import { AppModule } from "./app.module";
import { requestContextMiddleware } from "./common/context/request-context.middleware";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { corsOrigins, validateEnv } from "./config/env";

async function bootstrap() {
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.use(helmet());
  // Both auth tokens ride in httpOnly cookies, so the parser comes first.
  app.use(cookieParser());
  // Middleware, not an interceptor — guards run before interceptors, and the
  // auth guard needs this scope to exist so it can record the actor.
  app.use(requestContextMiddleware);

  app.setGlobalPrefix("api");
  app.enableCors({ origin: corsOrigins(env), credentials: true });

  app.useGlobalFilters(new AllExceptionsFilter());

  // No global ValidationPipe: validation is per-route via ZodBody/ZodQuery so
  // one schema in @finance/shared serves the API, the web forms, and the AI
  // intake's structured output.

  app.enableShutdownHooks();

  await app.listen(env.PORT);
  console.log(`API listening on http://localhost:${env.PORT}/api`);
}

void bootstrap();
