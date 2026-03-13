import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ watchedCases: 0, calendarConnections: 0, unreadNotifications: 0 });

  useEffect(() => {
    async function fetchStats() {
      try {
        const [wcRes, calRes, notRes] = await Promise.all([
          apiFetch("/watched-cases"),
          apiFetch("/calendar/connections"),
          apiFetch("/notifications?limit=1"),
        ]);
        const wcData = await wcRes.json();
        const calData = await calRes.json();
        const notData = await notRes.json();

        setStats({
          watchedCases: wcData.watchedCases?.length || 0,
          calendarConnections: calData.connections?.length || 0,
          unreadNotifications: notData.unreadCount || 0,
        });
      } catch {
        // silently fail on dashboard load
      }
    }
    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome back, {user?.email}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link to="/watched-cases"
          className="bg-white shadow rounded-lg p-6 hover:shadow-md transition-shadow">
          <div className="text-3xl font-bold text-indigo-600">{stats.watchedCases}</div>
          <div className="text-gray-600 mt-1">Watched Cases</div>
        </Link>

        <Link to="/calendar-settings"
          className="bg-white shadow rounded-lg p-6 hover:shadow-md transition-shadow">
          <div className="text-3xl font-bold text-green-600">{stats.calendarConnections}</div>
          <div className="text-gray-600 mt-1">Calendar Connections</div>
        </Link>

        <Link to="/notifications"
          className="bg-white shadow rounded-lg p-6 hover:shadow-md transition-shadow">
          <div className="text-3xl font-bold text-orange-600">{stats.unreadNotifications}</div>
          <div className="text-gray-600 mt-1">Unread Notifications</div>
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Getting Started</h2>
        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex items-start space-x-3">
            <span className={`font-bold ${stats.calendarConnections > 0 ? "text-green-600" : "text-gray-400"}`}>1.</span>
            <span><Link to="/calendar-settings" className="text-indigo-600 hover:underline">Connect a calendar</Link> (Google, Microsoft, Apple, or CalDAV)</span>
          </div>
          <div className="flex items-start space-x-3">
            <span className="font-bold text-gray-400">2.</span>
            <span><Link to="/search" className="text-indigo-600 hover:underline">Search</Link> for a court case by name, case number, OTN, or citation</span>
          </div>
          <div className="flex items-start space-x-3">
            <span className="font-bold text-gray-400">3.</span>
            <span>Add results to your <Link to="/watched-cases" className="text-indigo-600 hover:underline">watched cases</Link> to auto-sync to your calendar</span>
          </div>
          <div className="flex items-start space-x-3">
            <span className="font-bold text-gray-400">4.</span>
            <span>Get notified automatically when schedules change</span>
          </div>
        </div>
      </div>
    </div>
  );
}
