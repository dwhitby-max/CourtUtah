import { useState, useEffect } from "react";
import {
  EXPORT_FIELDS,
  ExportTemplate,
  SortLevel,
  loadExportTemplates,
  saveExportTemplates,
} from "@/utils/formatters";

interface ExportTemplateModalProps {
  onExport: (template: ExportTemplate) => void;
  onClose: () => void;
}

export default function ExportTemplateModal({ onExport, onClose }: ExportTemplateModalProps) {
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [editing, setEditing] = useState<ExportTemplate | null>(null);

  useEffect(() => {
    setTemplates(loadExportTemplates());
  }, []);

  function persist(updated: ExportTemplate[]) {
    setTemplates(updated);
    saveExportTemplates(updated);
  }

  function handleQuickExport(tmpl: ExportTemplate) {
    onExport(tmpl);
  }

  function startNew() {
    setEditing({
      id: crypto.randomUUID(),
      name: "",
      fieldKeys: EXPORT_FIELDS.map((f) => f.key),
      sortLevels: [],
    });
  }

  function startEdit(tmpl: ExportTemplate) {
    setEditing({
      ...tmpl,
      fieldKeys: [...tmpl.fieldKeys],
      sortLevels: tmpl.sortLevels?.length
        ? tmpl.sortLevels.map((l) => ({ ...l }))
        : tmpl.sortByKey
          ? [{ key: tmpl.sortByKey, dir: tmpl.sortDir || "asc" }]
          : [],
    });
  }

  function handleDelete(id: string) {
    persist(templates.filter((t) => t.id !== id));
  }

  function handleSave() {
    if (!editing || !editing.name.trim()) return;
    const exists = templates.find((t) => t.id === editing.id);
    if (exists) {
      persist(templates.map((t) => (t.id === editing.id ? editing : t)));
    } else {
      persist([...templates, editing]);
    }
    setEditing(null);
  }

  function toggleField(key: string) {
    if (!editing) return;
    const keys = editing.fieldKeys.includes(key)
      ? editing.fieldKeys.filter((k) => k !== key)
      : [...editing.fieldKeys, key];
    // Also remove from sort levels if unchecked
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

  // Sort level helpers
  function addSortLevel() {
    if (!editing) return;
    const usedKeys = new Set(editing.sortLevels.map((l) => l.key));
    const available = editing.fieldKeys.filter((k) => !usedKeys.has(k));
    if (available.length === 0) return;
    setEditing({
      ...editing,
      sortLevels: [...editing.sortLevels, { key: available[0], dir: "asc" }],
    });
  }

  function removeSortLevel(index: number) {
    if (!editing) return;
    const sortLevels = editing.sortLevels.filter((_, i) => i !== index);
    setEditing({ ...editing, sortLevels });
  }

  function updateSortLevel(index: number, updates: Partial<SortLevel>) {
    if (!editing) return;
    const sortLevels = editing.sortLevels.map((l, i) =>
      i === index ? { ...l, ...updates } : l
    );
    setEditing({ ...editing, sortLevels });
  }

  function moveSortLevel(index: number, dir: -1 | 1) {
    if (!editing) return;
    const sortLevels = [...editing.sortLevels];
    const newIdx = index + dir;
    if (newIdx < 0 || newIdx >= sortLevels.length) return;
    [sortLevels[index], sortLevels[newIdx]] = [sortLevels[newIdx], sortLevels[index]];
    setEditing({ ...editing, sortLevels });
  }

  function sortDescription(tmpl: ExportTemplate): string {
    const levels = tmpl.sortLevels?.length
      ? tmpl.sortLevels
      : tmpl.sortByKey
        ? [{ key: tmpl.sortByKey, dir: tmpl.sortDir || "asc" }]
        : [];
    if (levels.length === 0) return "";
    const names = levels.map((l) => {
      const label = EXPORT_FIELDS.find((f) => f.key === l.key)?.label || l.key;
      return `${label} ${l.dir === "desc" ? "Z-A" : "A-Z"}`;
    });
    return ` · sort: ${names.join(" → ")}`;
  }

  // Template list view
  if (!editing) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Export CSV</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Default all-fields export */}
          <button
            onClick={() => handleQuickExport({
              id: "default",
              name: "All Fields",
              fieldKeys: EXPORT_FIELDS.map((f) => f.key),
              sortLevels: [],
            })}
            className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors mb-2"
          >
            <div className="font-medium text-gray-900">All Fields</div>
            <div className="text-xs text-gray-500">Export all columns, default sort</div>
          </button>

          {/* Saved templates */}
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors mb-2"
            >
              <button
                onClick={() => handleQuickExport(tmpl)}
                className="flex-1 text-left"
              >
                <div className="font-medium text-gray-900">{tmpl.name}</div>
                <div className="text-xs text-gray-500">
                  {tmpl.fieldKeys.length} field{tmpl.fieldKeys.length !== 1 ? "s" : ""}
                  {sortDescription(tmpl)}
                </div>
              </button>
              <button
                onClick={() => startEdit(tmpl)}
                className="p-1.5 text-gray-400 hover:text-blue-600 rounded"
                title="Edit template"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <button
                onClick={() => handleDelete(tmpl.id)}
                className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                title="Delete template"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}

          <button
            onClick={startNew}
            className="w-full mt-2 px-4 py-2 text-sm font-medium rounded-md border-2 border-dashed border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            + New Template
          </button>
        </div>
      </div>
    );
  }

  // Template editor view
  const selectedFields = editing.fieldKeys
    .map((key) => EXPORT_FIELDS.find((f) => f.key === key))
    .filter((f): f is (typeof EXPORT_FIELDS)[number] => f != null);

  const usedSortKeys = new Set(editing.sortLevels.map((l) => l.key));
  const availableSortFields = selectedFields.filter((f) => !usedSortKeys.has(f.key));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => setEditing(null)} />
      <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {templates.find((t) => t.id === editing.id) ? "Edit Template" : "New Template"}
        </h3>

        {/* Template name */}
        <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
        <input
          type="text"
          value={editing.name}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          placeholder="e.g. Defense Summary"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-4 focus:ring-blue-500 focus:border-blue-500"
        />

        {/* Field selection */}
        <label className="block text-sm font-medium text-gray-700 mb-2">Fields (check to include, arrows to reorder)</label>
        <div className="border border-gray-200 rounded-md divide-y divide-gray-100 mb-4 max-h-64 overflow-y-auto">
          {EXPORT_FIELDS.map((field) => {
            const included = editing.fieldKeys.includes(field.key);
            const idx = editing.fieldKeys.indexOf(field.key);
            return (
              <div key={field.key} className="flex items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => toggleField(field.key)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="flex-1 text-sm text-gray-800">{field.label}</span>
                {included && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => moveField(idx, -1)}
                      disabled={idx === 0}
                      className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      title="Move up"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => moveField(idx, 1)}
                      disabled={idx === editing.fieldKeys.length - 1}
                      className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      title="Move down"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Multi-level sort */}
        <label className="block text-sm font-medium text-gray-700 mb-2">Sort Priority</label>
        <div className="space-y-2 mb-2">
          {editing.sortLevels.map((level, i) => {
            const fieldLabel = EXPORT_FIELDS.find((f) => f.key === level.key)?.label || level.key;
            return (
              <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-2">
                <span className="text-xs font-medium text-gray-500 w-4">{i + 1}.</span>
                <select
                  value={level.key}
                  onChange={(e) => updateSortLevel(i, { key: e.target.value })}
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value={level.key}>{fieldLabel}</option>
                  {availableSortFields.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
                <select
                  value={level.dir}
                  onChange={(e) => updateSortLevel(i, { dir: e.target.value as "asc" | "desc" })}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="asc">A-Z</option>
                  <option value="desc">Z-A</option>
                </select>
                <div className="flex gap-0.5">
                  <button
                    onClick={() => moveSortLevel(i, -1)}
                    disabled={i === 0}
                    className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                    title="Higher priority"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => moveSortLevel(i, 1)}
                    disabled={i === editing.sortLevels.length - 1}
                    className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                    title="Lower priority"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={() => removeSortLevel(i)}
                  className="p-0.5 text-gray-400 hover:text-red-600"
                  title="Remove sort level"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        {availableSortFields.length > 0 && (
          <button
            onClick={addSortLevel}
            className="text-sm text-blue-600 hover:text-blue-800 mb-4"
          >
            + Add sort level
          </button>
        )}
        {editing.sortLevels.length === 0 && (
          <p className="text-xs text-gray-400 mb-4">No sort applied — results export in default order.</p>
        )}

        {/* Preview */}
        {selectedFields.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Column Preview</label>
            <div className="flex flex-wrap gap-1">
              {selectedFields.map((f, i) => (
                <span key={f.key} className="inline-flex items-center text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                  {i + 1}. {f.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setEditing(null)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!editing.name.trim() || editing.fieldKeys.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save Template
          </button>
        </div>
      </div>
    </div>
  );
}
