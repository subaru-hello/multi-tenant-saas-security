import { checkTenantAccess } from "@subaru-hello/tenant-invariant/cloudflare";

const authenticatedTenant = "tenant-a";
const resourceOwners = new Map<string, string>([
  ["alpha-contract-001", "tenant-a"],
  ["beta-contract-001", "tenant-b"],
]);

function notFound(): Response {
  return Response.json({ error: "Contract not found" }, { status: 404 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const match = /^\/contracts\/([^/]+)$/.exec(url.pathname);
      if (request.method !== "GET" || !match) {
        return notFound();
      }

      const contractId = decodeURIComponent(match[1]);
      const ownerTenant = resourceOwners.get(contractId);
      const decision = checkTenantAccess(authenticatedTenant, ownerTenant);

      console.log(
        JSON.stringify({
          message: "tenant access checked",
          actorTenant: authenticatedTenant,
          contractId,
          decision,
        }),
      );

      if (decision !== "Allow") {
        return notFound();
      }

      return Response.json({
        contract: { id: contractId, tenantId: ownerTenant },
        decision,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
