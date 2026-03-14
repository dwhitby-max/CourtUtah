import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getCalendarConnections,
  startGoogleAuth,
  startMicrosoftAuth,
  connectApple,
  connectCaldav,
  removeConnection,
} from "@/api/calendar";

interface Connection {
  id: number;
  provider: string;
  calendar_id: string | null;
  caldav_url: string | null;
  is_active: boolean;
  token_expires_at: string | null;
  created_at: string;
}

type ConnectionStatus = "active" | "expiring" | "expired" | "unknown";

function getConnectionStatus(conn: Connection): ConnectionStatus {
  // CalDAV/Apple connections don't have token expiry — they're either active or not
  if (conn.provider === "caldav" || conn.provider === "apple") {
    return conn.is_active ? "active" : "expired";
  }

  if (!conn.token_expires_at) return "unknown";

  const expiresAt = new Date(conn.token_expires_at).getTime();
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  if (expiresAt < now) return "expired";
  if (expiresAt < now + oneHour) return "expiring";
  return "active";
}

const statusBadge: Record<ConnectionStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-100 text-green-800" },
  expiring: { label: "Expiring soon", className: "bg-yellow-100 text-yellow-800" },
  expired: { label: "Needs re-auth", className: "bg-red-100 text-red-800" },
  unknown: { label: "Active", className: "bg-green-100 text-green-800" },
};

export default function CalendarSettingsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showApple, setShowApple] = useState(false);
  const [showCaldav, setShowCaldav] = useState(false);
  const [appleUser, setAppleUser] = useState("");
  const [applePass, setApplePass] = useState("");
  const [caldavUrl, setCaldavUrl] = useState("");
  const [caldavUser, setCaldavUser] = useState("");
  const [caldavPass, setCaldavPass] = useState("");
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected) setSuccess(`${connected} calendar connected successfully!`);
    const err = searchParams.get("error");
    if (err) setError(`Failed to connect calendar: ${err}`);
    fetchConnections();
  }, []);

  async function fetchConnections() {
    try {
      const data = await getCalendarConnections();
      setConnections(data.connections as Connection[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    try {
      const data = await startGoogleAuth();
      window.location.href = data.authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Google auth");
    }
  }

  async function handleMicrosoft() {
    try {
      const data = await startMicrosoftAuth();
      window.location.href = data.authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Microsoft auth");
    }
  }

  async function handleAppleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await connectApple(appleUser, applePass);
      setSuccess("Apple iCloud calendar connected!");
      setShowApple(false);
      setAppleUser("");
      setApplePass("");
      fetchConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Apple");
    }
  }

  async function handleCaldavSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await connectCaldav(caldavUrl, caldavUser, caldavPass);
      setSuccess("CalDAV calendar connected!");
      setShowCaldav(false);
      setCaldavUrl("");
      setCaldavUser("");
      setCaldavPass("");
      fetchConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect CalDAV");
    }
  }

  async function handleRemove(id: number) {
    try {
      await removeConnection(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      setSuccess("Calendar connection removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  }

  const providerLabel: Record<string, string> = {
    google: "Google Calendar",
    microsoft: "Microsoft Outlook",
    apple: "Apple iCloud",
    caldav: "CalDAV",
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Calendar Settings</h1>

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{error}</div>}
      {success && <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm">{success}</div>}

      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Connected Calendars</h2>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : connections.length === 0 ? (
          <p className="text-gray-500">No calendars connected yet. Add one below.</p>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => {
              const status = getConnectionStatus(conn);
              const badge = statusBadge[status];
              return (
                <div key={conn.id} className="flex items-center justify-between border border-gray-200 rounded-md p-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{providerLabel[conn.provider] || conn.provider}</span>
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500">
                      Connected {new Date(conn.created_at).toLocaleDateString()}
                      {conn.calendar_id ? ` — ${conn.calendar_id}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {(status === "expired" || status === "expiring") && (conn.provider === "google" || conn.provider === "microsoft") && (
                      <button
                        onClick={() => conn.provider === "google" ? handleGoogle() : handleMicrosoft()}
                        className="text-amber-700 hover:text-slate-800 text-sm font-medium"
                      >
                        Re-authorize
                      </button>
                    )}
                    <button onClick={() => handleRemove(conn.id)} className="text-red-600 hover:text-red-800 text-sm font-medium">
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Calendar</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button onClick={handleGoogle}
            className="border-2 border-gray-200 rounded-lg p-4 text-left hover:border-amber-500 transition-colors">
            <div className="font-medium text-gray-900">Google Calendar</div>
            <div className="text-sm text-gray-500 mt-1">Connect via Google OAuth</div>
          </button>

          <button onClick={handleMicrosoft}
            className="border-2 border-gray-200 rounded-lg p-4 text-left hover:border-amber-500 transition-colors">
            <div className="font-medium text-gray-900">Microsoft Outlook</div>
            <div className="text-sm text-gray-500 mt-1">Connect via Microsoft OAuth</div>
          </button>

          <button onClick={() => setShowApple(!showApple)}
            className="border-2 border-gray-200 rounded-lg p-4 text-left hover:border-amber-500 transition-colors">
            <div className="font-medium text-gray-900">Apple iCloud</div>
            <div className="text-sm text-gray-500 mt-1">Connect with app-specific password</div>
          </button>

          <button onClick={() => setShowCaldav(!showCaldav)}
            className="border-2 border-gray-200 rounded-lg p-4 text-left hover:border-amber-500 transition-colors">
            <div className="font-medium text-gray-900">CalDAV / Other</div>
            <div className="text-sm text-gray-500 mt-1">Connect any CalDAV-compatible calendar</div>
          </button>
        </div>

        {showApple && (
          <form onSubmit={handleAppleSubmit} className="mt-4 border-t pt-4 space-y-3">
            <h3 className="font-medium">Apple iCloud Connection</h3>
            <p className="text-sm text-gray-500">
              Use your Apple ID email and an <a href="https://support.apple.com/en-us/102654" target="_blank" rel="noopener noreferrer" className="text-amber-700 underline">app-specific password</a>.
            </p>
            <input type="email" required placeholder="Apple ID (email)" value={appleUser} onChange={(e) => setAppleUser(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
            <input type="password" required placeholder="App-specific password" value={applePass} onChange={(e) => setApplePass(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
            <button type="submit" className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm hover:bg-slate-700">Connect</button>
          </form>
        )}

        {showCaldav && (
          <form onSubmit={handleCaldavSubmit} className="mt-4 border-t pt-4 space-y-3">
            <h3 className="font-medium">CalDAV Connection</h3>
            <input type="url" required placeholder="CalDAV Server URL" value={caldavUrl} onChange={(e) => setCaldavUrl(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
            <input type="text" required placeholder="Username" value={caldavUser} onChange={(e) => setCaldavUser(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
            <input type="password" required placeholder="Password" value={caldavPass} onChange={(e) => setCaldavPass(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
            <button type="submit" className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm hover:bg-slate-700">Connect</button>
          </form>
        )}
      </div>
    </div>
  );
}
