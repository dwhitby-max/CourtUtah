import { useState, useEffect } from "react";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/store/authStore";

type Tab = "overview" | "pending" | "users";

interface UserRow {
  id: number;
  email: string;
  phone: string | null;
  email_verified: boolean;
  is_admin: boolean;
  is_approved: boolean;
  created_at: string;
  search_count: string;
  last_search_at: string | null;
  calendar_count: string;
  last_sync_at: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  subscription_id: string | null;
  subscription_current_period_end: string | null;
  stripe_customer_id: string | null;
}

interface Payment {
  id: string;
  date: string | null;
  amount: number;
  currency: string;
  status: string | null;
  invoiceUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

interface SavedSearch {
  id: number;
  search_type: string;
  search_value: string;
  label: string;
  search_params: Record<string, string> | null;
  results_count: number | null;
  last_refreshed_at: string | null;
  source: string;
  is_active: boolean;
  created_at: string;
}

export default function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  if (!user?.isAdmin) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
        <p className="text-gray-500 mt-2">You do not have admin privileges.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>

      <div className="border-b border-gray-200">
        <nav className="flex space-x-4">
          {(["overview", "pending", "users"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2 px-3 text-sm font-medium border-b-2 ${
                tab === t
                  ? "border-amber-700 text-amber-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t === "overview" ? "Overview" : t === "pending" ? "Pending Approval" : "Users"}
            </button>
          ))}
        </nav>
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "pending" && <PendingTab />}
      {tab === "users" && <UsersTab />}
    </div>
  );
}

// ─── Overview Tab ───

function OverviewTab() {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    apiFetch("/admin/stats").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setStats(d); });
  }, []);

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Events" value={String((stats.events as Record<string, number>)?.total || 0)} />
          <StatCard label="Courts" value={String((stats.events as Record<string, number>)?.courts || 0)} />
          <StatCard label="Users" value={String(stats.users || 0)} />
          <StatCard label="Saved Searches" value={String(stats.savedSearches || 0)} />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white shadow rounded-lg p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{parseInt(value, 10).toLocaleString()}</div>
    </div>
  );
}

// ─── Pending Approval Tab ───

function PendingTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/admin/users")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) setUsers(d.users.filter((u: UserRow) => !u.is_approved));
        setLoading(false);
      });
  }, []);

  async function approveUser(userId: number) {
    const res = await apiFetch(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isApproved: true }),
    });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    }
  }

  async function rejectUser(userId: number) {
    if (!confirm("Reject this user? They will remain unable to access the app.")) return;
    // Keep is_approved = false — no action needed, just confirmation
  }

  if (loading) {
    return <p className="text-gray-500 text-sm py-4">Loading...</p>;
  }

  if (users.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-8 text-center">
        <p className="text-gray-500">No users pending approval.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {users.map((u) => (
        <div key={u.id} className="bg-white shadow rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">{u.email}</p>
            <p className="text-xs text-gray-500">Signed up {new Date(u.created_at).toLocaleString("en-US", { timeZone: "America/Denver" })}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => approveUser(u.id)}
              className="bg-green-600 text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-green-700"
            >
              Approve
            </button>
            <button
              onClick={() => rejectUser(u.id)}
              className="bg-red-50 text-red-700 border border-red-200 px-4 py-1.5 rounded-md text-sm font-medium hover:bg-red-100"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Users Tab ───

function PlanBadge({ plan, status }: { plan: string | null; status: string | null }) {
  const p = plan || "free";
  const s = status || "none";

  if (s === "grandfathered") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Grandfathered</span>;
  }
  if (p === "pro" && s === "active") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Pro</span>;
  }
  if (p === "pro" && s === "canceled") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">Pro (Canceling)</span>;
  }
  if (s === "past_due") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">Past Due</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Free</span>;
}

