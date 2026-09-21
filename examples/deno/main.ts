import { checkTenantAccess } from "@subaru-hello/tenant-invariant/deno";

export function canReadContract(
  authenticatedTenant: string,
  resourceOwnerTenant?: string,
): boolean {
  return checkTenantAccess(authenticatedTenant, resourceOwnerTenant) === "Allow";
}
