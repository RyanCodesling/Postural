import type { ReactNode } from "react";
import { FIT_SCREEN, Panel } from "./DashboardKit";

function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A labelled value, with an optional round icon, for the profile panels. */
export function ProfileField({ label, value, icon }: { label: string; value: string | null | undefined; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-green-50 text-green-700">{icon}</span>}
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="truncate text-sm font-semibold text-gray-900">{value ?? "—"}</p>
      </div>
    </div>
  );
}

/**
 * The profile page shared by the patient and therapist: a green identity card
 * with the Change Password action, then two panels that share the rest of the
 * screen.
 */
export default function ProfileLayout({
  name,
  email,
  roleLabel,
  onChangePassword,
  leftTitle,
  left,
  rightTitle,
  right,
  bottomTitle,
  bottom,
}: {
  name: string | undefined;
  email: string | null | undefined;
  roleLabel: string;
  onChangePassword: () => void;
  leftTitle: string;
  left: ReactNode;
  rightTitle: string;
  right: ReactNode;
  /** An optional full-width panel under the two above, which then take only the height they need. */
  bottomTitle?: string;
  bottom?: ReactNode;
}) {
  return (
    <div className={FIT_SCREEN}>
      <div id="tour-profile-card" className="flex shrink-0 flex-wrap items-center justify-between gap-4 rounded-xl bg-gradient-to-br from-green-700 to-emerald-500 px-6 py-5 text-white shadow-sm">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white text-xl font-bold text-green-700 shadow">
            {initials(name)}
          </span>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-2xl font-bold">{name ?? "My Profile"}</h1>
            <p className="truncate text-sm text-green-50">{email ?? ""}</p>
            <span className="mt-2 inline-block rounded-full bg-white/20 px-3 py-0.5 text-xs font-semibold">{roleLabel}</span>
          </div>
        </div>
        <button
          id="tour-profile-password"
          type="button"
          onClick={onChangePassword}
          className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-green-800 transition hover:bg-green-50"
        >
          Change Password
        </button>
      </div>

      <div className={`grid gap-4 lg:grid-cols-12 ${bottom ? "shrink-0" : "min-h-0 flex-1"}`}>
        <Panel id="tour-profile-left" className="lg:col-span-7" title={leftTitle} scroll={!bottom}>
          {left}
        </Panel>
        <Panel id="tour-profile-right" className="lg:col-span-5" title={rightTitle} scroll={!bottom}>
          {right}
        </Panel>
      </div>

      {bottom && (
        <Panel id="tour-profile-bottom" className="flex-1" title={bottomTitle ?? ""} scroll>
          {bottom}
        </Panel>
      )}
    </div>
  );
}
