import { apiFetch } from "./client";
import { SearchResponse } from "@shared/types";

export async function searchCourtEvents(params: Record<string, string>): Promise<SearchResponse> {
  const queryString = new URLSearchParams(params).toString();
  const res = await apiFetch(`/search?${queryString}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Search failed");
  return data;
}
