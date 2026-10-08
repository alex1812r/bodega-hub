"use client";

import { History } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";

import {
  describeStoredPurchaseDraft,
  type StoredPurchaseDraft,
} from "../utils/purchaseDraftStorage";

type PurchaseDraftBannerProps = {
  draft: StoredPurchaseDraft;
  isRestoring?: boolean;
  onDiscard: () => void;
  onRestore: () => void;
  /**
   * El formulario ya tiene contenido (una compra duplicada, líneas agregadas):
   * el aviso advierte que Restaurar lo sustituye.
   */
  replacesForm?: boolean;
  /** Aún no se puede restaurar (falta la tasa vigente). */
  restoreDisabled?: boolean;
};

/** Aviso de borrador local pendiente al entrar a registrar una compra (COM-09). */
export function PurchaseDraftBanner({
  draft,
  isRestoring = false,
  onDiscard,
  onRestore,
  replacesForm = false,
  restoreDisabled = false,
}: PurchaseDraftBannerProps) {
  // La antigüedad se calcula una vez, al aparecer el aviso.
  const [shownAt] = useState(() => Date.now());

  return (
    <section
      aria-label="Compra sin terminar"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-3">
        <History aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-foreground">
            Tienes una compra sin terminar ({describeStoredPurchaseDraft(draft, shownAt)})
          </p>
          {replacesForm ? (
            <p className="mt-1 text-sm text-on-surface-variant">
              Restaurar sustituye lo que hay ahora en el formulario.
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          disabled={isRestoring || restoreDisabled}
          onClick={onRestore}
          size="sm"
          type="button"
        >
          {isRestoring ? "Restaurando..." : "Restaurar"}
        </Button>
        <Button disabled={isRestoring} onClick={onDiscard} size="sm" type="button" variant="outline">
          Descartar
        </Button>
      </div>
    </section>
  );
}
