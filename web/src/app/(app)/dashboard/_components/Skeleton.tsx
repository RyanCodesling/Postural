// Lightweight loading-skeleton primitives shared across the dashboard pages.
// Pure presentation — animated gray placeholders that roughly match the real
// layout so the screens don't flash an empty/centered spinner while data loads.

/** A single pulsing bar. Size/shape via className (width, height, rounding). */
export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

/** A pulsing card container with the dashboard's rounded-card chrome. */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-green-100 bg-white p-5 ${className}`}>
      <SkeletonBar className="h-8 w-1/2" />
      <SkeletonBar className="mt-3 h-3 w-2/3" />
    </div>
  );
}

/** Row of KPI placeholder cards (therapist home). */
export function SkeletonKpiRow({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Placeholder table rows inside a card (roster / record lists). */
export function SkeletonTable({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-green-100 bg-white p-6">
      <SkeletonBar className="h-5 w-32 mb-5" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <SkeletonBar className="h-4 w-1/4" />
            <SkeletonBar className="h-4 w-1/5" />
            <SkeletonBar className="h-4 w-1/6" />
            <SkeletonBar className="h-4 w-16 ml-auto rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
