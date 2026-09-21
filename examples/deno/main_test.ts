import { checkTenantAccess } from "@subaruhello/tenant-invariant/deno";

function assertEquals(actual: unknown, expected: unknown): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("allows matching tenants", () => {
  assertEquals(checkTenantAccess("tenant-a", "tenant-a"), "Allow");
});

Deno.test("denies cross-tenant access", () => {
  assertEquals(checkTenantAccess("tenant-a", "tenant-b"), "CrossTenant");
});

Deno.test("fails closed for unknown ownership", () => {
  assertEquals(checkTenantAccess("tenant-a", undefined), "UnknownOwner");
});
