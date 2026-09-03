"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";

import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { Button } from "@/shared/components/Button";
import { PageHeader } from "@/shared/components/PageHeader";

import { useAssistantChat } from "../hooks/useAssistantChat";
import { useAssistantUsage } from "../hooks/useAssistantUsage";

import { AssistantComposer } from "./components/AssistantComposer";
import {
  AssistantEmptyState,
  PLATFORM_SUGGESTIONS,
  STORE_SUGGESTIONS,
} from "./components/AssistantEmptyState";
import { AssistantMessageList } from "./components/AssistantMessageList";
import { AssistantUsageBadge } from "./components/AssistantUsageBadge";

export function AssistantHomePage() {
  const currentUser = useCurrentUser();
  const usage = useAssistantUsage();
  const chat = useAssistantChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isSuperadmin = currentUser.data?.role === "superadmin";
  const limitReached = Boolean(usage.data && usage.data.used >= usage.data.limit);

  useEffect(() => {
    if (!chat.isBusy) {
      inputRef.current?.focus();
    }
  }, [chat.isBusy]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        actions={<AssistantUsageBadge usage={usage.data} />}
        description={
          isSuperadmin
            ? "Pregunta por el desempeno de todas las tiendas. Cada cifra viene de un reporte, nunca del modelo."
            : "Pregunta por el estado de tu tienda. Cada cifra viene de un reporte, nunca del modelo."
        }
        title="Asistente"
      />

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest">
        {chat.messages.length === 0 ? (
          <div className="flex-1 overflow-y-auto py-6">
            <AssistantEmptyState
              disabled={limitReached || chat.isBusy}
              onPick={chat.ask}
              suggestions={isSuperadmin ? PLATFORM_SUGGESTIONS : STORE_SUGGESTIONS}
            />
          </div>
        ) : (
          <AssistantMessageList isBusy={chat.isBusy} messages={chat.messages} />
        )}

        {chat.errorMessage ? (
          <div
            className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            role="alert"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p className="flex-1">{chat.errorMessage}</p>
            <Button
              className="shrink-0"
              onClick={() => {
                chat.clearError();
                void chat.regenerate();
              }}
              size="sm"
              variant="secondary"
            >
              <RotateCcw aria-hidden className="size-4" />
              Reintentar
            </Button>
          </div>
        ) : null}

        <AssistantComposer
          disabled={limitReached}
          disabledReason="Alcanzaste el limite de consultas de hoy."
          inputRef={inputRef}
          isBusy={chat.isBusy}
          onSend={chat.ask}
          onStop={() => void chat.stop()}
        />
      </section>
    </div>
  );
}
