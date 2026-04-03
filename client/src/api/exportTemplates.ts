import { apiFetch } from "./client";
import type { ExportTemplate, SortLevel } from "@/utils/formatters";

interface DbTemplate {
  id: number;
  name: string;
  fieldKeys: string[];
  sortLevels: SortLevel[];
}

function toExportTemplate(t: DbTemplate): ExportTemplate {
  return { id: String(t.id), name: t.name, fieldKeys: t.fieldKeys, sortLevels: t.sortLevels };
}

export async function fetchExportTemplates(): Promise<ExportTemplate[]> {
  const res = await apiFetch("/export-templates");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.templates || []).map(toExportTemplate);
}

export async function createExportTemplate(t: Omit<ExportTemplate, "id">): Promise<ExportTemplate> {
  const res = await apiFetch("/export-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: t.name, fieldKeys: t.fieldKeys, sortLevels: t.sortLevels }),
  });
  if (!res.ok) throw new Error("Failed to create template");
  return toExportTemplate(await res.json());
}

export async function updateExportTemplate(t: ExportTemplate): Promise<ExportTemplate> {
  const res = await apiFetch(`/export-templates/${t.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: t.name, fieldKeys: t.fieldKeys, sortLevels: t.sortLevels }),
  });
  if (!res.ok) throw new Error("Failed to update template");
  return toExportTemplate(await res.json());
}

export async function deleteExportTemplate(id: string): Promise<void> {
  const res = await apiFetch(`/export-templates/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete template");
}
