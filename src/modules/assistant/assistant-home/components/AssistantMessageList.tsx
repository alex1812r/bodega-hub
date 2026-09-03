"use client";

import { useEffect, useRef } from "react";

import type { UIMessage } from "ai";

import {
  AssistantMessageBubble,
  type AssistantBubbleMessage,
} from "./AssistantMessageBubble";
import type { AssistantSource } from "./AssistantSourceBlock";

type ToolPart = {
  input?: unknown;
  output?: unknown;
  state?: string;
  type: string;
};

/** Aplana las `parts` del AI SDK a texto + fuentes por tool call. */
export function toBubbleMessages(messages: UIMessage[]): AssistantBubbleMessage[] {
  return messages
    .filter((message) => message.role === "assistant" || message.role === "user")
    .map((message) => {
      const sources: AssistantSource[] = [];
      let text = "";

      for (const part of message.parts as ToolPart[]) {
        if (part.type === "text") {
          text += (part as { text?: string }).text ?? "";
          continue;
        }

        if (part.type.startsWith("tool-")) {
          sources.push({
            input: part.input,
            output: part.output,
            state: part.state ?? "input-available",
            toolName: part.type.slice("tool-".length),
          });
        }
      }

      return {
        id: message.id,
        role: message.role as "assistant" | "user",
        sources,
        text: text.trim(),
      };
    });
}

export function AssistantMessageList({
  isBusy,
  messages,
}: {
  isBusy: boolean;
  messages: UIMessage[];
}) {
  const bubbles = toBubbleMessages(messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // jsdom no implementa scrollIntoView; el optional call mantiene los tests verdes.
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
      <ul aria-live="polite" className="mx-auto flex max-w-4xl flex-col gap-5" role="log">
        {bubbles.map((bubble, index) => (
          <AssistantMessageBubble
            key={bubble.id}
            message={bubble}
            pending={isBusy && index === bubbles.length - 1 && bubble.role === "assistant"}
          />
        ))}
      </ul>
      <div ref={bottomRef} />
    </div>
  );
}
