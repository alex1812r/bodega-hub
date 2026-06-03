"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";
import { clearStoredDemoAuth } from "@/shared/auth/demoAuth";

import { type LoginFormValues } from "../schemas/loginSchema";
import { loginWithPassword } from "../services/loginWithPassword";

export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: LoginFormValues) => loginWithPassword(values),
    onSuccess: async () => {
      clearStoredDemoAuth();
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.all });
      router.push("/dashboard");
    },
  });
}
