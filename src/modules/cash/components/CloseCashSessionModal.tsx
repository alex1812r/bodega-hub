"use client";

import { useEffect, useRef, useState } from "react";

import { useCashCloseTotals, useCloseCashSession } from "@/modules/cash/hooks/useCash";
import {
  computeCashCloseReview,
  type CashCloseDifference,
} from "@/modules/cash/utils/cashSessionTotals";
import { useCashCloseSettings } from "@/modules/settings/hooks/useSettings";
import { Button } from "@/shared/components/Button";
import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { ProcessGuardModal } from "@/shared/components/ProcessGuard";
import { useFormModalDiscardGuard } from "@/shared/hooks/useFormModalDiscardGuard";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";

type CloseCashSessionModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  openingRef: number;
  openingVes: number;
  registerName: string;
  sessionId: string;
};

type MoneyFormatter = (value: number) => string;

const FALLBACK_ERROR = "No se pudo cerrar la caja.";

const EMPTY_AMOUNTS = { ref: "", ves: "" };

function amountInputValue(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "";
  }
  return String(value);
}

/** Diferencia con signo y su lectura: «−Bs. 100,00 (falta)», «+Bs. 50,00 (sobra)», «Bs. 0,00». */
function differenceText(difference: CashCloseDifference, format: MoneyFormatter) {
  const amount = format(Math.abs(difference.amount));

  if (difference.kind === "shortage") {
    return `−${amount} (falta)`;
  }

  if (difference.kind === "surplus") {
    return `+${amount} (sobra)`;
  }

  return amount;
}

function differenceEffects(
  currency: string,
  difference: CashCloseDifference,
  format: MoneyFormatter,
): ConfirmActionEffect[] {
  return [
    { after: format(difference.counted), label: `Contado ${currency}` },
    { after: format(difference.theoretical), label: `Teórico ${currency}` },
    {
      after: differenceText(difference, format),
      label: `Diferencia ${currency}`,
      tone:
        difference.kind === "shortage"
          ? "danger"
          : difference.kind === "surplus"
            ? "warning"
            : "neutral",
    },
  ];
}

function MoneyPair({ refAmount, vesAmount }: { refAmount: number; vesAmount: number }) {
  return (
    <>
      <p className="font-semibold tabular-nums">{formatRefUsd(refAmount)}</p>
      <p className="text-sm text-on-surface-variant tabular-nums">{formatVesBs(vesAmount)}</p>
    </>
  );
}

/** Aún no hay cifra del servidor: no se enseña un 0 que no es un dato. */
function PendingAmount() {
  return <p className="font-semibold text-on-surface-variant">—</p>;
}

function DifferenceRow({
  difference,
  format,
  label,
}: {
  difference: CashCloseDifference;
  format: MoneyFormatter;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-sm text-on-surface-variant">{label}</dt>
      <dd
        className={cn(
          "font-semibold tabular-nums",
          difference.kind === "shortage" ? "text-error" : "text-foreground",
        )}
        data-difference={difference.kind}
      >
        {differenceText(difference, format)}
      </dd>
    </div>
  );
}

/**
 * Cierre de caja. Muestra la diferencia (contado − teórico) mientras se teclea
 * y, si hay un faltante que supera el umbral de la tienda
 * (`cashCloseDiffAlertVes`, por defecto 0), pide una confirmación explícita con
 * contado, teórico y diferencia antes de cerrar.
 *
 * - Faltante en REF: el umbral está en Bs, así que cualquier faltante en REF confirma.
 * - Sobrante: no confirma (no falta dinero y queda asentado en el cierre); se
 *   ve en la fila de diferencia como «(sobra)».
 * - Si el umbral no se pudo leer se usa 0: ante la duda, se confirma.
 *
 * Los totales (teórico, ventas, cuenta) los lee el propio modal del servidor en cada
 * apertura; no se reciben de quien lo abre, que podría tenerlos en caché de antes de
 * la última venta. Hasta que llega esa lectura no hay nada precargado ni se puede
 * cerrar («Actualizando…»); si falla, se dice y se ofrece reintentar. Así un 0 solo
 * aparece precargado cuando el servidor dice que el cajón está en 0.
 *
 * Lo contado se precarga con el teórico. Si el usuario cambia un monto, cerrar
 * (Esc, clic fuera, Cancelar, la X) o salir de la pantalla pregunta antes con
 * el guardia de proceso; con lo precargado sin tocar, o tras cerrar la caja,
 * cierra sin preguntar.
 */
