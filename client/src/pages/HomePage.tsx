import { Link } from "react-router-dom";
import { useAuth } from "@/store/authStore";

export default function HomePage() {
  const { isLoggedIn } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="" className="h-8 w-8" />
            <span className="text-xl font-bold text-slate-800">Court Utah</span>
          </div>
          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <Link
                to="/search"
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  Log In
                </Link>
                <Link
                  to="/login"
                  className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Create Account
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-24 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 leading-tight">
          Never Miss a Utah Court Date
        </h1>
        <p className="mt-4 text-lg md:text-xl text-gray-600 max-w-2xl mx-auto">
          Search Utah court calendars, track case schedules, and sync hearings
          directly to your Google Calendar — automatically.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/login"
            className="bg-blue-600 text-white px-6 py-3 rounded-md text-base font-medium hover:bg-blue-700 transition-colors"
          >
            Get Started Free
          </Link>
          <a
            href="#features"
            className="text-blue-600 font-medium hover:text-blue-800 transition-colors"
          >
            Learn more &darr;
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-white py-16">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 text-center mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              title="Search Court Calendars"
              description="Search by defendant name, case number, attorney, judge, OTN, charges, and more across all Utah district and justice courts."
              icon={
                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
            />
            <FeatureCard
              title="Stay Notified"
              description="Get notified of schedule changes via email, SMS, or in-app alerts. Your saved searches keep you up to date automatically."
              icon={
                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              }
            />
            <FeatureCard
              title="Sync to Your Calendar"
              description="Hearings sync directly to Google Calendar so court dates appear alongside your existing schedule. Updates automatically when dates change."
              icon={
                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              }
            />
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
            Built for Legal Professionals
          </h2>
          <p className="text-gray-600 max-w-2xl mx-auto mb-10">
            Whether you're an attorney managing a caseload, a paralegal tracking hearings,
            or a defendant keeping tabs on your own case — Court Utah keeps you informed.
          </p>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6 text-left">
            <StatCard label="Utah Courts" value="District & Justice" />
            <StatCard label="Search Fields" value="9" />
            <StatCard label="Daily Auto-Scrape" value="2 AM" />
            <StatCard label="Calendar Sync" value="Google" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-600 py-12">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Start Tracking Court Dates Today
          </h2>
          <p className="text-blue-100 mb-6">
            Sign in with Google to get started — it only takes a few seconds.
          </p>
          <Link
            to="/login"
            className="inline-block bg-white text-blue-600 px-6 py-3 rounded-md text-base font-medium hover:bg-blue-50 transition-colors"
          >
            Create Your Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t py-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <span>Court Utah</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-gray-700 underline">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-gray-700 underline">Terms and Conditions</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="text-center p-6">
      <div className="flex justify-center mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
      <p className="text-gray-600 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-5 text-center">
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  );
}
