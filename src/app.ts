import path from "node:path";

import cookieParser from "cookie-parser";
import express, { type Request } from "express";

import {
  createDatabase,
  listContracts,
  recentAuditLog,
  type DemoDatabase,
} from "./database.js";
import { inspectBatch, inspectContract } from "./security.js";
import type { TenantId } from "./types.js";
import { renderDashboard } from "./ui.js";

function actorTenant(request: Request): TenantId {
  return request.cookies.demo_tenant === "tenant-b" ? "tenant-b" : "tenant-a";
}

function cleanContractId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

export function createApp(db: DemoDatabase = createDatabase()) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("/", (request, response) => {
    const tenant = actorTenant(request);
    response.send(
      renderDashboard({
        actorTenant: tenant,
        contracts: listContracts(db, tenant),
        audit: recentAuditLog(db),
      }),
    );
  });

  app.post("/session", (request, response) => {
    const tenant: TenantId = request.body.tenantId === "tenant-b" ? "tenant-b" : "tenant-a";
    response.cookie("demo_tenant", tenant, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
    response.redirect(303, "/");
  });

  app.post("/inspect", (request, response) => {
    const tenant = actorTenant(request);
    const result = inspectContract(db, tenant, cleanContractId(request.body.contractId));
    response.status(result.kind === "allowed" ? 200 : result.externalStatus).send(
      renderDashboard({
        actorTenant: tenant,
        contracts: listContracts(db, tenant),
        audit: recentAuditLog(db),
        result,
      }),
    );
  });

  app.get("/api/contracts/:contractId", (request, response) => {
    const tenant = actorTenant(request);
    // Query strings such as ?tenantId=tenant-b are deliberately ignored.
    const result = inspectContract(db, tenant, cleanContractId(request.params.contractId));
    if (result.kind === "allowed") {
      response.json({ contract: result.contract });
      return;
    }
    response.status(404).json({ error: "Contract not found" });
  });

  app.post("/api/contracts/batch", (request, response) => {
    const tenant = actorTenant(request);
    const ids = Array.isArray(request.body.ids)
      ? request.body.ids.map(cleanContractId).filter(Boolean).slice(0, 20)
      : [];
    const results = inspectBatch(db, tenant, ids);
    const denied = results.some((result) => result.kind === "denied");
    if (denied) {
      response.status(404).json({ error: "One or more contracts were not found" });
      return;
    }
    response.json({ contracts: results.map((result) => result.kind === "allowed" && result.contract) });
  });

  return app;
}
