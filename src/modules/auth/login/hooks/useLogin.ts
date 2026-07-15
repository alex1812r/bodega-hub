"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";
import { clearStoredDemoAuth } from "@/shared/auth/demoAuth";
import { getDefaultHomePathForRole } from "@/shared/auth/defaultHomePath";

import { type LoginFormValues } from "../schemas/loginSchema";
import { loginWithPassword } from "../services/loginWithPassword";

export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: LoginFormValues) => loginWithPassword(values),
    onSuccess: async (session) => {
      clearStoredDemoAuth();
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.all });

      const nextPath = new URLSearchParams(window.location.search).get("next");
      const safeNext =
        nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
          ? nextPath
          : null;

      router.push(safeNext ?? getDefaultHomePathForRole(session.role));
    },
  });
}
