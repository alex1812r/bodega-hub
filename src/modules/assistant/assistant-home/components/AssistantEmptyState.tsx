"use client";

import { Sparkles } from "lucide-react";

import { EmptyState } from "@/shared/components/EmptyState";

export const STORE_SUGGESTIONS = [
  "¿Cuánto se ha vendido desde ayer?",
  "¿Cuál es el producto más vendido?",
  "¿Cuál es la ganancia de estos meses?",
  "¿Cuál es el capital actual?",
  "¿Qué productos hay que reponer?",
  "¿Quién es el mejor cliente?",
];

export const PLATFORM_SUGGESTIONS = [
  "¿Cuál es la tienda con más ventas este mes?",
  "¿Cuántas tiendas hay activas?",
  "Compara BodegaHub con Bodega Sur",
  "¿Qué tienda tiene más capital?",
  "Ganancia total de todas las tiendas este mes",
  "Ranking de tiendas por ventas de la semana pasada",
];

export function AssistantEmptyState({
  disabled = false,
  onPick,
  suggestions,
}: {
  disabled?: boolean;
  onPick: (question: string) => void;
  suggestions: string[];
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <EmptyState
        description="Pregunta en lenguaje natural por ventas, ganancia, productos, clientes, compras, stock, caja/baúl y capital. Cada respuesta muestra la fuente de sus cifras."
        icon={<Sparkles aria-hidden className="size-5" />}
        title="Pregúntale a tus datos"
      />
      <ul className="mt-2 flex max-w-2xl flex-wrap justify-center gap-2 px-4">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              className="cursor-pointer rounded-full border border-border bg-surface-container-lowest px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
              disabled={disabled}
              onClick={() => onPick(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
