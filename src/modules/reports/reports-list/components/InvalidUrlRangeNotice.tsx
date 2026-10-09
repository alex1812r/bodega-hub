"use client";

import { X } from "lucide-react";
import { useState } from "react";

export const INVALID_URL_RANGE_MESSAGE =
  "El rango de la dirección no era válido; se muestra el rango por defecto.";

type InvalidUrlRangeNoticeProps = {
  /** La URL traía un rango que se descartó (`sanitizeUrlRange().wasInvalid`). */
  show: boolean;
};

/**
 * Aviso de una línea, descartable: la dirección traía un rango de fechas
 * invertido, fuera de rango o mal formado, y la pantalla muestra el de por
 * defecto. Desaparece solo en cuanto se elige otro rango (la URL se reescribe).
 */
export function InvalidUrlRangeNotice({ show }: InvalidUrlRangeNoticeProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!show || dismissed) {
    return null;
  }

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface"
      role="status"
    >
      <span>{INVALID_URL_RANGE_MESSAGE}</span>
      <button
        aria-label="Descartar aviso"
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
