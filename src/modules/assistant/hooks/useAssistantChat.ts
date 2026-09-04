"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useMemo } from "react";

import {
  getStoredDemoRole,
  getStoredDemoStoreId,
  getStoredDemoUserId,
} from "@/shared/auth/demoAuth";

import { useInvalidateAssistantUsage } from "./useAssistantUsage";

function demoHeaders() {
  if (process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH !== "true") {
    return {};
  }

  const role = getStoredDemoRole();
  const userId = getStoredDemoUserId();
  const storeId = getStoredDemoStoreId();

  return {
    ...(role ? { "x-demo-role": role } : {}),
    ...(userId ? { "x-demo-user-id": userId } : {}),
    ...(storeId ? { "x-demo-store-id": storeId } : {}),
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  ASSISTANT_LIMIT_REACHED:
    "Alcanzaste el limite de consultas por hoy. El contador se reinicia manana.",
  ASSISTANT_PROVIDER_ERROR:
    "El servicio de IA no esta disponible en este momento. Intenta de nuevo en unos minutos.",
  BAD_REQUEST: "No pude leer esa pregunta. Reformulala e intenta otra vez.",
  FORBIDDEN: "Tu rol no tiene acceso al asistente.",
  UNAUTHORIZED: "Tu sesion expiro. Vuelve a iniciar sesion.",
};

/** Traduce el error del transporte (que llega como texto) a espanol. */
export function toAssistantErrorMessage(error: Error | undefined) {
  if (!error) {
    return null;
  }

  const raw = error.message ?? "";

  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } };
    const code = parsed.error?.code;

    if (code && ERROR_MESSAGES[code]) {
      return ERROR_MESSAGES[code];
    }

    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // El cuerpo no era JSON: seguimos con las heuristicas de abajo.
  }

  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (raw.includes(code)) {
      return message;
    }
  }

  return raw.trim() || "No pude completar la consulta. Intenta de nuevo.";
}

export function useAssistantChat() {
  const invalidateUsage = useInvalidateAssistantUsage();
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", headers: () => demoHeaders() }),
    [],
  );

  const chat = useChat({ onFinish: () => invalidateUsage(), transport });

  const ask = useCallback(
    (text: string) => {
      const question = text.trim();

      if (!question) {
        return;
      }

      void chat.sendMessage({ text: question });
    },
    [chat],
  );

  return {
    ...chat,
    ask,
    errorMessage: toAssistantErrorMessage(chat.error),
    isBusy: chat.status === "streaming" || chat.status === "submitted",
  };
}
