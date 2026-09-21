import { randomUUID } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type { NewContract, TenantStore } from "./store.js";
import type {
  AuditEvent,
  Contract,
  GithubProfile,
  GuardDecision,
  Membership,
  TenantId,
  User,
} from "./types.js";

const migrationSql = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  github_id text NOT NULL UNIQUE,
  login text NOT NULL,
  display_name text NOT NULL,
  email text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  value_cents integer NOT NULL CHECK (value_cents >= 0),
  status text NOT NULL CHECK (status IN ('active', 'review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contracts_tenant_created_idx
  ON contracts (tenant_id, created_at DESC);

-- Contains ownership metadata only. The guard resolves this independently,
-- while contract contents remain protected by RLS.
CREATE TABLE IF NOT EXISTS contract_owners (
  contract_id uuid PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resource_id text NOT NULL,
  resource_tenant_id uuid,
  decision text NOT NULL CHECK (
    decision IN ('Allow', 'CrossTenant', 'UnknownOwner', 'InvalidActorTenant')
  ),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_tenant_occurred_idx
  ON audit_events (tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  CREATE POLICY contracts_tenant_isolation ON contracts
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$policy$;

DO $policy$
BEGIN
  CREATE POLICY audit_events_tenant_isolation ON audit_events
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$policy$;

`;

type UserRow = QueryResultRow & {
  id: string;
  github_id: string;
  login: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
};

type MembershipRow = QueryResultRow & {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role: "admin" | "member";
};

type ContractRow = QueryResultRow & {
  id: string;
  tenant_id: string;
  title: string;
  value_cents: number;
  status: "active" | "review";
  created_at: Date;
};

type AuditRow = QueryResultRow & {
  id: string;
  occurred_at: Date;
  tenant_id: string;
  actor_user_id: string;
  resource_id: string;
  resource_tenant_id: string | null;
  decision: GuardDecision;
};

function toUser(row: UserRow): User {
  return {
    id: row.id,
    githubId: row.github_id,
    login: row.login,
    displayName: row.display_name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
  };
}

function toMembership(row: MembershipRow): Membership {
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    role: row.role,
  };
}

function toContract(row: ContractRow): Contract {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    valueCents: row.value_cents,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actorTenant: row.tenant_id,
    actorUserId: row.actor_user_id,
    resourceId: row.resource_id,
    ...(row.resource_tenant_id ? { resourceTenant: row.resource_tenant_id } : {}),
    decision: row.decision,
  };
}

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function migrateDatabase(pool: Pool): Promise<void> {
  await pool.query(migrationSql);
}

export class PostgresTenantStore implements TenantStore {
  constructor(readonly pool: Pool) {}

  private async withTenant<T>(tenantId: TenantId, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async upsertGithubUser(profile: GithubProfile): Promise<User> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (id, github_id, login, display_name, email, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (github_id) DO UPDATE SET
         login = EXCLUDED.login,
         display_name = EXCLUDED.display_name,
         email = EXCLUDED.email,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = now()
       RETURNING id, github_id, login, display_name, email, avatar_url`,
      [randomUUID(), profile.githubId, profile.login, profile.displayName, profile.email ?? null, profile.avatarUrl ?? null],
    );
    return toUser(result.rows[0]!);
  }

  async getUser(userId: string): Promise<User | undefined> {
    const result = await this.pool.query<UserRow>(
      "SELECT id, github_id, login, display_name, email, avatar_url FROM users WHERE id = $1",
      [userId],
    );
    return result.rows[0] ? toUser(result.rows[0]) : undefined;
  }

  async ensurePersonalTenant(user: User): Promise<Membership> {
    const existing = await this.listMemberships(user.id);
    if (existing[0]) return existing[0];

    const tenantId = randomUUID();
    const suffix = user.id.replaceAll("-", "").slice(0, 8);
    const base = user.login.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
    const slug = `${base.slice(0, 48)}-${suffix}`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [
        tenantId,
        `${user.displayName}'s Workspace`,
        slug,
      ]);
      await client.query(
        "INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'admin')",
        [user.id, tenantId],
      );
      await client.query("COMMIT");
      return { tenantId, tenantName: `${user.displayName}'s Workspace`, tenantSlug: slug, role: "admin" };
    } catch (error) {
      await client.query("ROLLBACK");
      const raced = await this.listMemberships(user.id);
      if (raced[0]) return raced[0];
      throw error;
    } finally {
      client.release();
    }
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    const result = await this.pool.query<MembershipRow>(
      `SELECT m.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.role
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 ORDER BY t.name`,
      [userId],
    );
    return result.rows.map(toMembership);
  }

  async getMembership(userId: string, tenantId: TenantId): Promise<Membership | undefined> {
    const result = await this.pool.query<MembershipRow>(
      `SELECT m.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.role
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 AND m.tenant_id = $2`,
      [userId, tenantId],
    );
    return result.rows[0] ? toMembership(result.rows[0]) : undefined;
  }

  async createTenant(userId: string, name: string, slug: string): Promise<Membership> {
    const tenantId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [tenantId, name, slug]);
      await client.query(
        "INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'admin')",
        [userId, tenantId],
      );
      await client.query("COMMIT");
      return { tenantId, tenantName: name, tenantSlug: slug, role: "admin" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listContracts(tenantId: TenantId): Promise<Contract[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<ContractRow>(
        `SELECT id, tenant_id, title, value_cents, status, created_at
         FROM contracts ORDER BY created_at DESC`,
      );
      return result.rows.map(toContract);
    });
  }

  async resolveContractOwner(contractId: string): Promise<TenantId | undefined> {
    const result = await this.pool.query<{ tenant_id: string | null }>(
      "SELECT tenant_id FROM contract_owners WHERE contract_id::text = $1",
      [contractId],
    );
    return result.rows[0]?.tenant_id ?? undefined;
  }

  async findScopedContract(tenantId: TenantId, contractId: string): Promise<Contract | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<ContractRow>(
        `SELECT id, tenant_id, title, value_cents, status, created_at
         FROM contracts WHERE id::text = $1`,
        [contractId],
      );
      return result.rows[0] ? toContract(result.rows[0]) : undefined;
    });
  }

  async createContract(tenantId: TenantId, input: NewContract): Promise<Contract> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<ContractRow>(
        `INSERT INTO contracts (id, tenant_id, title, value_cents, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, title, value_cents, status, created_at`,
        [randomUUID(), tenantId, input.title, input.valueCents, input.status],
      );
      const contract = toContract(result.rows[0]!);
      await client.query(
        "INSERT INTO contract_owners (contract_id, tenant_id) VALUES ($1, $2)",
        [contract.id, tenantId],
      );
      return contract;
    });
  }

  async deleteContract(tenantId: TenantId, contractId: string): Promise<boolean> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query("DELETE FROM contracts WHERE id::text = $1", [contractId]);
      return result.rowCount === 1;
    });
  }

  async writeAuditEvent(input: {
    actorTenant: TenantId;
    actorUserId: string;
    resourceId: string;
    resourceTenant?: TenantId;
    decision: GuardDecision;
  }): Promise<void> {
    await this.withTenant(input.actorTenant, async (client) => {
      await client.query(
        `INSERT INTO audit_events
           (id, tenant_id, actor_user_id, resource_id, resource_tenant_id, decision)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), input.actorTenant, input.actorUserId, input.resourceId, input.resourceTenant ?? null, input.decision],
      );
    });
  }

  async recentAuditEvents(tenantId: TenantId): Promise<AuditEvent[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<AuditRow>(
        `SELECT id, occurred_at, tenant_id, actor_user_id, resource_id, resource_tenant_id, decision
         FROM audit_events ORDER BY occurred_at DESC LIMIT 20`,
      );
      return result.rows.map(toAuditEvent);
    });
  }

  async createInvitation(input: {
    tenantId: TenantId;
    createdBy: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO invitations (id, tenant_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), input.tenantId, input.tokenHash, input.createdBy, input.expiresAt],
    );
  }

  async acceptInvitation(tokenHash: string, userId: string): Promise<Membership | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invitation = await client.query<{ tenant_id: string; role: "admin" | "member" }>(
        `SELECT tenant_id, role FROM invitations
         WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash],
      );
      const row = invitation.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query(
        `INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, tenant_id) DO NOTHING`,
        [userId, row.tenant_id, row.role],
      );
      await client.query(
        "UPDATE invitations SET accepted_by = $1, accepted_at = now() WHERE token_hash = $2",
        [userId, tokenHash],
      );
      await client.query("COMMIT");
      return this.getMembership(userId, row.tenant_id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
