export type TenantId = "tenant-a" | "tenant-b";

export type Contract = {
  id: string;
  tenantId: TenantId;
  title: string;
  value: number;
  status: "active" | "review";
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
