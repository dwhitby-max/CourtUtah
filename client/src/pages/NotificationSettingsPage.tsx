import { useState } from "react";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";
import { NotificationFrequency } from "@shared/types";

export default function NotificationSettingsPage() {
  const { user, setUser } = useAuth();
  const [phone, setPhone] = useState(user?.phone || "");
  const [emailEnabled, setEmailEnabled] = useState(user?.notificationPreferences?.emailEnabled ?? true);
  const [smsEnabled, setSmsEnabled] = useState(user?.notificationPreferences?.smsEnabled ?? false);
  const [inAppEnabled, setInAppEnabled] = useState(user?.notificationPreferences?.inAppEnabled ?? true);
  const [frequency, setFrequency] = useState<NotificationFrequency>(user?.notificationPreferences?.frequency ?? "immediate");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const res = await apiFetch("/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          phone: phone || null,
          notificationPreferences: { emailEnabled, smsEnabled, inAppEnabled, frequency },
        }),
      });

      if (res.ok) {
        if (user) {
          setUser({
            ...user,
            phone: phone || null,
            notificationPreferences: { emailEnabled, smsEnabled, inAppEnabled, frequency },
          });
        }
        setMessage("Notification settings saved successfully");
      } else {
        const data = await res.json();
        setMessage(data.error || "Update failed");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Notification Settings</h1>

      {message && (
        <div className={`p-4 rounded-md text-sm ${message.includes("success") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white shadow rounded-lg p-6 space-y-6">
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Notification Channels</h3>
          <div className="space-y-3">
            <label className="flex items-center space-x-3">
              <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)}
                className="h-4 w-4 text-amber-700 border-gray-300 rounded focus:ring-amber-500" />
              <div>
                <span className="text-sm text-gray-700">Email notifications</span>
                <p className="text-xs text-gray-500">Receive schedule changes and event matches via email</p>
              </div>
            </label>
            <label className="flex items-center space-x-3">
              <input type="checkbox" checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)}
                className="h-4 w-4 text-amber-700 border-gray-300 rounded focus:ring-amber-500" />
              <div>
                <span className="text-sm text-gray-700">SMS notifications</span>
                <p className="text-xs text-gray-500">Text message alerts (requires phone number below)</p>
              </div>
            </label>
            <label className="flex items-center space-x-3">
              <input type="checkbox" checked={inAppEnabled} onChange={(e) => setInAppEnabled(e.target.checked)}
                className="h-4 w-4 text-amber-700 border-gray-300 rounded focus:ring-amber-500" />
              <div>
                <span className="text-sm text-gray-700">In-app notifications</span>
                <p className="text-xs text-gray-500">Real-time notifications in the notification bell</p>
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number (for SMS)</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="+1234567890"
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-amber-500 focus:border-amber-500" />
          <p className="mt-1 text-xs text-gray-500">Required for SMS notifications. Include country code.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Frequency</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as NotificationFrequency)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          >
            <option value="immediate">Immediate — notify me right away</option>
            <option value="daily_digest">Daily Digest — summary email each morning (6 AM UTC)</option>
            <option value="weekly_digest">Weekly Digest — summary email every Monday (6 AM UTC)</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            In-app notifications are always immediate. This setting controls email and SMS delivery timing.
          </p>
        </div>

        <div className="bg-gray-50 rounded-md p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Notification Types</h4>
          <ul className="text-sm text-gray-600 space-y-1">
            <li><span className="inline-block w-3 h-3 bg-orange-400 rounded-full mr-2"></span>Schedule changes — when a court event on your calendar is rescheduled</li>
            <li><span className="inline-block w-3 h-3 bg-blue-400 rounded-full mr-2"></span>New events — when new events match your saved searches</li>
            <li><span className="inline-block w-3 h-3 bg-red-400 rounded-full mr-2"></span>Sync errors — when calendar sync encounters a problem</li>
          </ul>
        </div>

        <button type="submit" disabled={saving}
          className="bg-amber-700 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </div>
  );
}
