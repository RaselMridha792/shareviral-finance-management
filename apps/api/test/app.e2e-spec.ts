import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";

import { AppModule } from "./../src/app.module";

describe("Health (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health is public — monitoring must not need a login", () => {
    return request(app.getHttpServer())
      .get("/api/health")
      .expect(200)
      .expect({ status: "ok", service: "sfm-api" });
  });

  it("GET /api/health/db requires a signed-in user", async () => {
    // The failure path echoes the driver's message, which can name the host,
    // database, and user — so it must not be readable by anyone.
    const response = await request(app.getHttpServer()).get("/api/health/db");
    expect(response.status).toBe(401);
  });

  it("refuses an unauthenticated request to a guarded route", async () => {
    const response = await request(app.getHttpServer()).get(
      "/api/payroll/runs",
    );
    expect(response.status).toBe(401);
  });
});
