import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("falls back to defaults when the environment is empty", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: "0.0.0.0",
      databaseUrl: undefined,
      webOrigins: ["http://localhost:5173"],
    });
  });

  it("reads a comma separated list of web origins", () => {
    expect(loadConfig({ WEB_ORIGINS: "https://a.example, https://b.example" }).webOrigins).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});
