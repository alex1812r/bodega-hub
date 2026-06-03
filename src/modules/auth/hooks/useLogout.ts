"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { apiFetch } from "@/shared/api/apiFetch";

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () =>
      apiFetch<{ signedOut: boolean }>("/api/auth/logout", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.clear();
      router.push("/login");
    },
  });
}
