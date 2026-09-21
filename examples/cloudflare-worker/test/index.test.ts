import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Cloudflare Worker tenant boundary", () => {
  it("allows the authenticated tenant's contract", async () => {
    const response = await exports.default.fetch(
      "https://example.com/contracts/alpha-contract-001",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ decision: "Allow" });
  });

  it("hides another tenant's contract", async () => {
    const response = await exports.default.fetch(
      "https://example.com/contracts/beta-contract-001",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Contract not found" });
  });

  it("fails closed for unknown ownership", async () => {
    const response = await exports.default.fetch(
      "https://example.com/contracts/missing-contract",
    );

    expect(response.status).toBe(404);
  });
});
