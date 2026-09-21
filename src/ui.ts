import type { AuditEvent, Contract, InspectionResult, Membership, User } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(valueCents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(valueCents / 100);
}

function resultCard(result: InspectionResult | undefined): string {
  if (!result) return "";
  if (result.kind === "allowed") {
    return `<section class="result allow">
      <p class="eyebrow">Rust decision: Allow</p>
      <h2>${escapeHtml(result.contract.title)}</h2>
      <p>${money(result.contract.valueCents)} · ${escapeHtml(result.contract.status)}</p>
      <p class="explain">The final PostgreSQL query was independently restricted by Row-Level Security.</p>
    </section>`;
  }
  return `<section class="result deny">
    <p class="eyebrow">Rust decision: ${escapeHtml(result.decision)}</p>
    <h2>Request blocked</h2>
    <p>The caller receives the same generic 404 for cross-tenant and unknown resources.</p>
  </section>`;
}

export function renderLanding(): string {
  return `<!doctype html>
  <html lang="en"><head>
    <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TenantInvariant SaaS</title><link rel="stylesheet" href="/styles.css" />
  </head><body>
    <main class="landing">
      <section class="hero panel">
        <p class="eyebrow">Rust-backed tenant isolation</p>
        <h1>Contracts stay inside their organization.</h1>
        <p>GitHub authentication, server-side organization membership, PostgreSQL RLS, and TenantInvariant all guard the same boundary.</p>
        <a class="button" href="/auth/github">Continue with GitHub</a>
      </section>
    </main>
  </body></html>`;
}

export function renderInvitationConfirmation(token: string, csrfToken: string): string {
  return `<!doctype html>
  <html lang="en"><head>
    <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Accept invitation</title><link rel="stylesheet" href="/styles.css" />
  </head><body><main class="landing"><section class="hero panel">
    <p class="eyebrow">Organization invitation</p><h1>Join this workspace?</h1>
    <p>The organization name and your role will be visible after the invitation is accepted.</p>
    <form method="post" action="/join/${escapeHtml(token)}">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
      <button type="submit">Accept invitation</button>
      <a class="button secondary" href="/">Cancel</a>
    </form>
  </section></main></body></html>`;
}

