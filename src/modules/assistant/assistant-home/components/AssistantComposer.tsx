"use client";

import { Send, Square } from "lucide-react";
import { useState, type KeyboardEvent, type RefObject } from "react";

import { Button } from "@/shared/components/Button";

export function AssistantComposer({
  disabled,
  disabledReason,
  inputRef,
  isBusy,
  onSend,
  onStop,
}: {
  disabled: boolean;
  disabledReason?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  isBusy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const canSend = !disabled && !isBusy && value.trim().length > 0;

  const send = () => {
    if (!canSend) {
      return;
    }

    onSend(value);
    setValue("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-border bg-surface-container-lowest p-3"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label className="sr-only" htmlFor="assistant-composer">
        Escribe tu pregunta
      </label>
      <textarea
        className="max-h-40 min-h-11 flex-1 resize-none rounded-lg border border-border bg-surface-container-lowest px-3 py-2.5 text-sm text-foreground placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        id="assistant-composer"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? disabledReason : "Pregunta por tus datos…"}
        ref={inputRef}
        rows={1}
        value={value}
      />

      {isBusy ? (
        <Button aria-label="Detener respuesta" onClick={onStop} type="button" variant="secondary">
          <Square aria-hidden className="size-4" />
          Detener
        </Button>
      ) : (
        <Button aria-label="Enviar pregunta" disabled={!canSend} type="submit">
          <Send aria-hidden className="size-4" />
          Enviar
        </Button>
      )}
    </form>
  );
}
