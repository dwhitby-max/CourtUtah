import { useState } from "react";
import { searchCourtEvents } from "@/api/search";
import { CourtEvent } from "@shared/types";

export function useSearch() {
  const [results, setResults] = useState<CourtEvent[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search(params: Record<string, string>) {
    setError("");
    setLoading(true);
    setSearched(true);

    try {
      const data = await searchCourtEvents(params);
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function clearResults() {
    setResults([]);
    setSearched(false);
    setError("");
  }

  return { results, searched, loading, error, search, clearResults };
}
