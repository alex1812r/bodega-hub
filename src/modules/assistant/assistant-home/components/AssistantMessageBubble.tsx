"use client";

import { Bot, User } from "lucide-react";

import { cn } from "@/shared/utils/cn";

import { AssistantSourceBlock, type AssistantSource } from "./AssistantSourceBlock";

export type AssistantBubbleMessage = {
  id: string;
  role: "assistant" | "user";
  sources: AssistantSource[];
  text: string;
};

export function AssistantMessageBubble({
  message,
  pending = false,
}: {
  message: AssistantBubbleMessage;
  pending?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <li className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <span
        aria-hidden
        className={cn(
          "mt-1 flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-surface-container text-slate-600 dark:text-slate-300",
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </span>

      <div className={cn("min-w-0 max-w-[min(46rem,85%)]", isUser && "text-right")}>
        <span className="sr-only">{isUser ? "Tu pregunta:" : "Respuesta del asistente:"}</span>
        <div
          className={cn(
            "inline-block w-full rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap break-words",
            isUser
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-surface-container-lowest text-foreground",
          )}
        >
          {message.text || (pending ? "Consultando los datos…" : "")}
          {pending && message.text ? (
            <span aria-hidden className="ml-1 inline-block animate-pulse">
              ▋
            </span>
          ) : null}
        </div>

        {message.sources.length > 0 ? (
          <div className="text-left">
            {message.sources.map((source, index) => (
              <AssistantSourceBlock key={`${source.toolName}-${index}`} source={source} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
