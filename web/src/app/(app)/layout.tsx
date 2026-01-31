import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-200">
      <nav className="border-b bg-blue-300">
        <div className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex gap-4">
            <Link href="/dashboard" className="font-semibold">Dashboard</Link>
            <Link href="/camera">Camera</Link>
            <Link href="/profile">Profile</Link>
          </div>
          <button className="px-4 py-2 bg-red-200 text-black rounded hover:bg-red-300 border">
            Logout
          </button>
        </div>
      </nav>
      {children}
    </div>
  );
}
