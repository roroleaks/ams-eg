// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { Plugin } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// `@lovable.dev/mcp-js` lazily feature-detects whether it is running inside
// Cloudflare Workers via a guarded `import("cloudflare:workers")` (metrics env
// read, wrapped in try/catch). That specifier only exists on Lovable's
// Cloudflare infrastructure, so Vite's dev-server import analysis cannot
// resolve it and serves a 500. This shim resolves the specifier to an inert
// stub — but ONLY for the `vite dev` server (`command === "serve"`). Production
// and local `vite build` leave the real import untouched.
function devCloudflareEnvShim(): Plugin {
  const STUB_ID = "\0cloudflare-env-stub";
  let command: "serve" | "build" = "serve";
  return {
    name: "dev-cloudflare-env-shim",
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      if (command === "serve" && id === "cloudflare:workers") return STUB_ID;
      return null;
    },
    load(id) {
      if (id === STUB_ID) {
        return "export const env = {}; export default { env };";
      }
      return null;
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPlugin(), devCloudflareEnvShim()],
  },
});
