import Database from "better-sqlite3";

import type { Contract, GuardDecision, TenantId } from "./types.js";

export type DemoDatabase = Database.Database;

type ContractRow = {
  id: string;
  tenant_id: TenantId;
  title: string;
  value: number;
  status: "active" | "review";
};

export function createDatabase(filename = ":memory:"): DemoDatabase {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      value INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actor_tenant TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_tenant TEXT,
      decision TEXT NOT NULL
    );
  `);

  const seed = db.prepare(`
    INSERT OR IGNORE INTO contracts (id, tenant_id, title, value, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const seedAll = db.transaction(() => {
    seed.run("alpha-contract-001", "tenant-a", "Acme Renewal", 120000, "active");
    seed.run("alpha-contract-002", "tenant-a", "Acme Security Review", 45000, "review");
    seed.run("beta-contract-001", "tenant-b", "Beacon Expansion", 98000, "active");
    seed.run("beta-contract-002", "tenant-b", "Beacon Data Processing", 36000, "review");
  });
  seedAll();

  return db;
}

function toContract(row: ContractRow): Contract {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    value: row.value,
    status: row.status,
  };
}

export function listContracts(db: DemoDatabase, tenantId: TenantId): Contract[] {
  const rows = db
    .prepare(
      `SELECT id, tenant_id, title, value, status
       FROM contracts WHERE tenant_id = ? ORDER BY id`,
    )
    .all(tenantId) as ContractRow[];
  return rows.map(toContract);
}

export function findOwner(db: DemoDatabase, contractId: string): TenantId | undefined {
  const row = db
    .prepare("SELECT tenant_id FROM contracts WHERE id = ?")
    .get(contractId) as { tenant_id: TenantId } | undefined;
  return row?.tenant_id;
}

export function findScopedContract(
  db: DemoDatabase,
  contractId: string,
  tenantId: TenantId,
): Contract | undefined {
  const row = db
    .prepare(
      `SELECT id, tenant_id, title, value, status
       FROM contracts WHERE id = ? AND tenant_id = ?`,
    )
    .get(contractId, tenantId) as ContractRow | undefined;
  return row ? toContract(row) : undefined;
}

export function writeAuditLog(
  db: DemoDatabase,
  actorTenant: TenantId,
  resourceId: string,
  resourceTenant: TenantId | undefined,
  decision: GuardDecision,
): void {
  db.prepare(
    `INSERT INTO audit_log
       (actor_tenant, resource_id, resource_tenant, decision)
     VALUES (?, ?, ?, ?)`,
  ).run(actorTenant, resourceId, resourceTenant ?? null, decision);
}

export type AuditRow = {
  id: number;
  occurred_at: string;
  actor_tenant: string;
  resource_id: string;
  resource_tenant: string | null;
  decision: GuardDecision;
};

export function recentAuditLog(db: DemoDatabase): AuditRow[] {
  return db
    .prepare(
      `SELECT id, occurred_at, actor_tenant, resource_id, resource_tenant, decision
       FROM audit_log ORDER BY id DESC LIMIT 12`,
    )
    .all() as AuditRow[];
}
