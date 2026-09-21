export type TenantId = string;

export type User = {
  id: string;
  githubId: string;
  login: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type Membership = {
  tenantId: TenantId;
  tenantName: string;
  tenantSlug: string;
  role: "admin" | "member";
};

export type Contract = {
  id: string;
  tenantId: TenantId;
  title: string;
  valueCents: number;
  status: "active" | "review";
  createdAt: string;
};

export type GuardDecision =
  | "Allow"
  | "CrossTenant"
  | "UnknownOwner"
  | "InvalidActorTenant";

export type InspectionResult =
  | { kind: "allowed"; contract: Contract; decision: "Allow" }
  | {
      kind: "denied";
      contractId: string;
      decision: Exclude<GuardDecision, "Allow">;
      externalStatus: 404;
    };

export type AuditEvent = {
  id: string;
  occurredAt: string;
  actorTenant: TenantId;
  actorUserId: string;
  resourceId: string;
  resourceTenant?: TenantId;
  decision: GuardDecision;
};

export type GithubProfile = {
  githubId: string;
  login: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};
