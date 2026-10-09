"use client";

import { History } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";

import {
  describeStoredPurchaseDraft,
  describeStoredPurchaseDraftContent,
  type StoredPurchaseDraft,
} from "../utils/purchaseDraftStorage";

type PurchaseDraftBannerProps = {
  /** El borrador guardado sobre el que aún no se decidió. */
  draft: StoredPurchaseDraft;
  isRestoring?: boolean;
  /**
   * La compra NUEVA guardada en la segunda ranura (COM-F10). Con ella el aviso pide
   * decidir: quedarse con una descarta la otra.
   */
  newDraft?: StoredPurchaseDraft | null;
  /**
   * `newDraft` es lo que hay ahora en el formulario (lo empezó esta visita). Si no, lo
   * dejó otra visita y el formulario está vacío: se ofrece restaurar cualquiera de las dos.
   */
  newDraftInForm?: boolean;
  /** Descartar lo guardado (las dos compras, si hay dos). */
  onDiscard: () => void;
  /** «Seguir con esta»: la compra nueva del formulario reemplaza a la guardada. */
  onKeepNew?: () => void;
  /** Restaurar la guardada (`draft`). */
  onRestore: () => void;
  /** Restaurar la nueva (`newDraft`) cuando no está en el formulario. */
  onRestoreNew?: () => void;
  /**
   * El formulario ya tiene contenido que no se guarda (una compra duplicada cuyas
   * líneas aún esperan proveedor): el aviso advierte que Restaurar lo sustituye.
   */
  replacesForm?: boolean;
  /** Aún no se puede restaurar (falta la tasa vigente). */
  restoreDisabled?: boolean;
};

/**
 * Aviso de borrador local pendiente al entrar a registrar una compra (COM-09). Tres formas:
 * - solo el guardado: Restaurar / Descartar;
 * - el usuario empezó una compra nueva sin decidir (COM-F10): «Restaurar el guardado» /
 *   «Seguir con esta», sin bloquear el formulario;
 * - tras recargar con las dos guardadas: restaurar una (descarta la otra) o descartar las dos.
 */
export function PurchaseDraftBanner({
  draft,
  isRestoring = false,
  newDraft = null,
  newDraftInForm = false,
  onDiscard,
  onKeepNew,
  onRestore,
  onRestoreNew,
  replacesForm = false,
  restoreDisabled = false,
}: PurchaseDraftBannerProps) {
  // La antigüedad se calcula una vez, al aparecer el aviso.
  const [shownAt] = useState(() => Date.now());
  const cannotRestore = isRestoring || restoreDisabled;
  const restoreLabel = isRestoring ? "Restaurando..." : null;

  return (
    <section
      aria-label="Compra sin terminar"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-3">
        <History aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        {newDraft && newDraftInForm ? (
          <p className="min-w-0 break-words text-sm font-medium text-foreground">
            Empezaste una compra nueva: al seguir se reemplaza el borrador guardado (
            {describeStoredPurchaseDraftContent(draft)})
          </p>
        ) : newDraft ? (
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-foreground">
              Tienes dos compras sin terminar
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm break-words text-on-surface-variant">
              <li>Guardada: {describeStoredPurchaseDraft(draft, shownAt)}</li>
              <li>Nueva: {describeStoredPurchaseDraft(newDraft, shownAt)}</li>
            </ul>
            <p className="mt-1 text-sm text-on-surface-variant">
              Al restaurar una se descarta la otra.
            </p>
          </div>
        ) : (
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
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {newDraft && newDraftInForm ? (
          <>
            <Button
              disabled={cannotRestore}
              onClick={onRestore}
              size="sm"
              type="button"
              variant="outline"
            >
              {restoreLabel ?? "Restaurar el guardado"}
            </Button>
            <Button disabled={isRestoring} onClick={onKeepNew} size="sm" type="button">
              Seguir con esta
            </Button>
          </>
        ) : newDraft ? (
          <>
            <Button disabled={cannotRestore} onClick={onRestore} size="sm" type="button">
              Restaurar la guardada
            </Button>
            <Button disabled={cannotRestore} onClick={onRestoreNew} size="sm" type="button">
              Restaurar la nueva
            </Button>
            <Button
              disabled={isRestoring}
              onClick={onDiscard}
              size="sm"
              type="button"
              variant="outline"
            >
              Descartar las dos
            </Button>
          </>
        ) : (
          <>
            <Button disabled={cannotRestore} onClick={onRestore} size="sm" type="button">
              {restoreLabel ?? "Restaurar"}
            </Button>
            <Button
              disabled={isRestoring}
              onClick={onDiscard}
              size="sm"
              type="button"
              variant="outline"
            >
              Descartar
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
