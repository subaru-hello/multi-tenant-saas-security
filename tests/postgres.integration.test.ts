import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createPool, migrateDatabase, PostgresTenantStore } from "../src/database.js";
import { inspectContract } from "../src/security.js";

const connectionString = process.env.TEST_DATABASE_URL;

describe("PostgreSQL tenant isolation", { skip: !connectionString }, () => {
  const pool = createPool(connectionString ?? "postgresql://unused");
  const store = new PostgresTenantStore(pool);

  before(async () => {
    await migrateDatabase(pool);
  });

  after(async () => {
    await store.close();
  });

  it("enforces RLS independently of the Rust guard", async () => {
    const alice = await store.upsertGithubUser({ githubId: "integration-alice", login: "alice", displayName: "Alice" });
    const bob = await store.upsertGithubUser({ githubId: "integration-bob", login: "bob", displayName: "Bob" });
    const tenantA = await store.ensurePersonalTenant(alice);
    const tenantB = await store.ensurePersonalTenant(bob);
    const contractB = await store.createContract(tenantB.tenantId, {
      title: "Bob-only contract",
      valueCents: 50_000,
      status: "active",
    });

    assert.equal(await store.findScopedContract(tenantA.tenantId, contractB.id), undefined);
    assert.equal(await store.resolveContractOwner(contractB.id), tenantB.tenantId);

    const unscoped = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM contracts");
    assert.equal(unscoped.rows[0]?.count, "0");

    const result = await inspectContract(store, tenantA.tenantId, alice.id, contractB.id);
    assert.equal(result.kind, "denied");
    assert.equal(result.decision, "CrossTenant");
    assert.equal((await store.recentAuditEvents(tenantA.tenantId))[0]?.decision, "CrossTenant");
  });
});
