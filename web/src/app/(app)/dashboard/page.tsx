type NavItemProps = {
  href: string;
  icon: "home" | "clock" | "history";
  label: string;
};

function NavItem({ href, icon, label }: NavItemProps) {
  const getIconPath = () => {
    switch (icon) {
      case "home":
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 11.5L12 4l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V11.5z" />;
      case "clock":
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />;
      case "history":
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m9-3a9 9 0 11-18 0 9 9 0 0118 0z" transform="rotate(90 12 12)" />;
    }
  };

  return (
    <li>
      <a href={href} className="flex items-center px-3 py-2 rounded text-gray-700 hover:bg-gray-100">
        <span className="mr-3 h-5 w-5 text-gray-500" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-5 w-5">
            {getIconPath()}
          </svg>
        </span>
        <span>{label}</span>
      </a>
    </li>
  );
}

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
            <NavItem href="#" icon="home" label="Dashboard" />
            <NavItem href="#" icon="clock" label="Session" />
            <NavItem href="#" icon="history" label="History" />
            <NavItem href="/camera" icon="clock" label="Start Session" />
            <NavItem href="#" icon="clock" label="Exercises" />
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
