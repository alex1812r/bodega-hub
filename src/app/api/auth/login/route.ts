import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { getProfileByUserId } from "@/lib/supabase/auth/profile.server";
import { isAuthServiceFailure } from "@/lib/supabase/auth/sessionErrors";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const LOGIN_FAILED_MESSAGE = "No se pudo iniciar sesión. Inténtalo de nuevo.";

type RouteSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

function loginUnavailableError() {
  return new ApiError(503, "INTERNAL_ERROR", LOGIN_FAILED_MESSAGE);
}

/**
 * Rechazo de `signInWithPassword` como error propio: nunca el texto de GoTrue ni
 * un 500 por un rechazo 4xx. Credenciales inválidas y correo sin confirmar
 * conservan el 401 de `mapSupabaseError`.
 */
function mapSignInError(error: unknown): ApiError {
  if (isAuthServiceFailure(error)) {
    return loginUnavailableError();
  }

  const { code, message, status } = error as { code?: unknown; message?: unknown; status?: unknown };

  if (code === "user_banned" || (typeof message === "string" && /\buser is banned\b/i.test(message))) {
    return new ApiError(403, "FORBIDDEN", "Tu usuario está bloqueado. Contacta al administrador.");
  }

  const mapped = mapSupabaseError(error);

  if (mapped.status < 500) {
    return mapped;
  }

  if (status === 429) {
    return new ApiError(
      429,
      "BAD_REQUEST",
      "Demasiados intentos de inicio de sesión. Espera un momento e inténtalo de nuevo.",
    );
  }

  if (typeof status === "number" && status >= 400 && status < 500) {
    return new ApiError(
      400,
      "BAD_REQUEST",
      "No se pudo iniciar sesión con esos datos. Revísalos e inténtalo de nuevo.",
    );
  }

  return new ApiError(500, "INTERNAL_ERROR", LOGIN_FAILED_MESSAGE);
}

/**
 * 403 para un usuario autenticado que no puede entrar. Antes cierra la sesión que
 * `signInWithPassword` acaba de crear (`local`: solo esta; borra sus cookies de la
 * respuesta). Si no se pudo cerrar, la respuesta es 503: un 403 dejaría la cookie
 * de sesión puesta.
 */
async function rejectSignedInUser(supabase: RouteSupabaseClient, message: string): Promise<ApiError> {
  const { error } = await supabase.auth.signOut({ scope: "local" });

  return error ? loginUnavailableError() : new ApiError(403, "FORBIDDEN", message);
}

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await readJsonBody(request));
    const supabase = await createRouteSupabaseClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      throw mapSignInError(error);
    }

    if (!data.user) {
      throw mapSupabaseError(new Error("Invalid login credentials"));
    }

    const profile = await getProfileByUserId(data.user.id);

    if (!profile) {
      throw await rejectSignedInUser(supabase, "Tu usuario no tiene un perfil asignado.");
    }

    if (!profile.isActive) {
      throw await rejectSignedInUser(supabase, "Tu usuario está inactivo.");
    }

    return jsonData({
      role: profile.role,
      user: {
        email: data.user.email,
        id: data.user.id,
        isActive: profile.isActive,
        name: profile.name,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
