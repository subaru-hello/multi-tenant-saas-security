import type { AuditRow } from "./database.js";
import type { Contract, InspectionResult, TenantId } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function resultCard(result: InspectionResult | undefined): string {
  if (!result) return "";
  if (result.kind === "allowed") {
    return `
      <section class="result allow">
        <p class="eyebrow">Rust decision: Allow</p>
        <h2>${escapeHtml(result.contract.title)}</h2>
        <p>${money(result.contract.value)} · ${escapeHtml(result.contract.status)}</p>
        <p class="explain">The final SQL query was scoped to <code>${result.contract.tenantId}</code>.</p>
      </section>`;
  }

  return `
    <section class="result deny">
      <p class="eyebrow">Rust decision: ${escapeHtml(result.decision)}</p>
      <h2>Request blocked</h2>
      <p>The external response is a generic <code>404</code> so the caller cannot enumerate another tenant's resources.</p>
      <p class="explain">This internal reason is shown only because this is a security demo.</p>
    </section>`;
}

export function renderDashboard(input: {
  actorTenant: TenantId;
  contracts: Contract[];
  audit: AuditRow[];
  result?: InspectionResult;
}): string {
  const otherTenant = input.actorTenant === "tenant-a" ? "tenant-b" : "tenant-a";
  const attackId = input.actorTenant === "tenant-a" ? "beta-contract-001" : "alpha-contract-001";
  const ownId = input.contracts[0]?.id ?? "";

  const contractRows = input.contracts
    .map(
      (contract) => `
        <tr>
          <td><code>${contract.id}</code></td>
          <td>${escapeHtml(contract.title)}</td>
          <td>${money(contract.value)}</td>
          <td><span class="status">${contract.status}</span></td>
        </tr>`,
    )
    .join("");

  const auditRows = input.audit
    .map(
      (row) => `
        <tr>
          <td>${row.id}</td>
          <td><code>${escapeHtml(row.actor_tenant)}</code></td>
          <td><code>${escapeHtml(row.resource_id)}</code></td>
          <td>${row.resource_tenant ? `<code>${escapeHtml(row.resource_tenant)}</code>` : "unknown"}</td>
          <td><span class="decision ${row.decision === "Allow" ? "ok" : "blocked"}">${row.decision}</span></td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>TenantInvariant SaaS Lab</title>
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body>
      <header>
        <div>
          <p class="eyebrow">multi-tenant-saas-security</p>
          <h1>TenantInvariant SaaS Lab</h1>
          <p>TypeScript SaaS · SQLite ownership · Rust/Wasm authorization</p>
        </div>
        <form method="post" action="/session" class="tenant-switcher">
          <label for="tenantId">Authenticated tenant</label>
          <select id="tenantId" name="tenantId">
            <option value="tenant-a" ${input.actorTenant === "tenant-a" ? "selected" : ""}>Tenant A / Acme</option>
            <option value="tenant-b" ${input.actorTenant === "tenant-b" ? "selected" : ""}>Tenant B / Beacon</option>
          </select>
          <button type="submit">Switch demo session</button>
        </form>
      </header>

      <main>
        <section class="architecture">
          <span>session: <strong>${input.actorTenant}</strong></span>
          <b>→</b><span>resource ID: untrusted</span>
          <b>→</b><span>owner: SQLite</span>
          <b>→</b><span>guard: Rust/Wasm</span>
          <b>→</b><span>scoped SQL</span>
        </section>

        ${resultCard(input.result)}

        <div class="grid">
          <section class="panel">
            <p class="eyebrow">Visible data</p>
            <h2>${input.actorTenant}'s contracts</h2>
            <div class="table-wrap">
              <table><thead><tr><th>ID</th><th>Contract</th><th>Value</th><th>Status</th></tr></thead>
              <tbody>${contractRows}</tbody></table>
            </div>
          </section>

          <section class="panel attack-lab">
            <p class="eyebrow">Attack lab</p>
            <h2>Try an agent-selected ID</h2>
            <p>The form sends only a resource ID. A supplied <code>tenant_id</code> is never trusted.</p>
            <form method="post" action="/inspect">
              <label for="contractId">Contract ID</label>
              <input id="contractId" name="contractId" value="${attackId}" autocomplete="off" />
              <input type="hidden" name="tenantId" value="${otherTenant}" />
              <button type="submit">Inspect contract</button>
            </form>
            <div class="quick-tests">
              <code>Own: ${ownId}</code>
              <code>Cross-tenant: ${attackId}</code>
              <code>Unknown: missing-contract</code>
            </div>
          </section>
        </div>

        <section class="panel">
          <p class="eyebrow">Server-only evidence</p>
          <h2>Recent authorization decisions</h2>
          <div class="table-wrap">
            <table><thead><tr><th>#</th><th>Actor</th><th>Resource</th><th>Resolved owner</th><th>Decision</th></tr></thead>
            <tbody>${auditRows || '<tr><td colspan="5">No decisions yet.</td></tr>'}</tbody></table>
          </div>
        </section>
      </main>
    </body>
  </html>`;
}
