import { createHash, randomUUID } from "node:crypto";

import type { NewContract, TenantStore } from "../src/store.js";
import type {
  AuditEvent,
  Contract,
  GithubProfile,
  Membership,
  TenantId,
  User,
} from "../src/types.js";

export class MemoryTenantStore implements TenantStore {
  readonly users = new Map<string, User>();
  readonly memberships: Array<Membership & { userId: string }> = [];
  readonly contracts = new Map<string, Contract>();
  readonly audit: AuditEvent[] = [];
  readonly invitations = new Map<string, { tenantId: string; expiresAt: Date; accepted: boolean }>();

  async ping(): Promise<void> {}

  async upsertGithubUser(profile: GithubProfile): Promise<User> {
    const existing = [...this.users.values()].find((user) => user.githubId === profile.githubId);
    const user: User = {
      id: existing?.id ?? randomUUID(),
      ...profile,
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUser(userId: string): Promise<User | undefined> {
    return this.users.get(userId);
  }

  async ensurePersonalTenant(user: User): Promise<Membership> {
    const existing = this.memberships.find((membership) => membership.userId === user.id);
    if (existing) return existing;
    return this.createTenant(user.id, `${user.displayName}'s Workspace`, `${user.login}-workspace`);
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    return this.memberships.filter((membership) => membership.userId === userId);
  }

  async getMembership(userId: string, tenantId: string): Promise<Membership | undefined> {
    return this.memberships.find(
      (membership) => membership.userId === userId && membership.tenantId === tenantId,
    );
  }

  async createTenant(userId: string, name: string, slug: string): Promise<Membership> {
    const membership = {
      userId,
      tenantId: randomUUID(),
      tenantName: name,
      tenantSlug: slug,
      role: "admin" as const,
    };
    this.memberships.push(membership);
    return membership;
  }

  async listContracts(tenantId: TenantId): Promise<Contract[]> {
    return [...this.contracts.values()].filter((contract) => contract.tenantId === tenantId);
  }

  async resolveContractOwner(contractId: string): Promise<TenantId | undefined> {
    return this.contracts.get(contractId)?.tenantId;
  }

  async findScopedContract(tenantId: TenantId, contractId: string): Promise<Contract | undefined> {
    const contract = this.contracts.get(contractId);
    return contract?.tenantId === tenantId ? contract : undefined;
  }

  async createContract(tenantId: TenantId, input: NewContract): Promise<Contract> {
    const contract: Contract = {
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.contracts.set(contract.id, contract);
    return contract;
  }

  async deleteContract(tenantId: TenantId, contractId: string): Promise<boolean> {
    const contract = await this.findScopedContract(tenantId, contractId);
    return contract ? this.contracts.delete(contractId) : false;
  }

  async writeAuditEvent(input: Omit<AuditEvent, "id" | "occurredAt">): Promise<void> {
    this.audit.unshift({ id: randomUUID(), occurredAt: new Date().toISOString(), ...input });
  }

  async recentAuditEvents(tenantId: TenantId): Promise<AuditEvent[]> {
    return this.audit.filter((event) => event.actorTenant === tenantId).slice(0, 20);
  }

  async createInvitation(input: {
    tenantId: TenantId;
    createdBy: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.invitations.set(input.tokenHash, { tenantId: input.tenantId, expiresAt: input.expiresAt, accepted: false });
  }

  async acceptInvitation(tokenHash: string, userId: string): Promise<Membership | undefined> {
    const invite = this.invitations.get(tokenHash);
    if (!invite || invite.accepted || invite.expiresAt <= new Date()) return undefined;
    invite.accepted = true;
    const tenant = this.memberships.find((membership) => membership.tenantId === invite.tenantId);
    if (!tenant) return undefined;
    const membership = { ...tenant, userId, role: "member" as const };
    this.memberships.push(membership);
    return membership;
  }

  async close(): Promise<void> {}

  static hashInvite(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
