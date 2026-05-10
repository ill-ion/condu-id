import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwind from "@astrojs/tailwind";
import preact from "@astrojs/preact";

// https://astro.build/config
//
// Output strategy:
//   - Most pages render at build time. Server / agent / receipt / anchor
//     directory pages and detail pages all hit api.condu.id at request
//     time during build, but render to static HTML for the `npm run build`
//     output. The directory and detail routes also work as
//     `prerender = false` so they pick up newly-anchored receipts without
//     a redeploy — see individual pages.
//   - DID document routes (/.well-known/did.json under server / agent
//     paths) are server-rendered: they pull from api.condu.id at request
//     time. Cached at the edge via Cache-Control.
//   - /api/chat is server-rendered: streams from Anthropic.
//
// `output: 'hybrid'` lets per-page `prerender` flags choose. Pages that
// need to call into the chat API or DID docs are explicit about it.
export default defineConfig({
  output: "hybrid",
  adapter: cloudflare({
    imageService: "passthrough",
    platformProxy: { enabled: true },
  }),
  integrations: [tailwind({ applyBaseStyles: false }), preact({ compat: false })],
  site: "https://condu.id",
  // Trim the bundle: don't ship the Astro dev runtime.
  vite: {
    ssr: {
      // The Anthropic SDK uses Node-style `process` references in places
      // that Cloudflare Workers don't ship. Mark it external so esbuild
      // doesn't try to transform it.
      external: ["@anthropic-ai/sdk"],
    },
  },
});
