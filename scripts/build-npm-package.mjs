import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const crateDirectory = join(repositoryRoot, "rust", "tenant-guard-wasm");
const outputRoot = join(repositoryRoot, "packages", "tenant-invariant", "dist");

await rm(outputRoot, { recursive: true, force: true });

for (const [runtime, target] of [
  ["node", "nodejs"],
  ["cloudflare", "web"],
  // Deno 2.1+ imports Wasm modules natively. The bundler output uses that
  // path and avoids requiring --allow-read just to load the package binary.
  ["deno", "bundler"],
]) {
  const wasmOutput = join(outputRoot, runtime, "wasm");
  execFileSync(
    "wasm-pack",
    [
      "build",
      crateDirectory,
      "--target",
      target,
      "--out-dir",
      wasmOutput,
      "--out-name",
      "tenant_invariant",
      "--release",
    ],
    { stdio: "inherit" },
  );

  // wasm-pack ignores generated output by default. Inside an npm workspace,
  // npm also treats this nested file as a packaging exclusion and would omit
  // the Wasm binary from the published tarball.
  await rm(join(wasmOutput, ".gitignore"), { force: true });
}

const declaration = `export type GuardDecision =
  | "Allow"
  | "CrossTenant"
  | "UnknownOwner"
  | "InvalidActorTenant";

/**
 * Compare the authenticated actor tenant with independently resolved
 * resource ownership. Missing or invalid ownership fails closed.
 */
export declare function checkTenantAccess(
  actorTenant: string,
  ownerTenant?: string | null,
): GuardDecision;
`;

const esmWrapper = `import { check_tenant_access } from "./wasm/tenant_invariant.js";

export function checkTenantAccess(actorTenant, ownerTenant) {
  return check_tenant_access(actorTenant, ownerTenant);
}
`;

const cloudflareWrapper = `import wasmModule from "./wasm/tenant_invariant_bg.wasm";
import { check_tenant_access, initSync } from "./wasm/tenant_invariant.js";

initSync({ module: wasmModule });

export function checkTenantAccess(actorTenant, ownerTenant) {
  return check_tenant_access(actorTenant, ownerTenant);
}
`;

const nodeEsmWrapper = `import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { check_tenant_access } = require("./wasm/tenant_invariant.js");

export function checkTenantAccess(actorTenant, ownerTenant) {
  return check_tenant_access(actorTenant, ownerTenant);
}
`;

const nodeCommonJsWrapper = `const { check_tenant_access } = require("./wasm/tenant_invariant.js");

function checkTenantAccess(actorTenant, ownerTenant) {
  return check_tenant_access(actorTenant, ownerTenant);
}

module.exports = { checkTenantAccess };
`;

for (const runtime of ["node", "cloudflare", "deno"]) {
  const runtimeDirectory = join(outputRoot, runtime);
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(join(runtimeDirectory, "index.d.ts"), declaration);
  await writeFile(
    join(runtimeDirectory, "index.js"),
    runtime === "node"
      ? nodeEsmWrapper
      : runtime === "cloudflare"
        ? cloudflareWrapper
        : esmWrapper,
  );
}

await writeFile(join(outputRoot, "node", "index.cjs"), nodeCommonJsWrapper);

const wasmBytes = await readFile(
  join(outputRoot, "node", "wasm", "tenant_invariant_bg.wasm"),
);
console.log(`Built @subaru-hello/tenant-invariant (${wasmBytes.byteLength} byte Wasm binary).`);
