import { apiFetch } from "./client";
import { SearchResponse } from "@shared/types";

export async function searchCourtEvents(params: Record<string, string>, opts?: { forceRefresh?: boolean }): Promise<SearchResponse> {
  const qsParams = { ...params };
  if (opts?.forceRefresh) qsParams.force_refresh = "true";
  const queryString = new URLSearchParams(qsParams).toString();
  const res = await apiFetch(`/search?${queryString}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Search failed");
  return data;
}
