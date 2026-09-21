import type {
  AuditEvent,
  Contract,
  GithubProfile,
  GuardDecision,
  Membership,
  TenantId,
  User,
} from "./types.js";

export type NewContract = {
  title: string;
  valueCents: number;
  status: "active" | "review";
};

export interface TenantStore {
  ping(): Promise<void>;
  upsertGithubUser(profile: GithubProfile): Promise<User>;
  getUser(userId: string): Promise<User | undefined>;
  ensurePersonalTenant(user: User): Promise<Membership>;
  listMemberships(userId: string): Promise<Membership[]>;
  getMembership(userId: string, tenantId: TenantId): Promise<Membership | undefined>;
  createTenant(userId: string, name: string, slug: string): Promise<Membership>;
  listContracts(tenantId: TenantId): Promise<Contract[]>;
  resolveContractOwner(contractId: string): Promise<TenantId | undefined>;
  findScopedContract(tenantId: TenantId, contractId: string): Promise<Contract | undefined>;
  createContract(tenantId: TenantId, input: NewContract): Promise<Contract>;
  deleteContract(tenantId: TenantId, contractId: string): Promise<boolean>;
  writeAuditEvent(input: {
    actorTenant: TenantId;
    actorUserId: string;
    resourceId: string;
    resourceTenant?: TenantId;
    decision: GuardDecision;
  }): Promise<void>;
  recentAuditEvents(tenantId: TenantId): Promise<AuditEvent[]>;
  createInvitation(input: {
    tenantId: TenantId;
    createdBy: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  acceptInvitation(tokenHash: string, userId: string): Promise<Membership | undefined>;
  close(): Promise<void>;
}
