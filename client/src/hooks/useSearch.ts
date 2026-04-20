import { useState } from "react";
import { searchCourtEvents } from "@/api/search";
import { CourtEvent } from "@shared/types";

export function useSearch() {
  const [results, setResults] = useState<CourtEvent[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previousRunAt, setPreviousRunAt] = useState<string | null>(null);
  const [cachedToday, setCachedToday] = useState(false);
  const [savedSearchId, setSavedSearchId] = useState<number | null>(null);

  async function search(params: Record<string, string>) {
    setError("");
    setLoading(true);
    setSearched(true);
    setCachedToday(false);

    try {
      const data = await searchCourtEvents(params);
      setResults(data.results);
      setPreviousRunAt(data.previousRunAt ?? null);
      setCachedToday(data.cachedToday ?? false);
      setSavedSearchId(data.savedSearchId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
      setPreviousRunAt(null);
      setCachedToday(false);
      setSavedSearchId(null);
    } finally {
      setLoading(false);
    }
  }

  function clearResults() {
    setResults([]);
    setSearched(false);
    setError("");
    setPreviousRunAt(null);
    setCachedToday(false);
    setSavedSearchId(null);
  }

  return { results, searched, loading, error, previousRunAt, cachedToday, savedSearchId, search, clearResults };
}
