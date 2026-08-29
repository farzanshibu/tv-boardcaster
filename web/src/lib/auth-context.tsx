"use client";

// SOT: auth-context, session-state, permission-gate, realtime-dashboard-feed
// WHAT:  holds the signed-in session and exposes can() plus live screen updates.
// WHY:   one place owns the token lifecycle so no view re-implements auth.
// HOW:   loads /auth/me once, opens the dashboard WebSocket, refreshes on demand.
// WHERE: permissions are derived in ./resources.ts; the API client is ./api.ts

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { api, tokenStore } from "./api";
import { can as canWithRole, type PermissionKey } from "./resources";
import type { Session } from "./types";

interface AuthValue {
  session: Session | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  can: (perm: PermissionKey) => boolean;
  /** Increments whenever a screen changes state, so views can re-fetch. */
  liveTick: number;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveTick, setLiveTick] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) { setSession(null); setLoading(false); return; }
    try {
      setSession(await api.me());
    } catch {
      tokenStore.clear();
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signOut = useCallback(() => {
    tokenStore.clear();
    socketRef.current?.close();
    socketRef.current = null;
    setSession(null);
    router.push("/login");
  }, [router]);

  const signIn = useCallback(async (token: string) => {
    tokenStore.set(token);
    setLoading(true);
    await refresh();
  }, [refresh]);

  // Live screen status feed. Reconnects on drop; closes on sign-out.
  useEffect(() => {
    if (!session) return;
    const token = tokenStore.get();
    if (!token || socketRef.current) return;

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${proto}://${window.location.host}/dashboard/session?token=${encodeURIComponent(token)}`,
      );
      socketRef.current = ws;
      ws.onmessage = (ev: MessageEvent<string>) => {
        const msg: unknown = JSON.parse(ev.data);
        if (typeof msg === "object" && msg !== null && "type" in msg) {
          const kind = (msg as { type: string }).type;
          if (kind === "screen_status" || kind === "publish" || kind === "screen_added") {
            setLiveTick((n) => n + 1);
          }
        }
      };
      ws.onclose = () => {
        socketRef.current = null;
        if (!cancelled) retry = setTimeout(connect, 5000);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [session]);

  const can = useCallback(
    (perm: PermissionKey) => canWithRole(session?.user.role, perm),
    [session],
  );

  const value = useMemo<AuthValue>(
    () => ({ session, loading, refresh, signIn, signOut, can, liveTick }),
    [session, loading, refresh, signIn, signOut, can, liveTick],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Session guaranteed non-null: for use inside the authenticated dashboard. */
export function useSession(): Session {
  const { session } = useAuth();
  if (!session) throw new Error("useSession requires an authenticated layout");
  return session;
}
