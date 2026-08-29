"use client";

// SOT: data-fetching-hook, async-view-state
// WHAT:  loads data for a view and re-runs when the live feed reports a change.
// WHY:   every view needs the same loading/error/refetch shape; duplicating it drifts.
// HOW:   depends on liveTick from the auth context so WebSocket events refresh views.
// WHERE: the API client is ./api.ts

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import { describeError } from "./api";

interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): QueryState<T> {
  const { liveTick } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((result) => { if (!cancelled) { setData(result); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(describeError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, liveTick, ...deps]);

  return { data, error, loading, reload };
}
