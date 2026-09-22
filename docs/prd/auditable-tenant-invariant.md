# PRD: Auditable TenantInvariant

Status: Draft  
Owner: subaru-hello  
Scope: `tenant-invariant` ecosystem and `multi-tenant-saas-security`

## 1. Why this exists

`tenant-invariant` currently makes one narrow security decision: an authenticated actor tenant may access a resource only when the server-resolved resource owner is the same tenant. The SaaS demo records the resulting decision, but its audit event cannot yet answer all of these questions after an incident:

- Which HTTP request and authenticated user caused the check?
- Which action was being requested?
- Which policy version made the decision?
- Did the protected operation run, fail, or get skipped?
- In a batch, did one cross-tenant item prevent every protected operation?

AI agents make this evidence more important. A model can propose resource IDs, but the application must be able to demonstrate that it resolved ownership server-side, enforced the tenant boundary, and did not execute an unapproved operation.

## 2. Product statement

Add an optional, storage-agnostic audit model around TenantInvariant decisions and demonstrate it in the self-hosted SaaS. The system produces append-only authorization and execution evidence for each protected resource, including mixed-tenant batches.

The core `tenant-invariant` crate remains a small, pure ownership comparison. It does not gain database, logging, tracing, HTTP, OpenTelemetry, or AI SDK dependencies.

## 3. Goals

- Record an auditable tenant-boundary decision before a protected resource operation runs.
- Record whether that protected operation was skipped, succeeded, returned no scoped resource, or failed.
- Make batch authorization all-or-nothing: if any item is denied or unresolved, do not start a protected read or mutation for any item.
- Preserve the external behavior that cross-tenant and unknown resources both appear as `404`.
- Let Rust applications use the same event schema without adopting the SaaS database.
- Prove the behavior with deterministic and property-based mixed-tenant tests.

## 4. Non-goals for v1

- Replacing action authorization systems such as OpenFGA, Cedar, or OPA.
- Authenticating users or deriving tenant membership.
- Capturing model prompts, tool arguments beyond resource IDs, contract content, or secrets.
- Claiming a tamper-evident or legally immutable log.
- Adding a distributed logging system, message queue, or external SIEM dependency.
- Making browser-side authorization a security boundary.

## 5. Terms

| Term | Meaning |
| --- | --- |
| Actor tenant | Tenant chosen from server-side authenticated membership. |
| Resource owner | Tenant resolved by the server from a trusted ownership source. |
| Decision | `Allow`, `CrossTenant`, `UnknownOwner`, or `InvalidActorTenant`. |
| Authorization evidence | An immutable-in-practice record of the inputs and result of one policy decision. |
| Execution evidence | A second record describing what happened after an allowed decision. |
| Policy version | A stable identifier for the deployed decision rules, for example `tenant-invariant@0.1.0; app-policy@1`. |
| Request ID | Server-generated or validated inbound identifier that links events from one request. |

## 6. User stories

### SaaS operator

When a user or agent asks to read a contract, I can see the actor tenant, resolved owner, requested action, policy version, decision, and result without exposing contract content.

### Security reviewer

When a customer reports suspected cross-tenant access, I can prove whether the request was denied before the data query and whether a database-scoped query was ever attempted.

### Library user

When I use TenantInvariant in a Rust service, I can serialize a standard decision-evidence object to my own logging or audit system without importing a database driver.

### Test author

When a batch has nine permitted resource IDs and one foreign ID, I can assert that the batch produces no resource payload and that no protected operation begins for any item.

## 7. Proposed design

### 7.1 Boundary and modules

```text
tenant-invariant                     tenant-invariant-audit
pure ownership decision              serializable evidence types/builders
Allow / Deny                         no database or transport dependency
          \                         /
           \                       /
            SaaS authorization adapter
 request context -> preflight all IDs -> append evidence -> scoped operation
                                             |
                                    PostgreSQL append-only event tables
```

The Rust library project owns the decision and evidence contracts. The SaaS owns request handling, PostgreSQL persistence, RLS, UI, and operational retention. This prevents a reusable crate from being coupled to one database or cloud provider.

### 7.2 Evidence contract

`tenant-invariant-audit` will provide serializable Rust types for a decision event and an execution event. The event contract is intentionally data-only; callers select the storage sink.

Required decision-event fields:

| Field | Example | Purpose |
| --- | --- | --- |
| `event_id` | UUID | Unique immutable record ID. |
| `occurred_at` | RFC 3339 timestamp | Ordering and incident reconstruction. |
| `request_id` | UUID or validated inbound ID | Correlates records from one request. |
| `actor_user_id` | UUID | Identifies the authenticated actor. |
| `actor_tenant_id` | UUID | Server-selected tenancy context. |
| `resource_type` | `contract` | Avoids ambiguous IDs across resource families. |
| `resource_id` | UUID/string | ID proposed by a user or model. |
| `resolved_owner_tenant_id` | UUID/null | Trusted ownership lookup result, not a model claim. |
| `action` | `contract.read` | Operation being authorized. |
| `policy_version` | string | Lets reviewers reproduce the decision rules. |
| `decision` | `Allow` / denial reason | TenantInvariant result. |
| `source` | `web` / `agent_tool` / `api` | Optional caller class; never raw prompt text. |

