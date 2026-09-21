import { createRequire } from "node:module";

import type { GuardDecision } from "./types.js";

type TenantGuardWasm = {
  check_tenant_access(
    actorTenant: string,
    ownerTenant?: string | null,
  ): GuardDecision;
};

const require = createRequire(import.meta.url);
const wasm = require("../generated/tenant-guard/tenant_guard_wasm.js") as TenantGuardWasm;

export function checkTenantAccess(
  actorTenant: string,
  ownerTenant: string | undefined,
): GuardDecision {
  return wasm.check_tenant_access(actorTenant, ownerTenant);
}
