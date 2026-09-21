# @subaruhello/tenant-invariant

Rust-backed tenant isolation checks for TypeScript applications. The package
compiles [`tenant-invariant`](https://crates.io/crates/tenant-invariant) to a
small WebAssembly module and exposes the same API on Node.js, Cloudflare
Workers, and Deno.

```bash
npm install @subaruhello/tenant-invariant
```

## Node.js

```ts
import { checkTenantAccess } from "@subaruhello/tenant-invariant";

const decision = checkTenantAccess(authenticatedTenant, resourceOwnerTenant);
if (decision !== "Allow") {
  // Return a generic not-found response and record the internal reason.
}
```

## Cloudflare Workers

```ts
import { checkTenantAccess } from "@subaruhello/tenant-invariant/cloudflare";
```

Wrangler bundles the included `.wasm` module. An executable Worker and runtime
tests live in `examples/cloudflare-worker` in the repository.

## Deno

Deno 2.1 or newer can import the included Wasm module without additional file
permissions. Declare the npm package in `deno.json` or `package.json`, then use:

```ts
import { checkTenantAccess } from "@subaruhello/tenant-invariant/deno";
```

## Security boundary

Resolve `authenticatedTenant` from trusted authentication context and
`resourceOwnerTenant` independently from your database or trusted metadata.
Never let a request body, query parameter, or AI model choose either value.

This guard is one layer. Keep the final database query tenant-scoped and use
database-level isolation where available. Browser-side checks are intentionally
not provided as an authorization boundary because clients can bypass them.
