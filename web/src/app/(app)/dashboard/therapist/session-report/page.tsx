export default function TherapistSessionReportPage() {
  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <h1 className="font-semibold">Session report prototype — demo only</h1>
        <p>This template is not connected to patient sessions and is not a clinical record.
          Use the patient pages for reports based on saved sessions.</p>
      </div>
      <iframe
        title="Demo session report template"
        src="/pt_session_summary_printable_report.html"
        className="block h-[calc(100dvh-13rem)] min-h-[40rem] w-full border-0 bg-white"
      />
    </section>
  );
}
