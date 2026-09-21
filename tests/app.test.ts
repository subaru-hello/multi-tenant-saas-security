import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import { createDatabase, recentAuditLog, type DemoDatabase } from "../src/database.js";

describe("multi-tenant contract access", () => {
  let db: DemoDatabase;

  beforeEach(() => {
    db = createDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("allows a contract owned by the authenticated tenant", async () => {
    const response = await request(createApp(db)).get("/api/contracts/alpha-contract-001");

    assert.equal(response.status, 200);
    assert.equal(response.body.contract.title, "Acme Renewal");
    assert.equal(recentAuditLog(db)[0]?.decision, "Allow");
  });

  it("denies a resource owned by another tenant", async () => {
    const response = await request(createApp(db)).get("/api/contracts/beta-contract-001");

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Contract not found" });
    assert.equal(recentAuditLog(db)[0]?.decision, "CrossTenant");
  });

  it("ignores a forged tenant claim supplied with the resource ID", async () => {
    const response = await request(createApp(db)).get(
      "/api/contracts/beta-contract-001?tenantId=tenant-b",
    );

    assert.equal(response.status, 404);
    assert.equal(recentAuditLog(db)[0]?.actor_tenant, "tenant-a");
    assert.equal(recentAuditLog(db)[0]?.decision, "CrossTenant");
  });

  it("fails closed when ownership cannot be resolved", async () => {
    const response = await request(createApp(db)).get("/api/contracts/missing-contract");

    assert.equal(response.status, 404);
    assert.equal(recentAuditLog(db)[0]?.decision, "UnknownOwner");
  });

  it("rejects a batch when even one item belongs to another tenant", async () => {
    const response = await request(createApp(db))
      .post("/api/contracts/batch")
      .send({ ids: ["alpha-contract-001", "beta-contract-001"] });

    assert.equal(response.status, 404);
    assert.ok(recentAuditLog(db).map((row) => row.decision).includes("CrossTenant"));
  });

  it("uses the selected server-side demo session", async () => {
    const agent = request.agent(createApp(db));
    await agent.post("/session").type("form").send({ tenantId: "tenant-b" });

    const response = await agent.get("/api/contracts/beta-contract-001");
    assert.equal(response.status, 200);
    assert.equal(response.body.contract.tenantId, "tenant-b");
  });
});
