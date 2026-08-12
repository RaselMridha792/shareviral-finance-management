import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import { AppModule } from "./app.module";
import { requestContextMiddleware } from "./common/context/request-context.middleware";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { corsOrigins, validateEnv } from "./config/env";

async function bootstrap() {
  const env = validateEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  // In production the API sits behind a proxy — Vercel's rewrite today, nginx
  // on the VPS later — so the socket's peer address is the proxy, not the
  // user. Without this every audit row records the proxy's IP, which makes the
  // "who did this, from where" column worthless. One hop only: trusting the
  // whole chain lets a client forge the header.
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

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

  // 0.0.0.0, not the default localhost — a container that only listens on the
  // loopback interface is unreachable from outside it.
  await app.listen(env.PORT, "0.0.0.0");
  console.log(`API listening on port ${env.PORT}, routes under /api`);
}

void bootstrap();
