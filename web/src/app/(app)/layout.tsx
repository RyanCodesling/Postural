import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-6 py-3 flex gap-4">
          <Link href="/dashboard" className="font-semibold">Dashboard</Link>
          <Link href="/camera">Camera</Link>
          <Link href="/profile">Profile</Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
