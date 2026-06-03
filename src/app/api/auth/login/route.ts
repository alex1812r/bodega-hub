import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { getProfileByUserId } from "@/lib/supabase/auth/profile.server";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());
    const supabase = await createRouteSupabaseClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      throw mapSupabaseError(error);
    }

    if (!data.user) {
      throw mapSupabaseError(new Error("Invalid login credentials"));
    }

    const profile = await getProfileByUserId(data.user.id);

    if (!profile) {
      throw mapSupabaseError(new Error("Tu usuario no tiene un perfil asignado."));
    }

    if (!profile.isActive) {
      throw mapSupabaseError(new Error("Tu usuario esta inactivo."));
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
