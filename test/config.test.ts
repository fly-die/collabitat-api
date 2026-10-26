import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("falls back to defaults when the environment is empty", () => {
    expect(loadConfig({})).toEqual({ port: 3000, host: "0.0.0.0" });
  });

  it("reads port and host from the environment", () => {
    expect(loadConfig({ PORT: "8080", HOST: "127.0.0.1" })).toEqual({
      port: 8080,
      host: "127.0.0.1",
    });
  });
});