Execution evidence is a second append-only event linked by `decision_event_id` and contains `outcome`:

- `skipped_denied`
- `succeeded`
- `not_found_after_allow`
- `failed`

Two events are used instead of updating a decision row after the query. This preserves a chronological history and permits future write-only storage.

### 7.3 SaaS database changes

The existing `audit_events` table becomes two tables:

- `authorization_decisions`: one row per resource and preflight decision.
- `authorization_executions`: one row per allowed decision describing the later operation outcome.

Both tables retain tenant RLS and `FORCE ROW LEVEL SECURITY`. They gain indexes on `(tenant_id, occurred_at DESC)` and `(request_id, occurred_at)`.

The production application role may insert and select tenant-scoped events, but must not update or delete them. The schema migration owner remains separate from the runtime application role. A database trigger will reject `UPDATE` and `DELETE` on these tables for runtime connections.

This is append-only application evidence, not tamper-evidence: a database administrator can still alter records. A future version can add independent export and integrity chaining after the event schema is proven useful.

### 7.4 Request lifecycle

1. Middleware accepts a valid inbound request ID or creates a UUID. It never uses a client value as an authorization input.
2. The application obtains the authenticated user and active tenant from the server-side session.
3. For a single resource, the server resolves ownership, writes one decision event, then either stops or runs the tenant-scoped query.
4. After an allowed scoped query, it writes one execution event with its outcome.
5. If writing required evidence fails, the operation fails closed with `503`; protected data is not returned.
6. The external response for denied or unknown resources remains a generic `404`.

### 7.5 Batch lifecycle

1. Validate and deduplicate at most 20 proposed IDs.
2. Resolve ownership for every ID without fetching protected content.
3. Write decision evidence for every ID in a single database transaction.
4. If any decision is not `Allow`, write `skipped_denied` execution evidence for allowed candidates as appropriate, commit the evidence, and return generic `404` without fetching or mutating any protected resource.
5. Only when every decision is `Allow`, execute the tenant-scoped read or mutation for the entire batch and write execution evidence.

The batch API will not return partial data. Future mutation APIs must use the same preflight contract before their first side effect.

## 8. Delivery milestones

### Milestone A — Event contract

- Create the `tenant-invariant-audit` Rust crate beside the core crate.
- Define `DecisionEvidence`, `ExecutionEvidence`, actions, sources, outcomes, and policy-version validation.
- Derive `Serialize`/`Deserialize`; add unit tests and property tests for event invariants.
- Publish only after the schema has been exercised by the SaaS integration.

### Milestone B — SaaS audit v1

- Add request-ID middleware and response header.
- Migrate the current audit schema to decision and execution tables.
- Add a policy-version constant and audit sink interface.
- Record evidence around single-contract reads and writes.
- Update the dashboard to show action, policy version, request ID, decision, and execution outcome without rendering sensitive content.

### Milestone C — Atomic batch preflight

- Replace sequential `inspectBatch` execution with ownership resolution and decision preflight for all IDs.
- Ensure final scoped fetches or mutations start only after all decisions allow.
- Add mixed-tenant, unknown-owner, duplicate-ID, and maximum-size tests.

### Milestone D — Reusable test kit

- Add `tenant-invariant-testkit` scenarios for single-resource and mixed-batch attacks.
- Offer adapters for Rust services first; add Node/Wasm helpers only when a real consumer needs them.
- Run the SaaS scenario suite against PostgreSQL RLS in CI.

### Milestone E — Integrity hardening (separate PRD)

- Decide whether the threat model needs external log export, per-event signatures, hash chaining, WORM storage, or SIEM integration.
- Do not use the phrase `tamper-evident` until verification and operational key management exist.

## 9. Acceptance criteria for v1

- Every protected single-resource operation produces one decision event.
- Every allowed protected operation produces one linked execution event.
- Decision events include request ID, action, policy version, actor tenant, resolved owner, and outcome-relevant fields.
- Audit write failure returns `503` and prevents protected data or mutations.
- A mixed batch with one foreign or unknown resource returns no contract payload and begins no protected resource operation.
- A cross-tenant attempt is externally indistinguishable from an unknown resource but internally distinguishable in the tenant-scoped audit view.
- PostgreSQL integration tests confirm RLS still prevents unscoped reads of contracts and audit records.
- Rust event types serialize deterministically and contain no prompt text, secret, or protected resource content.

## 10. Open decisions

- Should `request_id` accept a client-provided trace header, or always generate a new server UUID and store an external correlation ID separately?
- Is `source=agent_tool` needed in v1, or should the first release use `web` and `api` only until an agent route exists?
- Should denied batch candidates receive execution events, or should the decision event alone imply no execution? The recommended default is an explicit `skipped_denied` event for audit clarity.
- What retention period and export path are appropriate before customers can use this for compliance evidence?
