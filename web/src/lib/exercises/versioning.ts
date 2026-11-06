import { createHash } from "node:crypto";

import { EXERCISE_REGISTRY } from "./registry";
import { coachingConfiguration } from "@/lib/pose/coachingConfig";
import { canonicalJson, effectiveCompensationBands, exerciseVersionPayload } from "./versionPayload";

// The payload lives where the camera page can hash it too (D-49).
export { canonicalJson, effectiveCompensationBands, exerciseVersionPayload };

export function sha256Version(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export const EXERCISE_CONFIG_VERSIONS: Record<string, string> =
  Object.fromEntries(
    Object.entries(EXERCISE_REGISTRY).map(([id, definition]) => [
      id,
      sha256Version(exerciseVersionPayload(definition)),
    ]),
  );

export const REGISTRY_VERSION = sha256Version({
  exercises: EXERCISE_REGISTRY,
  exerciseConfigVersions: EXERCISE_CONFIG_VERSIONS,
});

export const COACHING_CONFIG_VERSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(EXERCISE_REGISTRY).map(([id, definition]) => [id, sha256Version(coachingConfiguration(definition))]),
);

export function getAppRevision(): string {
  const candidate =
    process.env.APP_REVISION ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA;
  return candidate?.trim() || "local-unversioned";
}
