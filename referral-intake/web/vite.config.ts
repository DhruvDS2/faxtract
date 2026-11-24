import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The UI calls /api/*; the dev server forwards it to the FastAPI app.
// API_URL and WEB_PORT let lanes and the demo run side by side.
const apiTarget = process.env.API_URL ?? "http://127.0.0.1:8000";
const port = Number(process.env.WEB_PORT ?? 5173);

const nm = (...pkgs: string[]) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${pkgs.join("|")})[\\\\/]`);

const RADIX = nm("@radix-ui", "@floating-ui", "react-remove-scroll", "react-remove-scroll-bar", "react-style-singleton", "use-callback-ref", "use-sidecar", "aria-hidden", "get-nonce", "detect-node-es");

/**
 * Vendor chunks (rolldown code-splitting groups), so a change in app code doesn't
 * bust the cache of the libraries, and heavy libraries load only with their route:
 *   react · router-query · radix (+ radix-ui on demand) · motion (initial part only) · vendor (shell libs)
 *   · table · xyflow · pdf
 * Route chunks come from the lazy routes in src/app/App.tsx. Budget: npm run check:bundle.
 */
const vendorGroups = [
  { name: "react", test: nm("react", "react-dom", "scheduler"), priority: 70 },
  { name: "router-query", test: nm("react-router", "react-router-dom", "@tanstack[\\\\/]react-query", "@tanstack[\\\\/]query-core", "cookie", "set-cookie-parser"), priority: 60 },
  // Radix: what the shell needs at start (tooltip, slot), and the rest (dialog, select, menus…) on demand
  { name: "radix", test: RADIX, tags: ["$initial" as const], priority: 50 },
  { name: "radix-ui", test: RADIX, priority: 45, entriesAware: true },
  // only the part the shell needs at start; the animation features stay in their lazy chunk
  { name: "motion", test: nm("motion", "framer-motion", "motion-dom", "motion-utils"), tags: ["$initial" as const], priority: 40 },
  // small libraries the shell itself uses (clsx, tailwind-merge, cva, sonner, lucide…), claimed
  // before the route groups below so a route library's dependency never drags them along
  { name: "vendor", test: /[\\/]node_modules[\\/]/, tags: ["$initial" as const], priority: 35 },
  { name: "table", test: nm("@tanstack[\\\\/]react-table", "@tanstack[\\\\/]table-core"), priority: 30 },
  { name: "xyflow", test: nm("@xyflow", "d3-[a-z-]+", "classcat", "zustand", "use-sync-external-store"), priority: 30 },
  { name: "pdf", test: nm("react-pdf", "pdfjs-dist", "make-cancellable-promise", "make-event-props", "merge-refs"), priority: 30 },
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    // pdf.js (the worker and its core) is large by nature and loads only on the detail page
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: vendorGroups },
        // per-route vendor splits are named after every route that shares them; keep the group name only
        chunkFileNames: (chunk) => `assets/${chunk.name.split("~")[0]}-[hash].js`,
      },
    },
  },
  server: {
    port,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  preview: { port, strictPort: true, proxy: { "/api": { target: apiTarget, rewrite: (p) => p.replace(/^\/api/, "") } } },
});
