import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: {
        bindings: { PROVIDER_MODE: "fixture" },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
