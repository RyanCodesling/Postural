import type { ReactNode } from "react";

export type TileTone = "green" | "teal" | "lime" | "amber" | "rose";

const TONE: Record<TileTone, string> = {
  green: "from-green-100 to-emerald-50",
  teal: "from-teal-100 to-cyan-50",
  lime: "from-lime-100 to-green-50",
  amber: "from-amber-100 to-orange-50",
  rose: "from-rose-100 to-red-50",
};

/** A pastel summary tile: a round icon, a small label and one big number. */
export function StatTile({
  label,
  value,
  unit,
  icon,
  tone = "green",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: ReactNode;
  tone?: TileTone;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-xl bg-gradient-to-br ${TONE[tone]} px-4 py-3 shadow-sm`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-green-700 shadow-sm">
        {icon}
      </span>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-xs text-gray-600">{label}</p>
        <p className="truncate text-xl font-bold text-gray-900">
          {value}
          {unit && <span className="ml-1 text-xs font-medium text-gray-500">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

/** A white card with a title row; `scroll` makes the body scroll instead of growing. */
export function Panel({
  title,
  right,
  children,
  className = "",
  scroll = false,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-xl bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {right}
      </div>
      <div className={`min-h-0 flex-1 ${scroll ? "overflow-y-auto pr-1" : ""}`}>{children}</div>
    </section>
  );
}

/** Small page heading used at the top of the dashboards, kept short so the page fits one screen. */
export function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="shrink-0">
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
    </div>
  );
}

/** One screen tall on large displays; stacks and scrolls normally on small ones. */
export const FIT_SCREEN = "flex flex-col gap-4 lg:h-[calc(100vh-7rem)]";

// ── Tile icons ───────────────────────────────────────────────────────────────

function G({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const Glyph = {
  users: <G><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.2.7 3.5 2.6 3.5 5.5" /></G>,
  user: <G><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></G>,
  link: <G><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></G>,
  pulse: <G><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></G>,
  archive: <G><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></G>,
  dumbbell: <G><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" /></G>,
  check: <G><circle cx="12" cy="12" r="9" /><path d="m8 12.5 3 3 5-6" /></G>,
  clock: <G><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></G>,
  calendar: <G><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></G>,
  alert: <G><path d="M12 4 2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.1" /></G>,
  list: <G><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></G>,
};