export function CloseCashSessionModal({
  onOpenChange,
  open,
  openingRef,
  openingVes,
  registerName,
  sessionId,
}: CloseCashSessionModalProps) {
  const closeSession = useCloseCashSession();
  const closeTotals = useCashCloseTotals(sessionId, open);
  const cashCloseSettings = useCashCloseSettings();
  const [closingVes, setClosingVes] = useState("");
  const [closingRef, setClosingRef] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Montos precargados al abrir: lo precargado no cuenta como tecleado. */
  const [initialAmounts, setInitialAmounts] = useState(EMPTY_AMOUNTS);
  const didPrefillRef = useRef(false);
  /** Ya llegó la lectura de esta apertura: hay totales que enseñar y montos precargados. */
  const [prefilled, setPrefilled] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // Cerrado desde fuera (sin pasar por `resetForm`): la próxima apertura parte sin totales.
  if (wasOpen !== open) {
    setWasOpen(open);

    if (!open) {
      setPrefilled(false);
    }
  }
  // Un doble clic llega antes de que `isPending` deshabilite el botón.
  const inFlightRef = useRef(false);

  const totals = prefilled ? closeTotals.totals : null;
  const theoreticalRef = totals?.theoretical.ref ?? 0;
  const theoreticalVes = totals?.theoretical.ves ?? 0;
  // Sin la lectura de esta apertura, o con otra en curso o fallida, no se cierra a ciegas.
  const canClose = totals !== null && closeTotals.status === "ready";
  const freshTotals = closeTotals.status === "ready" ? closeTotals.totals : null;
  const salesCashRef = roundMoney(theoreticalRef - openingRef);
  const salesCashVes = roundMoney(theoreticalVes - openingVes);

  const countedVes = Number(closingVes || 0);
  const countedRef = Number(closingRef || 0);
  const review = computeCashCloseReview({
    alertVes: cashCloseSettings.data?.cashCloseDiffAlertVes ?? 0,
    countedRef,
    countedVes,
    theoreticalRef,
    theoreticalVes,
  });
  const hasTypedData = closingVes !== initialAmounts.ves || closingRef !== initialAmounts.ref;
  // Con el cierre en vuelo no se pregunta: el cierre del modal ya está bloqueado.
  const { guard, requestClose, trackFocus } = useFormModalDiscardGuard({
    active: open && hasTypedData && !closeSession.isPending,
    label: `Cierre de caja «${registerName}» sin terminar`,
  });

  useEffect(() => {
    if (!open) {
      didPrefillRef.current = false;
      return;
    }

    if (didPrefillRef.current || !freshTotals) {
      return;
    }

    didPrefillRef.current = true;
    setPrefilled(true);
    setClosingVes(amountInputValue(freshTotals.theoretical.ves));
    setClosingRef(amountInputValue(freshTotals.theoretical.ref));
    setInitialAmounts({
      ref: amountInputValue(freshTotals.theoretical.ref),
      ves: amountInputValue(freshTotals.theoretical.ves),
    });
  }, [open, freshTotals]);

  function resetForm() {
    setClosingVes("");
    setClosingRef("");
    setInitialAmounts(EMPTY_AMOUNTS);
    setErrorMessage(null);
    setConfirmOpen(false);
    didPrefillRef.current = false;
    setPrefilled(false);
  }

  /** Cierra con lo tecleado. Si el servidor rechaza, lo dice tal cual y no borra nada. */
  async function closeWithCountedAmounts() {
    if (inFlightRef.current || !canClose) {
      return;
    }

    inFlightRef.current = true;

    try {
      setErrorMessage(null);
      await closeSession.mutateAsync({
        closingRef: countedRef,
        closingVes: countedVes,
        sessionId,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : FALLBACK_ERROR);
      return;
    } finally {
      inFlightRef.current = false;
    }

    resetForm();
    onOpenChange(false);
  }

  function handleSubmit() {
    if (closeSession.isPending || inFlightRef.current || !canClose) {
      return;
    }

    if (countedVes < 0 || countedRef < 0) {
      setErrorMessage("Los montos de cierre no pueden ser negativos.");
      return;
    }

    if (review.needsConfirmation) {
      // Un error de un intento anterior no pertenece a esta confirmación.
      setErrorMessage(null);
      setConfirmOpen(true);
      return;
    }

    void closeWithCountedAmounts();
  }

  const shortageParts = [
    review.vesShortageOverThreshold ? formatVesBs(Math.abs(review.ves.amount)) : null,
    review.refShortageOverThreshold ? formatRefUsd(Math.abs(review.ref.amount)) : null,
  ].filter((part) => part !== null);
  // El teórico puede moverse con la confirmación abierta (entra un cobro): el texto sigue a las cifras.
  const confirmDescription =
    shortageParts.length > 0
      ? `Vas a cerrar con ${shortageParts.join(" y ")} de faltante. ¿Continuar?`
      : "La diferencia cambió y ya no hay faltante que confirmar. ¿Cerrar la caja con estos montos?";

  return (
    <Modal
      description={`Cuenta TODO el efectivo físico en ${registerName}: fondo de apertura + efectivo de ventas. El pago móvil no se cuenta aquí.`}
      footer={({ close }) => (
        <>
          <Button
            disabled={closeSession.isPending}
            onClick={close}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button
            disabled={closeSession.isPending || !canClose}
            onClick={handleSubmit}
            type="button"
          >
            {closeSession.isPending ? "Cerrando..." : "Cerrar caja"}
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        // Con el cierre en vuelo el modal no se cierra: su resultado llegaría sin formulario.
        if (!nextOpen && (closeSession.isPending || inFlightRef.current)) {
          return;
        }

        if (nextOpen) {
          onOpenChange(true);
          return;
        }

        // Con un monto cambiado pregunta antes de descartarlo.
        requestClose(() => {
          resetForm();
          onOpenChange(false);
        });
      }}
      open={open}
      title="Cerrar caja"
    >
      <div className="grid gap-3" onFocus={trackFocus}>
        <div className="grid gap-3 rounded-lg border border-border bg-surface-container/40 p-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              1. Fondo de apertura
            </p>
            <MoneyPair refAmount={openingRef} vesAmount={openingVes} />
            <p className="mt-1 text-xs text-on-surface-variant">
              Efectivo con el que se abrió la caja
            </p>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              2. Efectivo de ventas (turno)
            </p>
            {totals ? (
              <MoneyPair refAmount={salesCashRef} vesAmount={salesCashVes} />
            ) : (
              <PendingAmount />
            )}
            <p className="mt-1 text-xs text-on-surface-variant">
              Solo efectivo Bs/USD. Sin pago móvil
            </p>
          </div>
          <div className="sm:col-span-2 rounded-md border border-border bg-background/60 p-3">
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              3. Debes contar en el cajón (apertura + ventas)
            </p>
            {totals ? (
              <MoneyPair refAmount={theoreticalRef} vesAmount={theoreticalVes} />
            ) : (
              <PendingAmount />
            )}
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              Cuenta Bs. del turno (pago móvil / transferencia / punto)
            </p>
            {totals ? (
              <p className="font-semibold tabular-nums text-emerald-700">
                {formatVesBs(totals.accountVes)}
              </p>
            ) : (
              <PendingAmount />
            )}
            <p className="text-xs text-on-surface-variant">
              No entra al cajón ni al cierre físico
            </p>
          </div>
        </div>

        {closeTotals.status === "error" ? (
          <div className="grid justify-items-start gap-2" role="alert">
            <p className="text-sm text-destructive">
              {closeTotals.errorMessage} No se puede cerrar la caja sin sus totales al día.
            </p>
            <Button onClick={closeTotals.retry} size="sm" type="button" variant="outline">
              Reintentar
            </Button>
          </div>
        ) : closeTotals.status === "loading" ? (
          <p className="text-sm text-on-surface-variant" role="status">
            Actualizando los totales de la caja…
          </p>
        ) : null}

        <p className="text-sm text-on-surface-variant">
          Indica lo que realmente hay en efectivo. Por defecto se prellena con el total del cajón
          (paso 3), no solo con las ventas del día.
        </p>

        <NumberInput
          decimals={2}
          disabled={!totals}
          label="Efectivo contado Bs. (cajón completo)"
          onChange={(event) => setClosingVes(event.target.value)}
          value={closingVes}
        />
        <NumberInput
          decimals={2}
          disabled={!totals}
          label="Efectivo contado REF (cajón completo)"
          onChange={(event) => setClosingRef(event.target.value)}
          value={closingRef}
        />

        {totals ? (
          <dl
            aria-label="Diferencia entre lo contado y lo que debe haber"
            className="grid gap-1 rounded-md border border-border bg-background/60 p-3"
          >
            <DifferenceRow difference={review.ves} format={formatVesBs} label="Diferencia Bs." />
            <DifferenceRow difference={review.ref} format={formatRefUsd} label="Diferencia REF" />
          </dl>
        ) : null}

        {/* Con la confirmación abierta el error se dice en ella; al cancelarla sigue a la vista aquí. */}
        {errorMessage && !confirmOpen ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <ConfirmActionModal
        confirmLabel="Cerrar con faltante"
        description={confirmDescription}
        effects={[
          ...differenceEffects("Bs.", review.ves, formatVesBs),
          ...differenceEffects("REF", review.ref, formatRefUsd),
        ]}
        error={errorMessage}
        isPending={closeSession.isPending}
        onConfirm={closeWithCountedAmounts}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setConfirmOpen(false);
          }
        }}
        // La pregunta del guardia (ATRÁS del navegador) no se apila sobre la confirmación.
        open={confirmOpen && !guard.dialog.open}
        title="Cerrar caja con faltante"
        variant="danger"
      >
        <p>
          {registerName}: la diferencia queda registrada en el cierre y al baúl solo podrá
          transferirse lo contado.
        </p>
      </ConfirmActionModal>
      <ProcessGuardModal guard={guard} />
    </Modal>
  );
}
