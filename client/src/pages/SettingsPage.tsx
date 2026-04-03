import { useState, useEffect } from "react";
import { useAuth } from "@/store/authStore";
import { getSubscription, createCheckoutSession, cancelSubscription } from "@/api/billing";
import { fetchExportTemplates, createExportTemplate, updateExportTemplate, deleteExportTemplate } from "@/api/exportTemplates";
import { EXPORT_FIELDS, ExportTemplate, SortLevel } from "@/utils/formatters";

export default function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"subscription" | "templates" | "support">("subscription");

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {(["subscription", "templates", "support"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "subscription" ? "Subscription" : tab === "templates" ? "Export Templates" : "Support"}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "subscription" && <SubscriptionSection />}
      {activeTab === "templates" && <TemplatesSection />}
      {activeTab === "support" && <SupportSection email={user?.email || ""} />}
    </div>
  );
}

// ---- Subscription Section ----

function SubscriptionSection() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<{ plan: string; status: string; currentPeriodEnd: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getSubscription()
      .then(setSubscription)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isPro = subscription?.plan === "pro" && (subscription?.status === "active" || subscription?.status === "grandfathered");
  const isCanceling = subscription?.status === "canceling" || subscription?.status === "cancel_at_period_end";

  async function handleUpgrade() {
    setUpgradeLoading(true);
    setError("");
    try {
      const { url } = await createCheckoutSession();
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
    } finally {
      setUpgradeLoading(false);
    }
  }

  async function handleCancel() {
    setCancelLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await cancelSubscription();
      setMessage(result.message);
      setCancelConfirm(false);
      // Refresh subscription status
      const sub = await getSubscription();
      setSubscription(sub);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel subscription");
    } finally {
      setCancelLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading subscription...</p>;

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Plan</h2>
        <div className="flex items-center gap-3 mb-4">
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${isPro ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-700"}`}>
            {isPro ? "Pro" : "Free"}
          </span>
          {isPro && (
            <span className="text-sm text-gray-500">
              ${14.99}/month
            </span>
          )}
        </div>

        {/* Limits */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-gray-50 rounded-md p-3">
            <div className="text-xs text-gray-500">Saved Searches</div>
            <div className="text-lg font-semibold">{isPro ? "Unlimited" : "3"}</div>
          </div>
          <div className="bg-gray-50 rounded-md p-3">
            <div className="text-xs text-gray-500">Search Results</div>
            <div className="text-lg font-semibold">{isPro ? "Unlimited" : "5 visible"}</div>
          </div>
          <div className="bg-gray-50 rounded-md p-3">
            <div className="text-xs text-gray-500">Date Range</div>
            <div className="text-lg font-semibold">{isPro ? "Unlimited" : "1 week"}</div>
          </div>
          <div className="bg-gray-50 rounded-md p-3">
            <div className="text-xs text-gray-500">Export Templates</div>
            <div className="text-lg font-semibold">{isPro ? "Unlimited" : "Unlimited"}</div>
          </div>
        </div>

        {/* Renewal / Status */}
        {isPro && subscription?.currentPeriodEnd && (
          <div className="text-sm text-gray-600 mb-4">
            {isCanceling ? (
              <span className="text-amber-600">
                Your subscription will end on <strong>{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</strong>. You will not be charged again.
              </span>
            ) : (
              <>Next renewal: <strong>{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</strong></>
            )}
          </div>
        )}

        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        {message && <div className="text-sm text-green-600 mb-3">{message}</div>}

        {/* Actions */}
        <div className="flex gap-3">
          {!isPro && (
            <button
              onClick={handleUpgrade}
              disabled={upgradeLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {upgradeLoading ? "Loading..." : "Upgrade to Pro - $14.99/mo"}
            </button>
          )}

          {isPro && !isCanceling && (
            <>
              {!cancelConfirm ? (
                <button
                  onClick={() => setCancelConfirm(true)}
                  className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
                >
                  Cancel Subscription
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600">Are you sure?</span>
                  <button
                    onClick={handleCancel}
                    disabled={cancelLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {cancelLoading ? "Canceling..." : "Yes, Cancel"}
                  </button>
                  <button
                    onClick={() => setCancelConfirm(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    Never mind
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Templates Section ----

function TemplatesSection() {
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExportTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchExportTemplates()
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!editing || !editing.name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const exists = templates.find((t) => t.id === editing.id);
      if (exists) {
        const updated = await updateExportTemplate(editing);
        setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } else {
        const created = await createExportTemplate(editing);
        setTemplates((prev) => [...prev, created]);
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try {
      await deleteExportTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch { /* ignore */ }
  }

  function startNew() {
    setEditing({
      id: "",
      name: "",
      fieldKeys: EXPORT_FIELDS.map((f) => f.key),
      sortLevels: [],
    });
  }

  function startEdit(tmpl: ExportTemplate) {
    setEditing({ ...tmpl, fieldKeys: [...tmpl.fieldKeys], sortLevels: tmpl.sortLevels.map((l) => ({ ...l })) });
  }

  function toggleField(key: string) {
    if (!editing) return;
    const keys = editing.fieldKeys.includes(key) ? editing.fieldKeys.filter((k) => k !== key) : [...editing.fieldKeys, key];
    const sortLevels = editing.sortLevels.filter((l) => keys.includes(l.key));
    setEditing({ ...editing, fieldKeys: keys, sortLevels });
  }

  function moveField(index: number, dir: -1 | 1) {
    if (!editing) return;
    const keys = [...editing.fieldKeys];
    const newIdx = index + dir;
    if (newIdx < 0 || newIdx >= keys.length) return;
    [keys[index], keys[newIdx]] = [keys[newIdx], keys[index]];
    setEditing({ ...editing, fieldKeys: keys });
  }

  function addSortLevel() {
    if (!editing) return;
    const usedKeys = new Set(editing.sortLevels.map((l) => l.key));
    const available = editing.fieldKeys.filter((k) => !usedKeys.has(k));
    if (available.length === 0) return;
    setEditing({ ...editing, sortLevels: [...editing.sortLevels, { key: available[0], dir: "asc" }] });
  }

  function removeSortLevel(index: number) {
    if (!editing) return;
    setEditing({ ...editing, sortLevels: editing.sortLevels.filter((_, i) => i !== index) });
  }

  function updateSortLevel(index: number, updates: Partial<SortLevel>) {
    if (!editing) return;
    setEditing({ ...editing, sortLevels: editing.sortLevels.map((l, i) => i === index ? { ...l, ...updates } : l) });
  }

  function moveSortLevel(index: number, dir: -1 | 1) {
    if (!editing) return;
    const sortLevels = [...editing.sortLevels];
    const newIdx = index + dir;
    if (newIdx < 0 || newIdx >= sortLevels.length) return;
    [sortLevels[index], sortLevels[newIdx]] = [sortLevels[newIdx], sortLevels[index]];
    setEditing({ ...editing, sortLevels });
  }

  if (loading) return <p className="text-sm text-gray-500">Loading templates...</p>;

  // Template list view
  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Export Templates</h2>
          <button onClick={startNew} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">
            + New Template
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-500">
            No export templates yet. Create one to customize your CSV exports.
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((tmpl) => (
              <div key={tmpl.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{tmpl.name}</div>
                  <div className="text-xs text-gray-500">
                    {tmpl.fieldKeys.length} field{tmpl.fieldKeys.length !== 1 ? "s" : ""}
                    {tmpl.sortLevels.length > 0 && ` · ${tmpl.sortLevels.length} sort level${tmpl.sortLevels.length !== 1 ? "s" : ""}`}
                  </div>
                </div>
                <button onClick={() => startEdit(tmpl)} className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors">
                  Edit
                </button>
                <button onClick={() => handleDelete(tmpl.id)} className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Template editor
  const selectedFields = editing.fieldKeys
    .map((key) => EXPORT_FIELDS.find((f) => f.key === key))
    .filter((f): f is (typeof EXPORT_FIELDS)[number] => f != null);
  const usedSortKeys = new Set(editing.sortLevels.map((l) => l.key));
  const availableSortFields = selectedFields.filter((f) => !usedSortKeys.has(f.key));

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        {templates.find((t) => t.id === editing.id) ? "Edit Template" : "New Template"}
      </h2>

      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

      <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
      <input
        type="text"
        value={editing.name}
        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        placeholder="e.g. Defense Summary"
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-4 focus:ring-blue-500 focus:border-blue-500"
      />

      <label className="block text-sm font-medium text-gray-700 mb-2">Fields</label>
      <div className="border border-gray-200 rounded-md divide-y divide-gray-100 mb-4 max-h-64 overflow-y-auto">
        {EXPORT_FIELDS.map((field) => {
          const included = editing.fieldKeys.includes(field.key);
          const idx = editing.fieldKeys.indexOf(field.key);
          return (
            <div key={field.key} className="flex items-center gap-2 px-3 py-2">
              <input type="checkbox" checked={included} onChange={() => toggleField(field.key)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="flex-1 text-sm text-gray-800">{field.label}</span>
              {included && (
                <div className="flex gap-1">
                  <button onClick={() => moveField(idx, -1)} disabled={idx === 0} className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button onClick={() => moveField(idx, 1)} disabled={idx === editing.fieldKeys.length - 1} className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label className="block text-sm font-medium text-gray-700 mb-2">Sort Priority</label>
      <div className="space-y-2 mb-2">
        {editing.sortLevels.map((level, i) => {
          const fieldLabel = EXPORT_FIELDS.find((f) => f.key === level.key)?.label || level.key;
          return (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-2">
              <span className="text-xs font-medium text-gray-500 w-4">{i + 1}.</span>
              <select value={level.key} onChange={(e) => updateSortLevel(i, { key: e.target.value })} className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm">
                <option value={level.key}>{fieldLabel}</option>
                {availableSortFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select value={level.dir} onChange={(e) => updateSortLevel(i, { dir: e.target.value as "asc" | "desc" })} className="px-2 py-1.5 border border-gray-300 rounded text-sm">
                <option value="asc">A-Z</option>
                <option value="desc">Z-A</option>
              </select>
              <button onClick={() => moveSortLevel(i, -1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg></button>
              <button onClick={() => moveSortLevel(i, 1)} disabled={i === editing.sortLevels.length - 1} className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></button>
              <button onClick={() => removeSortLevel(i)} className="p-0.5 text-gray-400 hover:text-red-600"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          );
        })}
      </div>
      {availableSortFields.length > 0 && (
        <button onClick={addSortLevel} className="text-sm text-blue-600 hover:text-blue-800 mb-4">+ Add sort level</button>
      )}

      {selectedFields.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Column Preview</label>
          <div className="flex flex-wrap gap-1">
            {selectedFields.map((f, i) => (
              <span key={f.key} className="inline-flex items-center text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">{i + 1}. {f.label}</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={!editing.name.trim() || editing.fieldKeys.length === 0 || saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? "Saving..." : "Save Template"}
        </button>
      </div>
    </div>
  );
}

// ---- Support Section ----

function SupportSection({ email }: { email: string }) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact Support</h2>
        <p className="text-sm text-gray-600 mb-4">
          Need help? Have feedback or feature requests? Reach out to our support team.
        </p>
        <a
          href={`mailto:ops@1564hub.com?subject=Court Calendar Support - ${email}`}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Email ops@1564hub.com
        </a>
      </div>
    </div>
  );
}
