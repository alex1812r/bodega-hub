"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";
import { clearStoredDemoAuth } from "@/shared/auth/demoAuth";
import { getDefaultHomePathForRole } from "@/shared/auth/defaultHomePath";
import { resolveLoginNextPath } from "@/shared/auth/loginRedirect";

import { type LoginFormValues } from "../schemas/loginSchema";
import { loginWithPassword } from "../services/loginWithPassword";

export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Cerrojo síncrono: `isPending` llega un render tarde, y doble clic o Enter +
  // clic enviarían dos POST. Se suelta solo si el intento falla; tras el éxito
  // sigue echado mientras la app navega fuera del login.
  const submitLockRef = useRef(false);

  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) => loginWithPassword(values),
    onSuccess: async (session) => {
      clearStoredDemoAuth();
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.all });

      const nextPath = new URLSearchParams(window.location.search).get("next");

      router.push(resolveLoginNextPath(nextPath, getDefaultHomePathForRole(session.role)));
    },
    onError: () => {
      submitLockRef.current = false;
    },
  });
  const { mutate } = mutation;

  /** Envía el formulario; ignora los envíos repetidos mientras hay uno en curso. */
  const submit = useCallback(
    (values: LoginFormValues) => {
      if (submitLockRef.current) {
        return;
      }

      submitLockRef.current = true;
      mutate(values);
    },
    [mutate],
  );

  return { ...mutation, submit };
}
