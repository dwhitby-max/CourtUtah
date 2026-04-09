import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/store/authStore";
import NotificationBell from "./NotificationBell";
import SupportModal from "./SupportModal";

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showSupport, setShowSupport] = useState(false);

  function navClass(path: string): string {
    const base = "px-3 py-2 rounded-md text-sm font-medium";
    return location.pathname === path
      ? `${base} bg-slate-700 text-white`
      : `${base} text-slate-200 hover:bg-amber-700 hover:text-white`;
  }

  function mobileNavClass(path: string): string {
    const base = "block px-3 py-2 rounded-md text-base font-medium";
    return location.pathname === path
      ? `${base} bg-slate-700 text-white`
      : `${base} text-slate-200 hover:bg-amber-700 hover:text-white`;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <Link to="/dashboard" className="flex items-center space-x-2 shrink-0">
                <img src="/logo.svg" alt="Court Calendar Tracker" className="h-8 w-8" />
                <span className="text-white font-bold text-lg">Court Calendar Tracker</span>
              </Link>
              {/* Desktop nav */}
              <div className="hidden md:flex ml-10 items-baseline space-x-2">
                <Link to="/" className={navClass("/dashboard")}>Dashboard</Link>
                <Link to="/search" className={navClass("/search")}>Search</Link>
                <Link to="/calendar-settings" className={navClass("/calendar-settings")}>Calendar</Link>
                {user?.isAdmin && <Link to="/admin" className={navClass("/admin")}>Admin</Link>}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <NotificationBell />
              <button
                onClick={() => setShowSupport(true)}
                className="hidden sm:inline-flex items-center gap-1 text-slate-200 hover:text-white text-sm transition-colors"
                title="Contact Support"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Support
              </button>
              {user?.subscriptionPlan !== "pro" && (
                <Link to="/billing" className="hidden sm:inline px-2 py-1 text-xs font-medium text-amber-900 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors">
                  Upgrade
                </Link>
              )}
              <Link to="/settings" className="hidden sm:inline text-slate-200 hover:text-white text-sm">
                Settings
              </Link>
              <Link to="/profile" className="hidden sm:inline text-slate-200 hover:text-white text-sm truncate max-w-32">
                {user?.email}
              </Link>
              <button onClick={logout} className="hidden sm:inline text-slate-200 hover:text-white text-sm">
                Logout
              </button>
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden text-slate-200 hover:text-white"
                aria-label="Toggle menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden px-2 pt-2 pb-3 space-y-1">
            <Link to="/dashboard" className={mobileNavClass("/dashboard")} onClick={() => setMobileMenuOpen(false)}>Dashboard</Link>
            <Link to="/search" className={mobileNavClass("/search")} onClick={() => setMobileMenuOpen(false)}>Search</Link>
            <Link to="/calendar-settings" className={mobileNavClass("/calendar-settings")} onClick={() => setMobileMenuOpen(false)}>Calendar</Link>
            {user?.isAdmin && <Link to="/admin" className={mobileNavClass("/admin")} onClick={() => setMobileMenuOpen(false)}>Admin</Link>}
            <div className="border-t border-slate-600 pt-2 mt-2">
              <button
                onClick={() => { setShowSupport(true); setMobileMenuOpen(false); }}
                className="block w-full text-left px-3 py-2 text-slate-200 hover:text-white text-sm"
              >
                Support
              </button>
              {user?.subscriptionPlan !== "pro" && (
                <Link to="/billing" className="block px-3 py-2 text-amber-400 hover:text-amber-300 text-sm font-medium" onClick={() => setMobileMenuOpen(false)}>
                  Upgrade to Pro
                </Link>
              )}
              <Link to="/settings" className="block px-3 py-2 text-slate-200 hover:text-white text-sm" onClick={() => setMobileMenuOpen(false)}>
                Settings
              </Link>
              <Link to="/profile" className="block px-3 py-2 text-slate-200 hover:text-white text-sm" onClick={() => setMobileMenuOpen(false)}>
                {user?.email}
              </Link>
              <button onClick={() => { logout(); setMobileMenuOpen(false); }} className="block w-full text-left px-3 py-2 text-slate-200 hover:text-white text-sm">
                Logout
              </button>
            </div>
          </div>
        )}
      </nav>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-center space-x-4 text-xs text-gray-400">
          <Link to="/privacy" className="hover:text-gray-600 underline">Privacy Policy</Link>
          <span>&middot;</span>
          <Link to="/terms" className="hover:text-gray-600 underline">Terms and Conditions</Link>
        </div>
      </footer>

      {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}
    </div>
  );
}
