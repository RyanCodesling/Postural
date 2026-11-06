/**
 * export-registry.ts
 *
 * Serializes the exercise registry to JSON so the offline ML pipeline consumes
 * exercise parameters (thresholds, target ROM, compensation metrics, scoring
 * modes, and the compensation-score deduction bands) from a single source of
 * truth, instead of a hand-mirrored copy that could drift. Importing the
 * registry also runs its startup validation, so a malformed registry fails
 * this export loudly.
 *
 * Output shape:
 * { registryVersion, exerciseConfigVersions, exercises, compensationBands }.
 *
 * Run from the web project root:
 *   npx tsx scripts/export-registry.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPENSATION_BANDS, EXERCISE_REGISTRY } from "../src/lib/exercises/registry";
import {
  EXERCISE_CONFIG_VERSIONS,
  REGISTRY_VERSION,
} from "../src/lib/exercises/versioning";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/ -> web/ -> Postural/ -> ml/config/registry.json
const outPath = resolve(scriptDir, "../../ml/config/registry.json");

const payload = {
  registryVersion: REGISTRY_VERSION,
  exerciseConfigVersions: EXERCISE_CONFIG_VERSIONS,
  exercises: EXERCISE_REGISTRY,
  compensationBands: COMPENSATION_BANDS,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

const ids = Object.keys(EXERCISE_REGISTRY);
const bandMetrics = Object.keys(COMPENSATION_BANDS);
console.log(`Wrote ${ids.length} exercises to ${outPath}`);
console.log(`Exercises: ${ids.join(", ")}`);
console.log(`Compensation bands: ${bandMetrics.join(", ")}`);
console.log(`Registry version: ${REGISTRY_VERSION}`);
