import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getCalendarConnections,
  startGoogleAuth,
  startMicrosoftAuth,
  connectApple,
  connectCaldav,
  removeConnection,
  removeAllConnections,
} from "@/api/calendar";
import { apiFetch } from "@/api/client";

interface Connection {
  id: number;
  provider: string;
  calendar_id: string | null;
  caldav_url: string | null;
  is_active: boolean;
  token_expires_at: string | null;
  has_refresh_token: boolean;
  created_at: string;
}

type ConnectionStatus = "active" | "expiring" | "expired" | "unknown";

function getConnectionStatus(conn: Connection): ConnectionStatus {
  if (!conn.is_active) return "expired";

  // CalDAV/Apple connections don't have token expiry — they're either active or not
  if (conn.provider === "caldav" || conn.provider === "apple") {
    return "active";
  }

  // If a refresh token exists, the access token auto-renews — connection is healthy
  if (conn.has_refresh_token) return "active";

  // No refresh token — status depends on access token expiry
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
  const [eventTag, setEventTag] = useState("");
  const [eventColorId, setEventColorId] = useState("");
  const [savedPrefs, setSavedPrefs] = useState(false);
  const [searchParams] = useSearchParams();

  const googleColors: { id: string; name: string; hex: string }[] = [
    { id: "", name: "Default", hex: "#4285f4" },
    { id: "1", name: "Lavender", hex: "#7986cb" },
    { id: "2", name: "Sage", hex: "#33b679" },
    { id: "3", name: "Grape", hex: "#8e24aa" },
    { id: "4", name: "Flamingo", hex: "#e67c73" },
    { id: "5", name: "Banana", hex: "#f6bf26" },
    { id: "6", name: "Tangerine", hex: "#f4511e" },
    { id: "7", name: "Peacock", hex: "#039be5" },
    { id: "8", name: "Graphite", hex: "#616161" },
    { id: "9", name: "Blueberry", hex: "#3f51b5" },
    { id: "10", name: "Basil", hex: "#0b8043" },
    { id: "11", name: "Tomato", hex: "#d50000" },
  ];

  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected) setSuccess(`${connected} calendar connected successfully!`);
    const err = searchParams.get("error");
    if (err) setError(`Failed to connect calendar: ${err}`);
    fetchConnections();
    fetchCalendarPreferences();
  }, []);

  async function fetchCalendarPreferences() {
    try {
      const res = await apiFetch("/auth/me");
      if (res.ok) {
        const data = await res.json();
        const prefs = data.user?.calendarPreferences || {};
        setEventTag(prefs.eventTag || "");
        setEventColorId(prefs.eventColorId || "");
      }
    } catch {}
  }

  async function saveCalendarPreferences() {
    try {
      const res = await apiFetch("/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          calendarPreferences: { eventTag, eventColorId },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedPrefs(true);
      setTimeout(() => setSavedPrefs(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preferences");
    }
  }

  async function fetchConnections() {
    try {
      const data = await getCalendarConnections();
      setConnections(data.connections as unknown as Connection[]);
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

  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleRemove(id: number) {
    setRemoving(true);
    setError("");
    try {
      const result = await removeConnection(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      const evtMsg = result.eventsRemoved > 0 ? ` (${result.eventsRemoved} synced event${result.eventsRemoved === 1 ? "" : "s"} removed from calendar)` : "";
      setSuccess(`Calendar connection removed${evtMsg}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemoving(false);
      setConfirmRemoveId(null);
    }
  }

  async function handleRemoveAll() {
    setRemoving(true);
    setError("");
    try {
      const result = await removeAllConnections();
      setConnections([]);
      const evtMsg = result.eventsRemoved > 0 ? ` and ${result.eventsRemoved} synced event${result.eventsRemoved === 1 ? "" : "s"}` : "";
      setSuccess(`Removed ${result.connectionsRemoved} calendar connection${result.connectionsRemoved === 1 ? "" : "s"}${evtMsg}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove connections");
    } finally {
      setRemoving(false);
      setConfirmRemoveAll(false);
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Connected Calendars</h2>
          {connections.length > 1 && (
            <button
              onClick={() => setConfirmRemoveAll(true)}
              disabled={removing}
              className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
            >
              Remove All
            </button>
          )}
        </div>

        {confirmRemoveAll && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
            <p className="text-sm text-red-800 font-medium">Remove all {connections.length} calendar connections?</p>
            <p className="text-sm text-red-700 mt-1">All synced events will be deleted from your calendars. This cannot be undone.</p>
            <div className="flex gap-3 mt-3">
              <button
                onClick={handleRemoveAll}
                disabled={removing}
                className="bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {removing ? "Removing..." : "Yes, Remove All"}
              </button>
              <button
                onClick={() => setConfirmRemoveAll(false)}
                disabled={removing}
                className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : connections.length === 0 ? (
          <p className="text-gray-500">No calendars connected yet. Add one below.</p>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => {
              const status = getConnectionStatus(conn);
              const badge = statusBadge[status];
              const isConfirming = confirmRemoveId === conn.id;
              return (
                <div key={conn.id} className="border border-gray-200 rounded-md p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{providerLabel[conn.provider] || conn.provider}</span>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">
                        Connected {new Date(conn.created_at).toLocaleDateString("en-US", { timeZone: "America/Denver" })}
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
                      <button
                        onClick={() => setConfirmRemoveId(conn.id)}
                        disabled={removing}
                        className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {isConfirming && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-sm text-gray-700">Remove this connection? Synced events will be deleted from your calendar.</p>
                      <div className="flex gap-3 mt-2">
                        <button
                          onClick={() => handleRemove(conn.id)}
                          disabled={removing}
                          className="bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                        >
                          {removing ? "Removing..." : "Confirm Remove"}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveId(null)}
                          disabled={removing}
                          className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
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

      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Event Appearance</h2>
        <p className="text-sm text-gray-500 mb-4">
          Customize how court hearings appear on your calendar so they stand out from other events.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Event Tag (prefix)</label>
            <input
              type="text"
              value={eventTag}
              onChange={(e) => setEventTag(e.target.value)}
              placeholder="e.g. [Hearing], Court, UT Court"
              className="w-full max-w-xs border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Added before the event title, e.g. "{eventTag || "[Hearing]"} Court: SLC 123456 - Arraignment"
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Event Color (Google Calendar)</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {googleColors.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => setEventColorId(color.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-colors ${
                    eventColorId === color.id
                      ? "border-gray-900 ring-2 ring-offset-1 ring-gray-400"
                      : "border-transparent hover:border-gray-300"
                  }`}
                  title={color.name}
                >
                  <span
                    className="w-3 h-3 rounded-full inline-block flex-shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  {color.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Only applies to Google Calendar events. Other providers use their default color.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={saveCalendarPreferences}
              className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700"
            >
              Save Appearance
            </button>
            {savedPrefs && <span className="text-sm text-green-600">Saved!</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
