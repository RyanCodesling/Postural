import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// This Next.js/Turbopack version treats a new URL(...worker.ts) as a raw
// asset. Bundle only this worker; keep the app's existing build unchanged.
await build({
  absWorkingDir: web,
  entryPoints: ["src/lib/analytics/trendFit.worker.ts"],
  outfile: "public/workers/trend-fit.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2020",
  minify: true,
  legalComments: "none",
  logLevel: "info",
});
