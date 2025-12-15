import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">Postural Monitoring System</h1>
        <p className="text-gray-600">
          AI-assisted posture and movement analysis
        </p>
        <Link
          href="/login"
          className="inline-block px-6 py-2 rounded bg-black text-white"
        >
          Go to Login
        </Link>
      </div>
    </main>
  );
}
