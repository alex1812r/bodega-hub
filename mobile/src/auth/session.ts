import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, type AppStateStatus } from "react-native";

import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseCredentials } from "@/api/config";

import { secureChunkStorage } from "./secureChunkStorage";

let client: SupabaseClient | null = null;

/**
 * Cliente de Supabase del dispositivo. Solo se usa para autenticacion: los datos
 * siempre pasan por el BFF (`/api/*`), nunca por Supabase directo.
 *
 * Devuelve `null` si no hay credenciales; en ese caso la app trabaja contra el
 * BFF en modo mock con headers demo.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!hasSupabaseCredentials()) {
    return null;
  }

  if (!client) {
    client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: {
        storage: secureChunkStorage,
        autoRefreshToken: true,
        persistSession: true,
        // No hay callback por URL en movil.
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}

/**
 * Supabase solo refresca el token mientras la app esta en primer plano; hay que
 * atarlo a AppState o la sesion caduca en segundo plano (caso de caos 11.11).
 */
export function startSessionAutoRefresh() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return () => {};
  }

  const sync = (state: AppStateStatus) => {
    if (state === "active") {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };

  sync(AppState.currentState);
  const subscription = AppState.addEventListener("change", sync);

  return () => {
    subscription.remove();
    void supabase.auth.stopAutoRefresh();
  };
}

export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? null;
}

export type SignInResult =
  | { ok: true }
  | { ok: false; message: string };

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      ok: false,
      message: "La app no tiene credenciales de Supabase configuradas.",
    };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { ok: false, message: toSpanishAuthMessage(error.message) };
  }

  return { ok: true };
}

export async function signOut() {
  const supabase = getSupabaseClient();
  await supabase?.auth.signOut();
}

/** Los mensajes de Supabase llegan en ingles; la UI es toda en espanol. */
export function toSpanishAuthMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "Correo o contrasena incorrectos.";
  }

  if (normalized.includes("email not confirmed")) {
    return "Debes confirmar tu correo antes de ingresar.";
  }

  if (normalized.includes("too many requests") || normalized.includes("rate limit")) {
    return "Demasiados intentos. Espera un momento y vuelve a intentar.";
  }

  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "No hay conexion con el servidor.";
  }

  return "No se pudo iniciar sesion. Intenta de nuevo.";
}
