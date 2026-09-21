# multi-tenant-saas-security

[![CI](https://github.com/subaru-hello/multi-tenant-saas-security/actions/workflows/ci.yml/badge.svg)](https://github.com/subaru-hello/multi-tenant-saas-security/actions/workflows/ci.yml)

A working TypeScript contract-management SaaS and security lab for Rust tools
that protect multi-tenant applications. It uses the published
[`@subaru-hello/tenant-invariant`](https://www.npmjs.com/package/@subaru-hello/tenant-invariant)
WebAssembly package in Node.js.

The application includes GitHub OAuth, organizations, admin/member
memberships, invitations, contract CRUD, server-side sessions, CSRF defense,
authorization audit events, PostgreSQL Row-Level Security, and a Kubernetes
deployment for a self-hosted server.

## The boundary

```text
GitHub identity
  -> membership loaded by the server
  -> untrusted contract ID
  -> owner metadata resolved independently
  -> tenant-invariant returns Allow / CrossTenant / UnknownOwner
  -> final content query runs with PostgreSQL RLS
```

Request bodies, query parameters, and AI model output never choose the active
tenant. A server-side session chooses a tenant only after membership has been
verified. Cross-tenant and unknown resources both return a generic `404`, while
the internal decision is recorded in the actor tenant's audit log.

The database user used by the application is deliberately not the PostgreSQL
bootstrap superuser. `contracts` and `audit_events` use both `ENABLE ROW LEVEL
SECURITY` and `FORCE ROW LEVEL SECURITY`. An unrestricted metadata table holds
only the contract-to-tenant mapping needed by the Rust guard; contract content
remains behind RLS.

## Run locally

Create a PostgreSQL database and a non-superuser application role. Set:

```bash
export DATABASE_URL='postgresql://tenant_saas_app:password@127.0.0.1:5432/tenant_saas'
export BASE_URL='http://127.0.0.1:3000'
export SESSION_SECRET="$(openssl rand -hex 32)"
export GITHUB_CLIENT_ID='<github-oauth-client-id>'
export GITHUB_CLIENT_SECRET='<github-oauth-client-secret>'
npm install
npm run dev
```

The GitHub OAuth callback for local development is:
`http://127.0.0.1:3000/auth/github/callback`.

## Verify it

```bash
npm run verify
```

That command verifies TypeScript, the Node application, Cloudflare Workers,
Deno, the Wrangler bundle, and npm package contents. The PostgreSQL integration
test is enabled when `TEST_DATABASE_URL` is present:

```bash
TEST_DATABASE_URL='postgresql://tenant_saas_app:password@127.0.0.1:5432/tenant_saas' \
  npm run test:postgres
```

The integration test demonstrates that an unscoped SQL query sees zero
contract rows, a tenant-scoped query cannot retrieve another tenant's contract,
and TenantInvariant records `CrossTenant` for that same attack.

## Runtime package examples

The npm package also has tested runtime-specific entry points:

```ts
// Node.js
import { checkTenantAccess } from "@subaru-hello/tenant-invariant";

// Cloudflare Workers
import { checkTenantAccess } from "@subaru-hello/tenant-invariant/cloudflare";

// Deno
import { checkTenantAccess } from "@subaru-hello/tenant-invariant/deno";
```

Executable Cloudflare and Deno examples live under `examples/`. Browser-side
authorization is intentionally excluded because clients can bypass it.

## Home server deployment

[`deploy/kubernetes`](deploy/kubernetes) targets `octom-server`: kubeadm,
containerd, Cilium, `local-path` storage, NodePort `30302`, and a host-managed
Cloudflare Tunnel. The intended public URL is
`https://saas.octomblog.com`. GitHub Actions verifies the project, builds a
`linux/amd64` image, and publishes it to GitHub Container Registry.

See [`deploy/kubernetes/README.md`](deploy/kubernetes/README.md) for OAuth,
secret, deployment, and tunnel setup.

## Security scope

This is a deployable small SaaS, not a claim that one guard solves
multi-tenancy. Production operation still requires backups, dependency and
image updates, TLS at the edge, monitoring, OAuth secret rotation, recovery
testing, and review of database migrations and authorization changes.

## License

MIT
