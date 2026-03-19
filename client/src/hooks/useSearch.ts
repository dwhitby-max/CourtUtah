import { useState } from "react";
import { searchCourtEvents } from "@/api/search";
import { CourtEvent } from "@shared/types";

export function useSearch() {
  const [results, setResults] = useState<CourtEvent[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previousRunAt, setPreviousRunAt] = useState<string | null>(null);

  async function search(params: Record<string, string>) {
    setError("");
    setLoading(true);
    setSearched(true);

    try {
      const data = await searchCourtEvents(params);
      setResults(data.results);
      setPreviousRunAt(data.previousRunAt ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
      setPreviousRunAt(null);
    } finally {
      setLoading(false);
    }
  }

  function clearResults() {
    setResults([]);
    setSearched(false);
    setError("");
    setPreviousRunAt(null);
  }

  return { results, searched, loading, error, previousRunAt, search, clearResults };
}
