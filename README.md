# multi-tenant-saas-security

A small TypeScript SaaS application that uses the Rust
[`tenant-invariant`](https://crates.io/crates/tenant-invariant) crate through
WebAssembly before returning tenant-owned data.

The demo models a contract-management SaaS with two tenants. It includes a
deliberate "attack lab" where you can submit another tenant's contract ID and
see the request denied by the Rust guard.

## Why this repository exists

This is a living integration lab for Rust tools that make multi-tenant SaaS
applications safer. `tenant-invariant` is the first tool under test, not the
last: future authorization, audit, policy, and isolation tools can be exercised
against the same small TypeScript application and realistic attack scenarios.

Each experiment should add a thin Rust/Wasm adapter under `rust/`, its
application integration under `src/`, and regression tests that cover both the
allowed path and the tenant-boundary failure. That keeps the security claim
executable instead of leaving it only in documentation.

## What it demonstrates

```text
untrusted resource ID
  -> actor tenant from the server-side session
  -> resource owner resolved from SQLite
  -> tenant-invariant runs through WebAssembly
  -> action is denied or continues to tenant-scoped SQL
```

The tool request never establishes tenant identity. A forged `tenantId` query
or form field is ignored.

## Setup

You need Node.js 20 or newer, Rust, and `wasm-pack`.

```bash
cargo install wasm-pack
npm install
npm run dev
```

Open <http://localhost:3000>.

`npm run dev` builds the Rust adapter and starts the TypeScript server. The
adapter depends on `tenant-invariant = "0.1.0"` from crates.io; the security
decision is not reimplemented in TypeScript.

## Try the scenarios

Start as Tenant A. The dashboard shows only its contracts.

- `alpha-contract-001` is allowed.
- `beta-contract-001` is denied as `CrossTenant`.
- `missing-contract` is denied as `UnknownOwner`.
- Switching the demo session to Tenant B changes the authenticated actor.

The browser sees a generic `404` for denied resources. The dashboard displays
the internal reason only to explain the demo.

You can also exercise the JSON API:

```bash
curl -i http://localhost:3000/api/contracts/alpha-contract-001
curl -i 'http://localhost:3000/api/contracts/beta-contract-001?tenantId=tenant-b'
curl -i -X POST http://localhost:3000/api/contracts/batch \
  -H 'content-type: application/json' \
  -d '{"ids":["alpha-contract-001","beta-contract-001"]}'
```

## Verify it

```bash
npm run verify
```

The tests cover same-tenant access, cross-tenant access, a forged tenant claim,
unknown ownership, a mixed-tenant batch, and switching the server-side demo
session.

## Security boundaries

This repository is an educational demo. The tenant switcher is intentionally
fake authentication. A production application still needs real authentication,
action-level authorization, CSRF protection, rate limiting, secure session
management, and database-level isolation such as PostgreSQL Row-Level Security.

Even after TenantInvariant returns `Allow`, this demo performs a tenant-scoped
SQL query. The guard is one layer, not a substitute for defense in depth.

## License

MIT
