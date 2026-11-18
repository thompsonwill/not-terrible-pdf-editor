// Cloudflare Workers deployment (static assets only — the app has no server code).
// Deploy with `npm run deploy`: builds with Vite, then `cf deploy ./dist` uploads the
// static files using the settings below.
import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "pdf-editor",
    compatibilityDate: "2026-11-01",
    assets: {
      // Unknown paths fall back to index.html.
      notFoundHandling: "single-page-application",
    },
    // Cloudflare creates the DNS record and issues a certificate for this hostname
    // (including the second-level subdomain) on deploy.
    domains: ["pdf-editor.t.erminally.online"],
  },
});
