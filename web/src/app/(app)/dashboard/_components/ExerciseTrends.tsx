"use client";

// Shared per-exercise progress-trend rendering, used by both the therapist
// patient-detail page and the patient "My Progress" view. Pure presentation over
// already-persisted per-session summaries. Trends are DESCRIPTIVE STATISTICS —
// not the ML model, not a diagnosis. Left/right are never summed.

import { getExerciseDefinition } from "@/lib/exercises/registry";
import TrendChart from "./TrendChart";

/** The per-session fields the trends need. Both dashboards' session shapes (from
 *  GET /api/sessions → getSessionsForPatient) structurally satisfy this. */
export interface TrendSession {
  exerciseId: string;
  exerciseName: string;
  exerciseKind: "dynamic" | "isometric" | null;
  startedAt: string;
  avgPeakValue: number | null;
  completeLeftReps: number;
  completeRightReps: number;
  totalPairedHoldMs: number | null;
  setCount: number;
  totalReps: number;
}

type TrendStatus = "improving" | "plateau" | "regressing";

export interface TrendGroup {
  exerciseId: string;
  exerciseName: string;
  exerciseKind: TrendSession["exerciseKind"];
  sessions: TrendSession[]; // oldest → newest
}

const STATUS_STYLE: Record<TrendStatus, { label: string; classes: string }> = {
  improving:  { label: "Improving",  classes: "bg-green-100 text-green-700" },
  plateau:    { label: "Plateau",    classes: "bg-gray-100 text-gray-600" },
  regressing: { label: "Regressing", classes: "bg-amber-100 text-amber-700" },
};

// Group sessions by exercise. Outcome-bearing sessions only (a started-then-
// abandoned session has no reps/sets and would add spurious zero points). Input
// is newest-first (the API orders started_at DESC), so each group is reversed to
// oldest→newest for the time axis; groups are ordered by most-recent activity.
export function groupSessionsByExercise(sessions: TrendSession[]): TrendGroup[] {
  const real = sessions.filter((s) => s.setCount > 0 || s.totalReps > 0);
  const map = new Map<string, TrendSession[]>();
  for (const s of real) {
    const arr = map.get(s.exerciseId) ?? [];
    arr.push(s);
    map.set(s.exerciseId, arr);
  }
  return Array.from(map.values())
    .map((list) => ({
      exerciseId:   list[0].exerciseId,
      exerciseName: list[0].exerciseName,
      // Authoritative from the registry — NOT list[0].exerciseKind, which is
      // derived from set_events and is null for an abandoned/legacy newest
      // session (would mislabel e.g. an isometric card as dynamic). Fall back to
      // the first session that does carry a kind, then null.
      exerciseKind:
        getExerciseDefinition(list[0].exerciseId)?.kind ??
        list.find((s) => s.exerciseKind != null)?.exerciseKind ??
        null,
      sessions:     [...list].reverse(),
    }))
    .sort((a, b) =>
      b.sessions[b.sessions.length - 1].startedAt.localeCompare(
        a.sessions[a.sessions.length - 1].startedAt,
      ),
    );
}

// The session's primary trend value: ROM (avgPeakValue) for dynamic exercises,
// hold seconds for isometric. Null when the session didn't record it.
function sessionPrimaryValue(s: TrendSession): number | null {
  if (s.exerciseKind === "isometric") {
    return s.totalPairedHoldMs != null ? s.totalPairedHoldMs / 1000 : null;
  }
  return s.avgPeakValue;
}

// Label / unit / whether the metric is an angle (the latter drives the badge
// deadband — hold seconds and ex_007's normalized units are not angles).
function primaryMetricMeta(
  exerciseId: string,
  kind: TrendSession["exerciseKind"],
): { label: string; unit: string; isAngle: boolean } {
  if (kind === "isometric") return { label: "Hold time", unit: "s", isAngle: false };
  const def = getExerciseDefinition(exerciseId);
  const angle = def && def.kind === "dynamic" ? def.primaryMetric.name !== "wristShoulderVertical" : true;
  return { label: angle ? "Peak ROM" : "Peak", unit: angle ? "°" : "", isAngle: angle };
}

// Trend direction from a least-squares slope over the session values (oldest→
// newest). Needs ≥3 points (per the set/session-level-only rule). A deadband
// rejects inter-session noise: the projected change across the window must clear
// max(3° noise floor for angle metrics, 5% of the mean). Higher = better for both
// ROM and hold time. DESCRIPTIVE STATISTICS — not the ML model, not a diagnosis.
// The deadband is a tunable heuristic.
function trendStatus(values: number[], isAngle: boolean): TrendStatus | null {
  const n = values.length;
  if (n < 3) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0) return "plateau";
  const projected = (num / den) * (n - 1); // change across the whole window
  const deadband = Math.max(isAngle ? 3 : 0, 0.05 * Math.abs(meanY));
  if (projected > deadband) return "improving";
  if (projected < -deadband) return "regressing";
  return "plateau";
}

function fmtTrendDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function ExerciseTrendCard({ group }: { group: TrendGroup }) {
  const { exerciseId, exerciseName, exerciseKind, sessions } = group;
  const meta = primaryMetricMeta(exerciseId, exerciseKind);
  const isIso = exerciseKind === "isometric";

  const primaryValues = sessions
    .map(sessionPrimaryValue)
    .filter((v): v is number => v != null);
  const status = trendStatus(primaryValues, meta.isAngle);

  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-green-700">{exerciseName}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
            {sessions.length > 1 && (
              <>
                {" · "}
                {fmtTrendDate(first.startedAt)} → {fmtTrendDate(last.startedAt)}
              </>
            )}
          </p>
        </div>
        {status ? (
          <span className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium ${STATUS_STYLE[status].classes}`}>
            {STATUS_STYLE[status].label}
          </span>
        ) : (
          <span className="shrink-0 text-xs px-3 py-1 rounded-full font-medium bg-gray-50 text-gray-400">
            Collecting data
          </span>
        )}
      </div>

      {sessions.length < 2 ? (
        <p className="text-xs text-gray-400 py-4 text-center">Needs ≥2 sessions to chart.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">{meta.label} over time</p>
            {primaryValues.length >= 2 ? (
              <TrendChart
                series={[{ label: meta.label, color: "#15803d", values: primaryValues }]}
                unitSuffix={meta.unit}
              />
            ) : (
              <p className="text-xs text-gray-400 py-4 text-center">
                No {meta.label.toLowerCase()} recorded.
              </p>
            )}
          </div>

          {!isIso && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Completed reps — left vs right</p>
              <TrendChart
                series={[
                  { label: "Left",  color: "#2563eb", values: sessions.map((s) => s.completeLeftReps) },
                  { label: "Right", color: "#ea580c", values: sessions.map((s) => s.completeRightReps) },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
