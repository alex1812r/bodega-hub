"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";

import type { AssistantUsage } from "../types";

export const assistantKeys = {
  usage: ["assistant", "usage"] as const,
};

export function useAssistantUsage() {
  return useQuery({
    queryKey: assistantKeys.usage,
    queryFn: () => apiFetch<AssistantUsage>("/api/assistant/usage"),
  });
}

export function useInvalidateAssistantUsage() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.usage });
  };
}
