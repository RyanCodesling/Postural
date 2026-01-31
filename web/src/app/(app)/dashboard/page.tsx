export default function DashboardPage() {
  const userName = "Placeholder User";

  return (
    <div className="min-h-screen flex bg-white">
      <aside className="w-64 bg-gray-50 border-r p-6">
        <div className="mb-8">
          <div className="text-sm text-gray-500">Signed in as</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{userName}</div>
        </div>

        <nav aria-label="Main navigation">
          <ul className="space-y-2">
            <li>
              <a href="#" className="block px-3 py-2 rounded text-gray-700 hover:bg-gray-100">Dashboard</a>
            </li>
            <li>
              <a href="#" className="block px-3 py-2 rounded text-gray-700 hover:bg-gray-100">Session</a>
            </li>
            <li>
              <a href="#" className="block px-3 py-2 rounded text-gray-700 hover:bg-gray-100">History</a>
            </li>
            <li>
              <a href="#" className="block px-3 py-2 rounded text-gray-700 hover:bg-gray-100">Progress</a>
            </li>
          </ul>
        </nav>
      </aside>
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome to your postural monitoring dashboard.</p>

        <div className="mt-6">
          <button className="px-4 py-2 bg-green-600 text-white rounded">Start Session</button>
        </div>
      </main>
    </div>
  );
}
