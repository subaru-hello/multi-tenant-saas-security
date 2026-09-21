import type { TenantStore } from "./store.js";
import { checkTenantAccess } from "./tenant-guard.js";
import type { InspectionResult, TenantId } from "./types.js";

export async function inspectContract(
  store: TenantStore,
  actorTenant: TenantId,
  actorUserId: string,
  contractId: string,
): Promise<InspectionResult> {
  // Resource IDs may come from a user or an AI agent. They never establish ownership.
  const ownerTenant = await store.resolveContractOwner(contractId);
  const decision = checkTenantAccess(actorTenant, ownerTenant);

  await store.writeAuditEvent({
    actorTenant,
    actorUserId,
    resourceId: contractId,
    resourceTenant: ownerTenant,
    decision,
  });

  if (decision !== "Allow") {
    return { kind: "denied", contractId, decision, externalStatus: 404 };
  }

  // The final query executes with PostgreSQL RLS scoped to actorTenant.
  const contract = await store.findScopedContract(actorTenant, contractId);
  if (!contract) {
    return { kind: "denied", contractId, decision: "UnknownOwner", externalStatus: 404 };
  }
  return { kind: "allowed", contract, decision };
}

export async function inspectBatch(
  store: TenantStore,
  actorTenant: TenantId,
  actorUserId: string,
  contractIds: string[],
): Promise<InspectionResult[]> {
  const results: InspectionResult[] = [];
  for (const id of contractIds) {
    results.push(await inspectContract(store, actorTenant, actorUserId, id));
  }
  return results;
}
