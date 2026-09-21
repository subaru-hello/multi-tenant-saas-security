import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";

import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import { GithubOAuth } from "./oauth.js";
import { inspectBatch, inspectContract } from "./security.js";
import type { TenantStore } from "./store.js";
import type { Membership, User } from "./types.js";
import { renderDashboard, renderInvitationConfirmation, renderLanding } from "./ui.js";

type AppOptions = {
  store: TenantStore;
  sessionMiddleware: RequestHandler;
  oauth: GithubOAuth;
  baseUrl: string;
  testAuth?: boolean;
};

type AuthContext = {
  user: User;
  membership: Membership;
  memberships: Membership[];
};

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function slugify(value: unknown): string {
  return cleanText(value, 64)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionCsrfToken(request: Request): string {
  request.session.csrfToken ??= randomBytes(32).toString("base64url");
  return request.session.csrfToken;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function csrfProtection(request: Request, response: Response, next: NextFunction): void {
  const expected = request.session.csrfToken;
  const supplied = cleanText(request.body?._csrf ?? request.get("x-csrf-token"), 128);
  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    response.status(403).json({ error: "Invalid CSRF token" });
    return;
  }
  next();
}

async function loadAuthContext(request: Request, store: TenantStore): Promise<AuthContext | undefined> {
  const userId = request.session.userId;
  if (!userId) return undefined;
  const [user, memberships] = await Promise.all([store.getUser(userId), store.listMemberships(userId)]);
  if (!user || memberships.length === 0) return undefined;
  let membership = request.session.activeTenantId
    ? memberships.find((candidate) => candidate.tenantId === request.session.activeTenantId)
    : undefined;
  membership ??= memberships[0];
  request.session.activeTenantId = membership!.tenantId;
  return { user, membership: membership!, memberships };
}

function requireContext(context: AuthContext | undefined, response: Response): context is AuthContext {
  if (context) return true;
  response.redirect(303, "/");
  return false;
}

export function createApp(options: AppOptions) {
  const { store } = options;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "data:", "https://avatars.githubusercontent.com"],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(express.json({ limit: "32kb" }));
  app.use(options.sessionMiddleware);
  app.use(express.static(path.join(process.cwd(), "public"), { maxAge: "1h" }));

  app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
  app.get("/health/ready", async (_request, response) => {
    await store.ping();
    response.json({ status: "ready" });
  });

  const authLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8" });
  app.get("/auth/github", authLimiter, (request, response) => {
    const state = randomBytes(32).toString("base64url");
    request.session.oauthState = state;
    response.redirect(options.oauth.authorizationUrl(state));
  });

  app.get("/auth/github/callback", authLimiter, async (request, response) => {
    const state = cleanText(request.query.state, 128);
    const code = cleanText(request.query.code, 256);
    const expected = request.session.oauthState;
    delete request.session.oauthState;
    if (!state || !code || !expected || !safeEqual(state, expected)) {
      response.status(400).send("Invalid OAuth state");
      return;
    }
    const profile = await options.oauth.exchange(code);
    const user = await store.upsertGithubUser(profile);
    let membership = await store.ensurePersonalTenant(user);
    let flash: string | undefined;
    const pendingInvite = request.session.pendingInviteToken;
    delete request.session.pendingInviteToken;
    if (pendingInvite) {
      const accepted = await store.acceptInvitation(hashToken(pendingInvite), user.id);
      if (accepted) {
        membership = accepted;
        flash = `Joined ${accepted.tenantName}`;
      }
    }
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    request.session.userId = user.id;
    request.session.activeTenantId = membership.tenantId;
    request.session.csrfToken = randomBytes(32).toString("base64url");
    if (flash) request.session.flash = flash;
    response.redirect(303, "/");
  });

  if (options.testAuth) {
    app.post("/__test/login", async (request, response) => {
      const login = cleanText(request.body.login, 80) || "test-user";
      const user = await store.upsertGithubUser({
        githubId: `test-${login}`,
        login,
        displayName: login,
      });
      const membership = await store.ensurePersonalTenant(user);
      request.session.userId = user.id;
      request.session.activeTenantId = membership.tenantId;
      response.json({ user, membership, csrfToken: sessionCsrfToken(request) });
    });
  }

  app.get("/join/:token", async (request, response) => {
    const token = cleanText(request.params.token, 256);
    const context = await loadAuthContext(request, store);
    if (!context) {
      request.session.pendingInviteToken = token;
      response.redirect(303, "/auth/github");
      return;
    }
    response.send(renderInvitationConfirmation(token, sessionCsrfToken(request)));
  });

  app.post("/join/:token", csrfProtection, async (request, response) => {
    const token = cleanText(request.params.token, 256);
    const context = await loadAuthContext(request, store);
    if (!requireContext(context, response)) return;
    const membership = await store.acceptInvitation(hashToken(token), context.user.id);
    if (!membership) {
      response.status(404).send("Invitation is invalid or expired");
      return;
    }
    request.session.activeTenantId = membership.tenantId;
    request.session.flash = `Joined ${membership.tenantName}`;
    response.redirect(303, "/");
  });

  app.get("/", async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!context) {
      response.send(renderLanding());
      return;
    }
    const [contracts, audit] = await Promise.all([
      store.listContracts(context.membership.tenantId),
      store.recentAuditEvents(context.membership.tenantId),
    ]);
    const flash = request.session.flash;
    const inviteUrl = request.session.inviteUrl;
    delete request.session.flash;
    delete request.session.inviteUrl;
    response.send(
      renderDashboard({
        ...context,
        contracts,
        audit,
        csrfToken: sessionCsrfToken(request),
        flash,
        inviteUrl,
      }),
    );
  });

  app.post("/logout", csrfProtection, (request, response) => {
    request.session.destroy(() => response.redirect(303, "/"));
  });

  app.post("/organizations", csrfProtection, async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!requireContext(context, response)) return;
    const name = cleanText(request.body.name, 120);
    const slug = slugify(request.body.slug || name);
    if (!name || slug.length < 3) {
      response.status(400).json({ error: "Organization name and a valid slug are required" });
      return;
    }
    const membership = await store.createTenant(context.user.id, name, slug);
    request.session.activeTenantId = membership.tenantId;
    request.session.flash = `Created ${membership.tenantName}`;
    response.redirect(303, "/");
  });

  app.post("/organizations/select", csrfProtection, async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!requireContext(context, response)) return;
    const tenantId = cleanText(request.body.tenantId, 64);
    const membership = await store.getMembership(context.user.id, tenantId);
    if (!membership) {
      response.status(403).json({ error: "Not a member of that organization" });
      return;
    }
    request.session.activeTenantId = membership.tenantId;
    response.redirect(303, "/");
  });

  app.post("/organizations/invitations", csrfProtection, async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!requireContext(context, response)) return;
    if (context.membership.role !== "admin") {
      response.status(403).json({ error: "Admin role required" });
      return;
    }
    const token = randomBytes(32).toString("base64url");
    await store.createInvitation({
      tenantId: context.membership.tenantId,
      createdBy: context.user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    request.session.inviteUrl = `${options.baseUrl}/join/${token}`;
    request.session.flash = "Invite link created; it expires in seven days";
    response.redirect(303, "/");
  });

  app.post("/contracts", csrfProtection, async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!requireContext(context, response)) return;
    const title = cleanText(request.body.title, 160);
    const value = Number(request.body.value);
    const status = request.body.status === "review" ? "review" : "active";
    if (!title || !Number.isFinite(value) || value < 0 || value > 100_000_000) {
      response.status(400).json({ error: "Invalid contract" });
      return;
    }
    await store.createContract(context.membership.tenantId, {
      title,
      valueCents: Math.round(value * 100),
      status,
    });
    response.redirect(303, "/");
  });

  app.post("/contracts/:contractId/delete", csrfProtection, async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!requireContext(context, response)) return;
    const contractId = cleanText(request.params.contractId, 128);
    const inspection = await inspectContract(
      store,
      context.membership.tenantId,
      context.user.id,
      contractId,
    );
    if (inspection.kind !== "allowed") {
      response.status(404).json({ error: "Contract not found" });
      return;
    }
    await store.deleteContract(context.membership.tenantId, contractId);
    response.redirect(303, "/");
  });

  app.post("/inspect", csrfProtection, async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!requireContext(context, response)) return;
    const result = await inspectContract(
      store,
      context.membership.tenantId,
      context.user.id,
      cleanText(request.body.contractId, 128),
    );
    const [contracts, audit] = await Promise.all([
      store.listContracts(context.membership.tenantId),
      store.recentAuditEvents(context.membership.tenantId),
    ]);
    response.status(result.kind === "allowed" ? 200 : result.externalStatus).send(
      renderDashboard({
        ...context,
        contracts,
        audit,
        csrfToken: sessionCsrfToken(request),
        result,
      }),
    );
  });

  app.get("/api/contracts/:contractId", async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!context) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    const result = await inspectContract(
      store,
      context.membership.tenantId,
      context.user.id,
      cleanText(request.params.contractId, 128),
    );
    if (result.kind === "allowed") {
      response.json({ contract: result.contract });
      return;
    }
    response.status(404).json({ error: "Contract not found" });
  });

  app.post("/api/contracts/batch", csrfProtection, async (request, response) => {
    const context = await loadAuthContext(request, store);
    if (!context) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    const ids = Array.isArray(request.body.ids)
      ? request.body.ids.map((id: unknown) => cleanText(id, 128)).filter(Boolean).slice(0, 20)
      : [];
    const results = await inspectBatch(store, context.membership.tenantId, context.user.id, ids);
    if (results.some((result) => result.kind === "denied")) {
      response.status(404).json({ error: "One or more contracts were not found" });
      return;
    }
    response.json({ contracts: results.map((result) => result.kind === "allowed" && result.contract) });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "Internal server error" });
  });

  return app;
}