export function renderDashboard(input: {
  user: User;
  membership: Membership;
  memberships: Membership[];
  contracts: Contract[];
  audit: AuditEvent[];
  csrfToken: string;
  result?: InspectionResult;
  flash?: string;
  inviteUrl?: string;
}): string {
  const csrf = escapeHtml(input.csrfToken);
  const membershipOptions = input.memberships
    .map(
      (membership) =>
        `<option value="${escapeHtml(membership.tenantId)}" ${membership.tenantId === input.membership.tenantId ? "selected" : ""}>${escapeHtml(membership.tenantName)} · ${membership.role}</option>`,
    )
    .join("");
  const contractRows = input.contracts
    .map(
      (contract) => `<tr>
        <td><code>${escapeHtml(contract.id)}</code></td>
        <td>${escapeHtml(contract.title)}</td><td>${money(contract.valueCents)}</td>
        <td><span class="status">${escapeHtml(contract.status)}</span></td>
        <td><form method="post" action="/contracts/${escapeHtml(contract.id)}/delete"><input type="hidden" name="_csrf" value="${csrf}" /><button class="danger" type="submit">Delete</button></form></td>
      </tr>`,
    )
    .join("");
  const auditRows = input.audit
    .map(
      (event) => `<tr>
        <td>${escapeHtml(new Date(event.occurredAt).toLocaleString("en-US"))}</td>
        <td><code>${escapeHtml(event.resourceId)}</code></td>
        <td>${event.resourceTenant ? `<code>${escapeHtml(event.resourceTenant)}</code>` : "unknown"}</td>
        <td><span class="decision ${event.decision === "Allow" ? "ok" : "blocked"}">${escapeHtml(event.decision)}</span></td>
      </tr>`,
    )
    .join("");
  const ownId = input.contracts[0]?.id ?? "";

  return `<!doctype html>
  <html lang="en"><head>
    <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TenantInvariant SaaS</title><link rel="stylesheet" href="/styles.css" />
  </head><body>
    <header>
      <div><p class="eyebrow">multi-tenant-saas-security</p><h1>Contract Workspace</h1>
      <p>Signed in as <strong>${escapeHtml(input.user.login)}</strong></p></div>
      <div class="header-actions">
        <form method="post" action="/organizations/select" class="tenant-switcher">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <label for="tenantId">Active organization</label><select id="tenantId" name="tenantId">${membershipOptions}</select>
          <button type="submit">Switch</button>
        </form>
        <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${csrf}" /><button class="secondary" type="submit">Sign out</button></form>
      </div>
    </header>
    <main>
      ${input.flash ? `<p class="flash">${escapeHtml(input.flash)}</p>` : ""}
      ${input.inviteUrl ? `<section class="panel invite"><p class="eyebrow">One-time display</p><h2>Invitation link</h2><code>${escapeHtml(input.inviteUrl)}</code></section>` : ""}
      <section class="architecture"><span>GitHub identity</span><b>→</b><span>server membership</span><b>→</b><span>Rust/Wasm guard</span><b>→</b><span>PostgreSQL RLS</span></section>
      ${resultCard(input.result)}
      <div class="grid">
        <section class="panel"><p class="eyebrow">Tenant-scoped data</p><h2>${escapeHtml(input.membership.tenantName)} contracts</h2>
          <div class="table-wrap"><table><thead><tr><th>ID</th><th>Contract</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${contractRows || '<tr><td colspan="5">No contracts yet.</td></tr>'}</tbody></table></div>
        </section>
        <section class="panel"><p class="eyebrow">Create</p><h2>New contract</h2>
          <form method="post" action="/contracts" class="stack"><input type="hidden" name="_csrf" value="${csrf}" />
            <label for="title">Title</label><input id="title" name="title" maxlength="160" required />
            <label for="value">Value (USD)</label><input id="value" name="value" type="number" min="0" max="100000000" step="0.01" required />
            <label for="status">Status</label><select id="status" name="status"><option value="active">Active</option><option value="review">Review</option></select>
            <button type="submit">Create contract</button>
          </form>
        </section>
      </div>
      <div class="grid equal">
        <section class="panel attack-lab"><p class="eyebrow">Attack lab</p><h2>Inspect an untrusted ID</h2>
          <p>Paste an ID from any tenant. Request parameters never select the tenant.</p>
          <form method="post" action="/inspect" class="stack"><input type="hidden" name="_csrf" value="${csrf}" />
            <label for="contractId">Contract ID</label><input id="contractId" name="contractId" value="${escapeHtml(ownId)}" autocomplete="off" />
            <button type="submit">Inspect contract</button>
          </form>
        </section>
        <section class="panel"><p class="eyebrow">Organizations</p><h2>Create or invite</h2>
          <form method="post" action="/organizations" class="stack"><input type="hidden" name="_csrf" value="${csrf}" />
            <label for="name">Organization name</label><input id="name" name="name" maxlength="120" required />
            <label for="slug">Slug</label><input id="slug" name="slug" maxlength="64" placeholder="acme-security" />
            <button type="submit">Create organization</button>
          </form>
          ${input.membership.role === "admin" ? `<form method="post" action="/organizations/invitations" class="invite-form"><input type="hidden" name="_csrf" value="${csrf}" /><button class="secondary" type="submit">Create member invitation</button></form>` : ""}
        </section>
      </div>
      <section class="panel"><p class="eyebrow">Server-only evidence</p><h2>Authorization audit</h2>
        <div class="table-wrap"><table><thead><tr><th>Time</th><th>Resource</th><th>Resolved owner</th><th>Decision</th></tr></thead><tbody>${auditRows || '<tr><td colspan="4">No decisions yet.</td></tr>'}</tbody></table></div>
      </section>
    </main>
  </body></html>`;
}
