import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import session from "express-session";
import request from "supertest";

import { createApp } from "../src/app.js";
import { GithubOAuth } from "../src/oauth.js";
import { MemoryTenantStore } from "./memory-store.js";

type Login = {
  agent: ReturnType<typeof request.agent>;
  userId: string;
  tenantId: string;
  csrfToken: string;
};

describe("multi-tenant SaaS boundary", () => {
  let store: MemoryTenantStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store = new MemoryTenantStore();
    app = createApp({
      store,
      sessionMiddleware: session({ secret: "test-secret-that-is-long-enough-for-tests", resave: false, saveUninitialized: false }),
      oauth: new GithubOAuth({ clientId: "test", clientSecret: "test", callbackUrl: "http://example.test/auth/github/callback" }),
      baseUrl: "http://example.test",
      testAuth: true,
    });
  });

  async function login(name: string): Promise<Login> {
    const agent = request.agent(app);
    const response = await agent.post("/__test/login").send({ login: name });
    assert.equal(response.status, 200);
    return {
      agent,
      userId: response.body.user.id as string,
      tenantId: response.body.membership.tenantId as string,
      csrfToken: response.body.csrfToken as string,
    };
  }

  it("allows a contract owned by the authenticated tenant", async () => {
    const actor = await login("alice");
    const contract = await store.createContract(actor.tenantId, {
      title: "Acme Renewal",
      valueCents: 120_000_00,
      status: "active",
    });
    const response = await actor.agent.get(`/api/contracts/${contract.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.contract.title, "Acme Renewal");
    assert.equal(store.audit[0]?.decision, "Allow");
  });

  it("denies a resource owned by another tenant and records the internal reason", async () => {
    const actor = await login("alice");
    const other = await login("bob");
    const contract = await store.createContract(other.tenantId, {
      title: "Beacon Expansion",
      valueCents: 98_000_00,
      status: "active",
    });
    const response = await actor.agent.get(`/api/contracts/${contract.id}?tenantId=${other.tenantId}`);
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Contract not found" });
    assert.equal(store.audit[0]?.actorTenant, actor.tenantId);
    assert.equal(store.audit[0]?.decision, "CrossTenant");
  });

  it("fails closed when ownership cannot be resolved", async () => {
    const actor = await login("alice");
    const response = await actor.agent.get("/api/contracts/missing-contract");
    assert.equal(response.status, 404);
    assert.equal(store.audit[0]?.decision, "UnknownOwner");
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/contracts/missing-contract");
    assert.equal(response.status, 401);
  });

  it("rejects state changes without a CSRF token", async () => {
    const actor = await login("alice");
    const response = await actor.agent.post("/contracts").type("form").send({ title: "No CSRF", value: "10" });
    assert.equal(response.status, 403);
  });

  it("creates contracts inside the active tenant", async () => {
    const actor = await login("alice");
    const response = await actor.agent.post("/contracts").type("form").send({
      _csrf: actor.csrfToken,
      title: "Security Review",
      value: "450.25",
      status: "review",
    });
    assert.equal(response.status, 303);
    const contracts = await store.listContracts(actor.tenantId);
    assert.equal(contracts[0]?.valueCents, 45_025);
  });

  it("cannot select an organization without membership", async () => {
    const actor = await login("alice");
    const other = await login("bob");
    const response = await actor.agent.post("/organizations/select").type("form").send({
      _csrf: actor.csrfToken,
      tenantId: other.tenantId,
    });
    assert.equal(response.status, 403);
  });

  it("accepts an invitation once", async () => {
    const admin = await login("alice");
    const member = await login("bob");
    const token = "invite-token";
    await store.createInvitation({
      tenantId: admin.tenantId,
      createdBy: admin.userId,
      tokenHash: MemoryTenantStore.hashInvite(token),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const confirmation = await member.agent.get(`/join/${token}`);
    assert.equal(confirmation.status, 200);
    const accepted = await member.agent.post(`/join/${token}`).type("form").send({ _csrf: member.csrfToken });
    assert.equal(accepted.status, 303);
    assert.ok(await store.getMembership(member.userId, admin.tenantId));
    const reused = await member.agent.post(`/join/${token}`).type("form").send({ _csrf: member.csrfToken });
    assert.equal(reused.status, 404);
  });
});
