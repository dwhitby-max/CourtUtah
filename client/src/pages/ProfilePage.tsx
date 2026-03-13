import { useState } from "react";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [phone, setPhone] = useState(user?.phone || "");
  const [emailEnabled, setEmailEnabled] = useState(user?.notificationPreferences?.emailEnabled ?? true);
  const [smsEnabled, setSmsEnabled] = useState(user?.notificationPreferences?.smsEnabled ?? false);
  const [inAppEnabled, setInAppEnabled] = useState(user?.notificationPreferences?.inAppEnabled ?? true);
  const [frequency, setFrequency] = useState(user?.notificationPreferences?.frequency ?? "immediate");
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
        const data = await res.json();
        if (user) {
          setUser({
            ...user,
            phone: phone || null,
            notificationPreferences: { emailEnabled, smsEnabled, inAppEnabled, frequency },
          });
        }
        setMessage("Profile updated successfully");
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
      <h1 className="text-2xl font-bold text-gray-900">Profile & Settings</h1>

      {message && (
        <div className={`p-4 rounded-md text-sm ${message.includes("success") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white shadow rounded-lg p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={user?.email || ""} disabled
            className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-500" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone (for SMS notifications)</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="+1234567890"
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-indigo-500 focus:border-indigo-500" />
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Notification Preferences</h3>
          <div className="space-y-3">
            <label className="flex items-center space-x-3">
              <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)}
                className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" />
              <span className="text-sm text-gray-700">Email notifications</span>
            </label>
            <label className="flex items-center space-x-3">
              <input type="checkbox" checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)}
                className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" />
              <span className="text-sm text-gray-700">SMS notifications (requires phone number)</span>
            </label>
            <label className="flex items-center space-x-3">
              <input type="checkbox" checked={inAppEnabled} onChange={(e) => setInAppEnabled(e.target.checked)}
                className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" />
              <span className="text-sm text-gray-700">In-app notifications</span>
            </label>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notification Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as "immediate" | "daily_digest" | "weekly_digest")}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="immediate">Immediate — notify me right away</option>
              <option value="daily_digest">Daily Digest — summary email each morning</option>
              <option value="weekly_digest">Weekly Digest — summary email every Monday</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              In-app and Socket.io notifications are always immediate. This setting controls email and SMS delivery timing.
            </p>
          </div>
        </div>

        <button type="submit" disabled={saving}
          className="bg-indigo-600 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
