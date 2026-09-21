import {
  findOwner,
  findScopedContract,
  writeAuditLog,
  type DemoDatabase,
} from "./database.js";
import { checkTenantAccess } from "./tenant-guard.js";
import type { InspectionResult, TenantId } from "./types.js";

export function inspectContract(
  db: DemoDatabase,
  actorTenant: TenantId,
  contractId: string,
): InspectionResult {
  // The ID is untrusted: it may have been supplied by a user or an AI agent.
  const ownerTenant = findOwner(db, contractId);

  // Both inputs are resolved outside the model: actor from authenticated context,
  // owner from the application's database.
  const decision = checkTenantAccess(actorTenant, ownerTenant);
  writeAuditLog(db, actorTenant, contractId, ownerTenant, decision);

  if (decision !== "Allow") {
    return { kind: "denied", contractId, decision, externalStatus: 404 };
  }

  // Defense in depth: the final read is tenant-scoped even after the guard allows it.
  const contract = findScopedContract(db, contractId, actorTenant);
  if (!contract) {
    return {
      kind: "denied",
      contractId,
      decision: "UnknownOwner",
      externalStatus: 404,
    };
  }

  return { kind: "allowed", contract, decision };
}

export function inspectBatch(
  db: DemoDatabase,
  actorTenant: TenantId,
  contractIds: string[],
): InspectionResult[] {
  return contractIds.map((id) => inspectContract(db, actorTenant, id));
}
