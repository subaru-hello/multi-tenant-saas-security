import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./examples/cloudflare-worker/wrangler.jsonc",
      },
    }),
  ],
  test: {
    include: ["examples/cloudflare-worker/test/**/*.test.ts"],
  },
});
