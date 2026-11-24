import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The UI calls /api/*; the dev server forwards it to the FastAPI app.
// API_URL and WEB_PORT let lanes and the demo run side by side.
const apiTarget = process.env.API_URL ?? "http://127.0.0.1:8000";
const port = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  preview: { port, strictPort: true, proxy: { "/api": { target: apiTarget, rewrite: (p) => p.replace(/^\/api/, "") } } },
});
