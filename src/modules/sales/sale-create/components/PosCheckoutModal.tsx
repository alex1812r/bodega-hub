"use client";

import { Calculator, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { SelectField } from "@/shared/components/SelectField";
import { VenezuelanBankField } from "@/shared/components/VenezuelanBankField";
import { VenezuelanPhoneField } from "@/shared/components/VenezuelanPhoneField";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";
import { formatRef, formatVes, roundMoney } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import {
  formatDenominationBreakdown,
  getBillsForCurrency,
  maxDeliverableChange,
  minimumTenderAtLeast,
  suggestQuickTenders,
  sumDenominations,
  type DenominationCounts,
} from "../utils/denominations";
import {
  MIXED_PAYMENT_TOLERANCE_VES,
  amountToCoverRemainingVes,
  changeAmountForOverage,
  createCheckoutForMethod,
  createEmptyMixedPaymentLine,
  getAllocatedRef,
  getAllocatedVes,
  getAvailablePaymentMethods,
  getChangeMethodOptions,
  getChangeVes,
  getDefaultChangeMethod,
  getMaxMixedPaymentLines,
  getPaymentCurrency,
  getRemainingVes,
  getSaleTotalVes,
  getTenderOverageVes,
  isCashPaymentMethod,
  isUsdPaymentMethod,
  needsBank,
  needsPhone,
  needsReference,
  pickChangeCarrierLineId,
  validateCheckout,
  type PosChangeDeclaration,
  type PosCheckout,
  type PosMixedPaymentLine,
} from "../utils/mixedPayments";
import { PosBillPad } from "./PosBillPad";

type ChangeDraft = {
  amount: number;
  counts: DenominationCounts;
};

function formatMethodAmount(method: PaymentMethod, amount: number) {
  return isUsdPaymentMethod(method) ? formatRef(amount) : formatVes(amount);
}

/** Vuelto sugerido: el máximo que se puede armar con billetes reales. */
function suggestChange(
  method: PaymentMethod,
  overageVes: number,
  rateVes: number,
): ChangeDraft {
  const amount = changeAmountForOverage(method, overageVes, rateVes);

  if (!isCashPaymentMethod(method)) {
    return { amount, counts: {} };
  }

  const deliverable = maxDeliverableChange(
    amount,
    getBillsForCurrency(getPaymentCurrency(method)),
  );

  return { amount: deliverable.delivered, counts: deliverable.counts };
}

// El efectivo arranca vacío para que el cajero indique lo recibido; los
// métodos bancarios se prellenan con el total, que sí se cobra exacto.
function createLinesForMethod(
  method: PaymentMethod,
  totalRef: number,
  rateVes: number,
) {
  return isCashPaymentMethod(method)
    ? [createEmptyMixedPaymentLine(method)]
    : createCheckoutForMethod(method, totalRef, rateVes).lines;
}

function hasCountedBills(line: PosMixedPaymentLine | undefined) {
  return Object.values(line?.denominations ?? {}).some((count) => (count ?? 0) > 0);
}

function hasPaymentDetails(line: PosMixedPaymentLine | undefined) {
  return Boolean(
    line?.bankName?.trim() || line?.phone?.trim() || line?.referenceCode?.trim(),
  );
}

/**
 * Datos que el método exige y que el modo compacto pide al pulsar «Cobrar»;
 * `null` si el método no exige ninguno.
 */
function describeRequiredDetails(method: PaymentMethod) {
  const names = [
    needsBank(method) ? "banco" : null,
    needsPhone(method) ? "teléfono" : null,
    needsReference(method) ? "referencia" : null,
  ].filter((name): name is string => name != null);

  if (names.length === 0) {
    return null;
  }

  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;

  return `Al cobrar ${names.length === 1 ? "se pide" : "se piden"} ${list}.`;
}

function createInitialLines(
  initialCheckout: PosCheckout | null | undefined,
  firstMethod: PaymentMethod | null,
  totalRef: number,
  rateVes: number,
) {
  if (initialCheckout && initialCheckout.lines.length > 0) {
    return initialCheckout.lines.map((line) => ({ ...line }));
  }

  if (!firstMethod) {
    return [];
  }

  return createLinesForMethod(firstMethod, totalRef, rateVes);
}

function createInitialChangeDraft(
  initialCheckout: PosCheckout | null | undefined,
): ChangeDraft | null {
  if (!initialCheckout?.change) {
    return null;
  }

  return {
    amount: initialCheckout.change.amount,
    counts: initialCheckout.change.denominations ?? {},
  };
}

type PosCheckoutModalProps = {
  /** Metodo preseleccionado en el carrito (camino feliz: pago exacto). */
  defaultMethod?: PaymentMethod | null;
  /** Bs. en la gaveta: decide si el vuelto arranca en efectivo o pago movil. */
  drawerRef?: number;
  drawerVes?: number;
  enabledPaymentMethods?: readonly PaymentMethod[];
  initialCheckout?: PosCheckout | null;
  onConfirm: (checkout: PosCheckout) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  rateVes: number;
  totalRef: number;
};

export function PosCheckoutModal({
  defaultMethod = null,
  drawerRef = 0,
  drawerVes = 0,
  enabledPaymentMethods = DEFAULT_ENABLED_PAYMENT_METHODS,
  initialCheckout,
  onConfirm,
  onOpenChange,
  open,
  rateVes,
  totalRef,
}: PosCheckoutModalProps) {
  const formId = useId();
  const enabled = useMemo(
    () => filterEnabledPaymentMethods(enabledPaymentMethods),
    [enabledPaymentMethods],
  );
  const maxLines = getMaxMixedPaymentLines(enabled.length);
  const changeOptions = useMemo(
    () => getChangeMethodOptions(enabledPaymentMethods),
    [enabledPaymentMethods],
  );
  const firstMethod = useMemo(() => {
    if (defaultMethod && enabled.includes(defaultMethod)) {
      return defaultMethod;
    }
    return enabled[0] ?? null;
  }, [defaultMethod, enabled]);

  // El carrito remonta el modal con `key` en cada apertura: el estado arranca
  // del cobro guardado sin efectos de sincronizacion.
  const [lines, setLines] = useState<PosMixedPaymentLine[]>(() =>
    createInitialLines(initialCheckout, firstMethod, totalRef, rateVes),
  );
  const [changeMethod, setChangeMethod] = useState<PaymentMethod | null>(
    () => initialCheckout?.change?.method ?? null,
  );
  const [changeDraft, setChangeDraft] = useState<ChangeDraft | null>(() =>
    createInitialChangeDraft(initialCheckout),
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);
  // Modo compacto (método + monto): solo cabe un pago. Si el cobro guardado ya
  // trae varios pagos o billetes contados arranca expandido para no esconderlos.
  const [isExpandedByUser, setIsExpandedByUser] = useState(
    () => lines.length !== 1 || hasCountedBills(lines[0]),
  );
  const [detailsRevealed, setDetailsRevealed] = useState(() =>
    hasPaymentDetails(lines[0]),
  );
  const canCompact = lines.length === 1;
  const isCompact = canCompact && !isExpandedByUser;
  const amountInputRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const focusDetailsOnRevealRef = useRef(false);
  // En compacto con efectivo el cajero empieza escribiendo lo recibido.
  const [focusAmountOnOpen] = useState(
    () => isCompact && isCashPaymentMethod(lines[0].method) && !lines[0].amount,
  );

  useEffect(() => {
    if (!open || !focusAmountOnOpen) {
      return;
    }

    // Se difiere: el diálogo mueve el foco al montar su contenido.
    const frame = requestAnimationFrame(() => amountInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusAmountOnOpen, open]);

  useEffect(() => {
    if (!detailsRevealed || !focusDetailsOnRevealRef.current) {
      return;
    }

    focusDetailsOnRevealRef.current = false;

    // Tras el primer «Cobrar» el cajero sigue en el primer dato que falta.
    const inputs = Array.from(detailsRef.current?.querySelectorAll("input") ?? []);
    (inputs.find((input) => input.value.trim() === "") ?? inputs[0])?.focus();
  }, [detailsRevealed]);

  const totalVes = getSaleTotalVes(totalRef, rateVes);
  const allocatedRef = getAllocatedRef(lines, rateVes);
  const allocatedVes = getAllocatedVes(lines, rateVes);
  const remainingVes = getRemainingVes(totalRef, lines, rateVes);
  const overageVes = getTenderOverageVes(totalRef, lines, rateVes);
  const hasOverage = overageVes > MIXED_PAYMENT_TOLERANCE_VES;

  const effectiveChangeMethod = useMemo(() => {
    if (!hasOverage) {
      return null;
    }

    if (changeMethod && changeOptions.includes(changeMethod)) {
      return changeMethod;
    }

    return getDefaultChangeMethod(enabledPaymentMethods, drawerVes, overageVes);
  }, [changeMethod, changeOptions, drawerVes, enabledPaymentMethods, hasOverage, overageVes]);

  const suggestedChange = useMemo(
    () =>
      effectiveChangeMethod
        ? suggestChange(effectiveChangeMethod, overageVes, rateVes)
        : null,
    [effectiveChangeMethod, overageVes, rateVes],
  );

  const changeAmount = changeDraft?.amount ?? suggestedChange?.amount ?? 0;
  const changeCounts = useMemo<DenominationCounts>(
    () => changeDraft?.counts ?? suggestedChange?.counts ?? {},
    [changeDraft, suggestedChange],
  );

  const change = useMemo<PosChangeDeclaration | null>(() => {
    if (!effectiveChangeMethod || changeAmount <= 0) {
      return null;
    }

    return {
      amount: changeAmount,
      denominations: isCashPaymentMethod(effectiveChangeMethod) ? changeCounts : null,
      method: effectiveChangeMethod,
    };
  }, [changeAmount, changeCounts, effectiveChangeMethod]);

  const changeVes = getChangeVes(change, rateVes);
  const roundingVes = hasOverage ? roundMoney(overageVes - changeVes) : 0;

  const checkout = useMemo<PosCheckout>(
    () => ({
      change,
      changeCarrierLineId: pickChangeCarrierLineId(lines, rateVes, changeVes),
      lines,
    }),
    [change, changeVes, lines, rateVes],
  );

  const validation = useMemo(
    () =>
      validateCheckout(totalRef, checkout, rateVes, enabledPaymentMethods, {
        ref: drawerRef,
        ves: drawerVes,
      }),
    [checkout, drawerRef, drawerVes, enabledPaymentMethods, rateVes, totalRef],
  );

  function updateLine(id: string, patch: Partial<PosMixedPaymentLine>) {
    setChangeDraft(null);
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(id: string) {
    setChangeDraft(null);
    setLines((current) => current.filter((line) => line.id !== id));
  }

  function addLine(method: PaymentMethod) {
    setChangeDraft(null);
    setLines((current) => [...current, createEmptyMixedPaymentLine(method)]);
  }

  function changeSingleMethod(method: PaymentMethod) {
    setChangeDraft(null);
    setDetailsRevealed(false);
    setLines(createLinesForMethod(method, totalRef, rateVes));
  }

  function handleConfirm() {
    // En compacto el primer «Cobrar» de un método con datos obligatorios solo
    // los pide: todavía no es un envío, así que no valida ni pinta errores.
    if (
      isCompact &&
      !detailsRevealed &&
      describeRequiredDetails(lines[0].method) != null
    ) {
      focusDetailsOnRevealRef.current = true;
      setDetailsRevealed(true);
      return;
    }

    setHasSubmitted(true);

    if (!validation.isValid) {
      return;
    }

    onConfirm(checkout);
    onOpenChange(false);
  }

  const availableMethods = getAvailablePaymentMethods(
    lines,
    undefined,
    enabledPaymentMethods,
  );
  const changeCurrency = effectiveChangeMethod
    ? getPaymentCurrency(effectiveChangeMethod)
    : "VES";

  return (
    <Modal
      contentClassName="sm:max-w-2xl"
      description={
        isCompact
          ? "Elige el método e indica el monto recibido."
          : "Cuenta los billetes que entrega el cliente y declara el vuelto."
      }
      footer={({ close }) => (
        <FormActions
          onCancel={close}
          submitFormId={formId}
          submitLabel="Cobrar"
        />
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Cobrar"
    >
      <form
        className="space-y-4"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          handleConfirm();
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-surface-container-low px-3 py-2 dark:border-slate-700">
          <p className="text-sm font-medium text-foreground">Total</p>
          <div className="text-right">
            <p className="text-lg font-semibold text-foreground">{formatRef(totalRef)}</p>
            {rateVes > 0 ? (
              <p className="text-xs text-muted-foreground">{formatVes(totalVes)}</p>
            ) : null}
          </div>
        </div>

        {canCompact ? (
          <div className="flex justify-end">
            <Button
              aria-expanded={!isCompact}
              onClick={() => setIsExpandedByUser((current) => !current)}
              size="sm"
              variant="ghost"
            >
              {isCompact ? (
                <ChevronDown aria-hidden className="size-4" />
              ) : (
                <ChevronUp aria-hidden className="size-4" />
              )}
              {isCompact ? "Expandir" : "Compactar"}
            </Button>
          </div>
        ) : null}

        <section className="space-y-3">
          {isCompact ? null : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Recibido
              </h3>
              {lines.length < maxLines ? (
                <div className="flex flex-wrap gap-1.5">
                  {availableMethods.map((method) => (
                    <button
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-surface-container-lowest px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-container-low dark:border-slate-700"
                      key={method}
                      onClick={() => addLine(method)}
                      type="button"
                    >
                      <Plus aria-hidden className="size-3.5" />
                      {paymentMethodLabels[method]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground dark:border-slate-700">
              Agrega un método de pago para empezar el cobro.
            </p>
          ) : null}

          {lines.map((line, index) => {
            const currency = getPaymentCurrency(line.method);
            const bills = getBillsForCurrency(currency);
            const isCash = isCashPaymentMethod(line.method);
            const lineRemainingVes = getRemainingVes(totalRef, lines, rateVes, line.id);
            const targetAmount = amountToCoverRemainingVes(
              line.method,
              lineRemainingVes,
              rateVes,
            );
            const quickTenders = isCash ? suggestQuickTenders(targetAmount, bills) : [];
            const isExactlyCovered =
              remainingVes <= MIXED_PAYMENT_TOLERANCE_VES && !hasOverage;
            const showDetails = !isCompact || detailsRevealed;
            const requiredDetails = showDetails
              ? null
              : describeRequiredDetails(line.method);

            return (
              <div
                className={cn(
                  "space-y-3",
                  !isCompact && "rounded-xl border border-border p-3 dark:border-slate-700",
                )}
                key={line.id}
              >
                {isCompact ? (
                  <SelectField
                    label="Método de pago"
                    onChange={(event) => {
                      const method = enabled.find(
                        (option) => option === event.target.value,
                      );

                      if (method) {
                        changeSingleMethod(method);
                      }
                    }}
                    options={enabled.map((method) => ({
                      label: paymentMethodLabels[method],
                      value: method,
                    }))}
                    value={line.method}
                  />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {paymentMethodLabels[line.method]}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {formatMethodAmount(line.method, line.amount)}
                      </span>
                      {lines.length > 1 ? (
                        <button
                          aria-label={`Quitar ${paymentMethodLabels[line.method]}`}
                          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-surface-container hover:text-destructive"
                          onClick={() => removeLine(line.id)}
                          type="button"
                        >
                          <X aria-hidden className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}

                {isCash ? (
                  <>
                    {!isCompact || hasOverage ? (
                      <PosBillPad
                        autoFocus={index === 0 && !isCompact && !focusAmountOnOpen}
                        counts={line.denominations ?? {}}
                        currency={currency}
                        onChange={(counts) =>
                          updateLine(line.id, {
                            amount: sumDenominations(counts, bills),
                            denominations: counts,
                          })
                        }
                      />
                    ) : null}

                    {quickTenders.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Rápidos</span>
                        {quickTenders.map((tender) => (
                          <button
                            className="cursor-pointer rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
                            key={tender}
                            onClick={() =>
                              updateLine(line.id, {
                                amount: tender,
                                denominations: minimumTenderAtLeast(tender, bills).counts,
                              })
                            }
                            type="button"
                          >
                            {formatMethodAmount(line.method, tender)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}

                <NumberInput
                  decimals={2}
                  helperText={
                    isCash
                      ? isCompact
                        ? `Restante: ${formatMethodAmount(line.method, targetAmount)}`
                        : "Escribe el monto si prefieres no contar billetes."
                      : `Restante: ${formatVes(lineRemainingVes)}`
                  }
                  label="Monto"
                  onChange={(event) =>
                    updateLine(line.id, {
                      amount: Number(event.target.value) || 0,
                      denominations: null,
                    })
                  }
                  ref={index === 0 ? amountInputRef : undefined}
                  trailing={
                    isCompact && isExactlyCovered ? undefined : (
                      <button
                        aria-label="Completar restante"
                        className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={
                          rateVes <= 0 || lineRemainingVes <= MIXED_PAYMENT_TOLERANCE_VES
                        }
                        onClick={() =>
                          updateLine(line.id, {
                            amount: targetAmount,
                            denominations: null,
                          })
                        }
                        title="Completar restante"
                        type="button"
                      >
                        <Calculator aria-hidden className="size-4" />
                      </button>
                    )
                  }
                  value={line.amount || ""}
                />

                {requiredDetails ? (
                  <p className="text-xs text-muted-foreground">{requiredDetails}</p>
                ) : null}

                {showDetails && describeRequiredDetails(line.method) != null ? (
                  <div className="space-y-3" ref={isCompact ? detailsRef : undefined}>
                    {needsBank(line.method) ? (
                      <VenezuelanBankField
                        onChange={(bankName) => updateLine(line.id, { bankName })}
                        value={line.bankName ?? ""}
                      />
                    ) : null}

                    {needsPhone(line.method) || needsReference(line.method) ? (
                      <div
                        className={cn(
                          "grid gap-3",
                          needsPhone(line.method) && needsReference(line.method)
                            ? "sm:grid-cols-2"
                            : "grid-cols-1",
                        )}
                      >
                        {needsPhone(line.method) ? (
                          <VenezuelanPhoneField
                            onChange={(phone) => updateLine(line.id, { phone })}
                            value={line.phone ?? ""}
                          />
                        ) : null}

                        {needsReference(line.method) ? (
                          <Input
                            helperText={
                              line.method === "pago_movil"
                                ? "Últimos 4 dígitos de la referencia."
                                : undefined
                            }
                            label="Referencia"
                            onChange={(event) =>
                              updateLine(line.id, { referenceCode: event.target.value })
                            }
                            value={line.referenceCode ?? ""}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        {isCompact && !hasOverage ? null : (
          <dl className="space-y-1 rounded-lg border border-border bg-surface-container-low px-3 py-2 text-sm dark:border-slate-700">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Recibido</dt>
              <dd className="font-medium text-foreground">
                {formatRef(allocatedRef)}
                {rateVes > 0 ? ` · ${formatVes(allocatedVes)}` : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Falta</dt>
              <dd
                className={cn(
                  "font-medium",
                  remainingVes > MIXED_PAYMENT_TOLERANCE_VES
                    ? "text-destructive"
                    : "text-foreground",
                )}
              >
                {remainingVes > MIXED_PAYMENT_TOLERANCE_VES ? formatVes(remainingVes) : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-semibold text-foreground">Vuelto</dt>
              <dd className="text-right font-semibold text-foreground">
                {hasOverage ? formatVes(overageVes) : "—"}
                {hasOverage && rateVes > 0 ? (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({formatRef(overageVes / rateVes)})
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        )}

        {hasOverage && effectiveChangeMethod ? (
          <fieldset className="space-y-3 rounded-xl border border-border p-3 dark:border-slate-700">
            <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Vuelto en
            </legend>

            <div className="flex flex-wrap gap-2">
              {changeOptions.map((method) => {
                const isActive = method === effectiveChangeMethod;

                return (
                  <button
                    aria-pressed={isActive}
                    className={cn(
                      "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface-container-lowest text-foreground hover:bg-surface-container-low dark:border-slate-700",
                    )}
                    key={method}
                    onClick={() => {
                      setChangeMethod(method);
                      setChangeDraft(null);
                    }}
                    type="button"
                  >
                    {paymentMethodLabels[method]}
                  </button>
                );
              })}
            </div>

            {isCashPaymentMethod(effectiveChangeMethod) ? (
              <>
                {suggestedChange && suggestedChange.amount > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sugerido:{" "}
                    {formatDenominationBreakdown(
                      suggestedChange.counts,
                      getBillsForCurrency(changeCurrency),
                    )}{" "}
                    = {formatMethodAmount(effectiveChangeMethod, suggestedChange.amount)}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    El vuelto es menor al billete más chico: cambia el método o el
                    recibido.
                  </p>
                )}

                <PosBillPad
                  counts={changeCounts}
                  currency={changeCurrency}
                  onChange={(counts) =>
                    setChangeDraft({
                      amount: sumDenominations(
                        counts,
                        getBillsForCurrency(changeCurrency),
                      ),
                      counts,
                    })
                  }
                />
              </>
            ) : (
              <NumberInput
                decimals={2}
                helperText="Se descuenta del baúl en la cuenta de la tienda."
                label="Vuelto entregado"
                onChange={(event) =>
                  setChangeDraft({
                    amount: Number(event.target.value) || 0,
                    counts: {},
                  })
                }
                value={changeAmount || ""}
              />
            )}

            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Entregado:{" "}
                <span className="font-semibold text-foreground">
                  {formatMethodAmount(effectiveChangeMethod, changeAmount)}
                </span>
              </span>
              {roundingVes > MIXED_PAYMENT_TOLERANCE_VES ? (
                <span className="text-muted-foreground">
                  Redondeo a favor:{" "}
                  <span className="font-semibold text-foreground">
                    {formatVes(roundingVes)}
                  </span>
                </span>
              ) : null}
            </div>
          </fieldset>
        ) : null}

        {hasSubmitted && !validation.isValid ? (
          <ul className="space-y-1 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
      </form>
    </Modal>
  );
}
