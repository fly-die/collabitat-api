import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { HEALTH_PATH } from "../src/routes/health.js";

const HTTP_OK = 200;

describe("GET /health", () => {
  const app = buildApp();

  afterAll(() => app.close());

  it("reports the service as ok", async () => {
    const response = await app.inject({ method: "GET", url: HEALTH_PATH });

    expect(response.statusCode).toBe(HTTP_OK);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
