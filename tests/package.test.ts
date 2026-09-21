import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkTenantAccess } from "@subaru-hello/tenant-invariant";

describe("published package API", () => {
  it("allows matching tenants", () => {
    assert.equal(checkTenantAccess("tenant-a", "tenant-a"), "Allow");
  });

  it("denies cross-tenant access", () => {
    assert.equal(checkTenantAccess("tenant-a", "tenant-b"), "CrossTenant");
  });

  it("fails closed when the owner is unknown", () => {
    assert.equal(checkTenantAccess("tenant-a", undefined), "UnknownOwner");
  });
});
