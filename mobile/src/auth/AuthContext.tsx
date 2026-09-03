import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { Permission } from "@bodega/core/permissions";

import { createApiClient, ApiClientError, type DemoAuthHeaders } from "@/api/apiClient";
import { hasSupabaseCredentials, isDemoAuthEnabled } from "@/api/config";

import {
  getAccessToken,
  getSupabaseClient,
  signInWithPassword,
  signOut,
  startSessionAutoRefresh,
} from "./session";
import type { AuthProfile } from "./types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  profile: AuthProfile | null;
  /** Motivo del ultimo cierre de sesion, para mostrarlo en el login. */
  signOutReason: string | null;
  demoAuth: DemoAuthHeaders | null;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  signOutSession: (reason?: string) => Promise<void>;
  setDemoAuth: (value: DemoAuthHeaders | null) => Promise<void>;
  refreshProfile: () => Promise<void>;
  can: (permission: Permission) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [signOutReason, setSignOutReason] = useState<string | null>(null);
  const [demoAuth, setDemoAuthState] = useState<DemoAuthHeaders | null>(
    isDemoAuthEnabled() && !hasSupabaseCredentials() ? { role: "admin" } : null,
  );

  const apiRequest = useMemo(
    () =>
      createApiClient({
        getAccessToken,
        getDemoAuth: () => demoAuth,
      }),
    [demoAuth],
  );

  const clearSession = useCallback(
    async (reason?: string) => {
      await signOut();
      queryClient.clear();
      setProfile(null);
      setSignOutReason(reason ?? null);
      setStatus("unauthenticated");
    },
    [queryClient],
  );

  const loadProfile = useCallback(async () => {
    try {
      const next = await apiRequest<AuthProfile>("/api/auth/me");

      // La web valida `isActive` en `/api/auth/login`; la app no pasa por ahi.
      if (!next.user.isActive) {
        await clearSession("Tu usuario esta inactivo. Contacta al administrador.");
        return;
      }

      setProfile(next);
      setStatus("authenticated");
    } catch (error) {
      if (error instanceof ApiClientError && error.isUnauthorized) {
        setProfile(null);
        setStatus("unauthenticated");
        return;
      }

      // Un fallo de red no debe expulsar a quien ya tenia sesion.
      setStatus((current) => (profile ? current : "unauthenticated"));
    }
  }, [apiRequest, clearSession, profile]);

  useEffect(() => {
    void loadProfile();
    // Solo en el arranque: los cambios de sesion pasan por onAuthStateChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => startSessionAutoRefresh(), []);

  useEffect(() => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setStatus("unauthenticated");
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void loadProfile();
      }
    });

    return () => data.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setSignOutReason(null);
      const result = await signInWithPassword(email, password);

      if (!result.ok) {
        return { ok: false, message: result.message };
      }

      await loadProfile();

      return { ok: true };
    },
    [loadProfile],
  );

  const setDemoAuth = useCallback(
    async (value: DemoAuthHeaders | null) => {
      setDemoAuthState(value);
      queryClient.clear();
      setStatus("loading");
    },
    [queryClient],
  );

  // Recarga el perfil cuando cambia el rol demo (el apiRequest ya es nuevo).
  useEffect(() => {
    if (status === "loading" && demoAuth) {
      void loadProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoAuth]);

  const can = useCallback(
    (permission: Permission) => profile?.permissions.includes(permission) ?? false,
    [profile],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      profile,
      signOutReason,
      demoAuth,
      signIn,
      signOutSession: clearSession,
      setDemoAuth,
      refreshProfile: loadProfile,
      can,
    }),
    [status, profile, signOutReason, demoAuth, signIn, clearSession, setDemoAuth, loadProfile, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  }

  return context;
}

export function useCan(permission: Permission) {
  return useAuth().can(permission);
}
