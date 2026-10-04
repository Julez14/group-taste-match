import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("serves the health endpoint", async () => {
  const res = await exports.default.fetch("https://example.com/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