function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [historyUserId, setHistoryUserId] = useState<number | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [cancelingId, setCancelingId] = useState<number | null>(null);
  const [searchesUserId, setSearchesUserId] = useState<number | null>(null);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [searchesLoading, setSearchesLoading] = useState(false);
  const [triggeringSearchId, setTriggeringSearchId] = useState<number | null>(null);
  const [searchTriggerMsg, setSearchTriggerMsg] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/admin/users").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setUsers(d.users); });
  }, []);

  async function toggleAdmin(userId: number, currentValue: boolean) {
    const res = await apiFetch(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isAdmin: !currentValue }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_admin: !currentValue } : u));
    }
  }

  async function toggleApproval(userId: number, currentValue: boolean) {
    const res = await apiFetch(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isApproved: !currentValue }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_approved: !currentValue } : u));
    }
  }

  async function downgradeUser(userId: number, hasStripeSubscription: boolean) {
    const msg = hasStripeSubscription
      ? "Downgrade this user to free? Their Pro access continues until the current billing period ends, then reverts to the free plan."
      : "Downgrade this user to free immediately?";
    if (!confirm(msg)) return;
    setCancelingId(userId);
    const res = await apiFetch(`/admin/users/${userId}/cancel-subscription`, { method: "POST" });
    setCancelingId(null);
    if (res.ok) {
      const updated = hasStripeSubscription
        ? { subscription_status: "canceled" }
        : { subscription_plan: "free", subscription_status: "canceled" };
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, ...updated } : u));
    }
  }

  async function viewPaymentHistory(userId: number) {
    setHistoryUserId(userId);
    setHistoryLoading(true);
    setPayments([]);
    const res = await apiFetch(`/admin/users/${userId}/payment-history`);
    if (res.ok) {
      const data = await res.json();
      setPayments(data.payments);
    }
    setHistoryLoading(false);
  }

  async function viewSearches(userId: number) {
    setSearchesUserId(userId);
    setSearchesLoading(true);
    setSearches([]);
    setSearchTriggerMsg(null);
    const res = await apiFetch(`/admin/users/${userId}/searches`);
    if (res.ok) {
      const data = await res.json();
      setSearches(data.searches);
    }
    setSearchesLoading(false);
  }

  async function triggerSearch(searchId: number) {
    setTriggeringSearchId(searchId);
    setSearchTriggerMsg(null);
    const res = await apiFetch(`/admin/trigger-search/${searchId}`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setSearchTriggerMsg(`${data.message} — ${data.resultsCount} results${data.searchWarnings ? ` (${data.searchWarnings.join("; ")})` : ""}`);
      // Update the last_refreshed_at in the local list
      setSearches((prev) => prev.map((s) =>
        s.id === searchId ? { ...s, last_refreshed_at: new Date().toISOString(), results_count: data.resultsCount } : s
      ));
    } else {
      setSearchTriggerMsg(`Failed: ${data.error || data.detail || "Unknown error"}`);
    }
    setTriggeringSearchId(null);
  }

  const historyUser = users.find((u) => u.id === historyUserId);
  const searchesUser = users.find((u) => u.id === searchesUserId);

  return (
    <>
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Renewal</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Searches</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Search</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Calendars</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Sync</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map((u) => {
                const isPaid = u.subscription_plan === "pro" && (u.subscription_status === "active" || u.subscription_status === "canceled" || u.subscription_status === "grandfathered");
                return (
                  <tr key={u.id} className={!u.is_approved ? "bg-amber-50" : ""}>
                    <td className="px-4 py-3 font-medium">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_approved ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                        {u.is_approved ? "Approved" : "Pending"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_admin ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>
                        {u.is_admin ? "Admin" : "User"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <PlanBadge plan={u.subscription_plan} status={u.subscription_status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {u.subscription_current_period_end
                        ? new Date(u.subscription_current_period_end).toLocaleDateString("en-US", { timeZone: "America/Denver" })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">{u.search_count}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{u.last_search_at ? new Date(u.last_search_at).toLocaleDateString("en-US", { timeZone: "America/Denver" }) : "—"}</td>
                    <td className="px-4 py-3">{u.calendar_count}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{u.last_sync_at ? new Date(u.last_sync_at).toLocaleDateString("en-US", { timeZone: "America/Denver" }) : "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(u.created_at).toLocaleDateString("en-US", { timeZone: "America/Denver" })}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-2">
                          <button
                            onClick={() => toggleApproval(u.id, u.is_approved)}
                            className={`text-sm font-medium ${u.is_approved ? "text-red-600 hover:text-red-800" : "text-green-600 hover:text-green-800"}`}
                          >
                            {u.is_approved ? "Revoke" : "Approve"}
                          </button>
                          <button
                            onClick={() => toggleAdmin(u.id, u.is_admin)}
                            className="text-amber-700 hover:text-slate-800 text-sm font-medium"
                          >
                            {u.is_admin ? "Remove Admin" : "Make Admin"}
                          </button>
                        </div>
                        <div className="flex gap-2">
                          {isPaid && u.subscription_status !== "canceled" && (
                            <button
                              onClick={() => downgradeUser(u.id, !!u.subscription_id)}
                              disabled={cancelingId === u.id}
                              className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                            >
                              {cancelingId === u.id ? "Downgrading..." : "Downgrade"}
                            </button>
                          )}
                          <button
                            onClick={() => viewSearches(u.id)}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                          >
                            Searches
                          </button>
                          {u.stripe_customer_id && (
                            <button
                              onClick={() => viewPaymentHistory(u.id)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              Payments
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Searches Modal */}
      {searchesUserId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                Saved Searches — {searchesUser?.email}
              </h2>
              <button
                onClick={() => setSearchesUserId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
              {searchTriggerMsg && (
                <div className={`mb-4 px-4 py-2 rounded text-sm ${searchTriggerMsg.startsWith("Failed") ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
                  {searchTriggerMsg}
                </div>
              )}
              {searchesLoading ? (
                <p className="text-gray-500 text-sm py-4">Loading searches...</p>
              ) : searches.length === 0 ? (
                <p className="text-gray-500 text-sm py-4">No saved searches found for this user.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Results</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Run</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {searches.map((s) => (
                      <tr key={s.id} className={!s.is_active ? "opacity-50" : ""}>
                        <td className="px-4 py-2 font-medium max-w-[200px] truncate" title={s.label}>
                          {s.label || s.search_value || "—"}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{s.search_type}</td>
                        <td className="px-4 py-2">{s.results_count ?? "—"}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                          {s.last_refreshed_at ? new Date(s.last_refreshed_at).toLocaleString("en-US", { timeZone: "America/Denver" }) : "Never"}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${s.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                            {s.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => triggerSearch(s.id)}
                            disabled={triggeringSearchId === s.id}
                            className="text-amber-700 hover:text-amber-900 text-sm font-medium disabled:opacity-50"
                          >
                            {triggeringSearchId === s.id ? "Running..." : "Run Now"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
              <button
                onClick={() => setSearchesUserId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {historyUserId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                Payment History — {historyUser?.email}
              </h2>
              <button
                onClick={() => setHistoryUserId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
              {historyLoading ? (
                <p className="text-gray-500 text-sm py-4">Loading payment history...</p>
              ) : payments.length === 0 ? (
                <p className="text-gray-500 text-sm py-4">No payments found.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {p.date ? new Date(p.date).toLocaleDateString("en-US", { timeZone: "America/Denver" }) : "—"}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap font-medium">
                          ${p.amount.toFixed(2)} {p.currency}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            p.status === "paid" ? "bg-green-100 text-green-800" :
                            p.status === "open" ? "bg-amber-100 text-amber-800" :
                            "bg-gray-100 text-gray-600"
                          }`}>
                            {p.status || "unknown"}
                          </span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-500 text-xs">
                          {p.periodStart && p.periodEnd
                            ? `${new Date(p.periodStart).toLocaleDateString("en-US", { timeZone: "America/Denver" })} - ${new Date(p.periodEnd).toLocaleDateString("en-US", { timeZone: "America/Denver" })}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2">
                          {p.invoiceUrl ? (
                            <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 text-sm">
                              View
                            </a>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
              <button
                onClick={() => setHistoryUserId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
