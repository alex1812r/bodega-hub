"use client";

import { type FormEvent, useMemo, useState } from "react";

import { isIntegerText, parseNumberInput } from "@/shared/components/NumberInput";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  normalizeEnabledPaymentMethods,
} from "@/shared/payments/paymentMethods";

import {
  type AppSettings,
  type SettingsInput,
  useSettings,
  useUpdateSettings,
} from "../hooks/useSettings";
import {
  computePaymentMethodsChange,
  type PaymentMethodsChange,
} from "./utils/paymentMethodsChange";

export type GeneralSettingsFormState = {
  businessName: string;
  /** Faltante en Bs que el cierre de caja debe superar para pedir confirmación. */
  cashCloseDiffAlertVes: string;
  enabledPaymentMethods: PaymentMethod[];
  invoicePrefix: string;
  lowStockThreshold: string;
};

/** Guardado a la espera de confirmación: cambia los métodos de pago habilitados. */
export type PendingSettingsSave = {
  change: PaymentMethodsChange;
  /** Además de los métodos, el formulario lleva otros cambios. */
  hasOtherChanges: boolean;
  input: SettingsInput;
};

const initialForm: GeneralSettingsFormState = {
  businessName: "",
  cashCloseDiffAlertVes: "0",
  enabledPaymentMethods: [...DEFAULT_ENABLED_PAYMENT_METHODS],
  invoicePrefix: "",
  lowStockThreshold: "0",
};

function loadedCashCloseDiffAlertVes(data: AppSettings) {
  return data.cashCloseDiffAlertVes ?? 0;
}

function toFormState(data: AppSettings): GeneralSettingsFormState {
  return {
    businessName: data.businessName,
    cashCloseDiffAlertVes: String(loadedCashCloseDiffAlertVes(data)),
    enabledPaymentMethods: normalizeEnabledPaymentMethods(data.enabledPaymentMethods),
    invoicePrefix: data.invoicePrefix,
    lowStockThreshold: String(data.lowStockThreshold),
  };
}

/** Bs con dos decimales; el campo vacío equivale a 0 (avisa ante cualquier faltante). */
function parseCashCloseDiffAlertVes(text: string) {
  return Math.round((parseNumberInput(text) ?? 0) * 100) / 100;
}

/**
 * Estado y guardado de «Datos generales» (CNF-11). Nombre, prefijo y umbrales se
 * guardan directo; si cambian los métodos de pago habilitados, el guardado
 * queda en `pendingSave` hasta que se confirme con lo que cambia.
 */
export function useGeneralSettingsForm() {
  const settingsQuery = useSettings();
  const updateSettings = useUpdateSettings();
  const [form, setForm] = useState<GeneralSettingsFormState>(initialForm);
  const [pendingSave, setPendingSave] = useState<PendingSettingsSave | null>(null);
  const [syncedKey, setSyncedKey] = useState("");
  const data = settingsQuery.data;
  const loadedKey = data
    ? `${data.businessName}-${data.invoicePrefix}-${data.enabledPaymentMethods.join(",")}-${loadedCashCloseDiffAlertVes(data)}`
    : "";

  if (data && loadedKey !== syncedKey) {
    setSyncedKey(loadedKey);
    setForm(toFormState(data));
  }

  const dirty = useMemo(() => {
    if (!data) {
      return { cashClose: false, methods: false, other: false };
    }

    const loaded = toFormState(data);

    return {
      cashClose:
        parseCashCloseDiffAlertVes(form.cashCloseDiffAlertVes) !==
        loadedCashCloseDiffAlertVes(data),
      methods: computePaymentMethodsChange(
        loaded.enabledPaymentMethods,
        form.enabledPaymentMethods,
      ).hasChanges,
      other:
        form.businessName !== loaded.businessName ||
        form.invoicePrefix !== loaded.invoicePrefix ||
        form.lowStockThreshold !== loaded.lowStockThreshold,
    };
  }, [data, form]);

  function setField<Field extends keyof GeneralSettingsFormState>(
    field: Field,
    value: GeneralSettingsFormState[Field],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function togglePaymentMethod(method: PaymentMethod) {
    setForm((current) => {
      if (!current.enabledPaymentMethods.includes(method)) {
        return { ...current, enabledPaymentMethods: [...current.enabledPaymentMethods, method] };
      }

      // Siempre queda al menos un método habilitado.
      if (current.enabledPaymentMethods.length <= 1) {
        return current;
      }

      return {
        ...current,
        enabledPaymentMethods: current.enabledPaymentMethods.filter((item) => item !== method),
      };
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!data || form.enabledPaymentMethods.length === 0) {
      return;
    }

    // El umbral es un entero: con decimales el campo ya muestra su aviso y no se envía.
    if (form.lowStockThreshold !== "" && !isIntegerText(form.lowStockThreshold)) {
      return;
    }

    const input: SettingsInput = {
      businessName: form.businessName,
      enabledPaymentMethods: form.enabledPaymentMethods,
      invoicePrefix: form.invoicePrefix,
      lowStockThreshold: Number(form.lowStockThreshold),
      // Solo viaja si cambió: una base sin la columna rechazaría todo el guardado.
      ...(dirty.cashClose
        ? { cashCloseDiffAlertVes: parseCashCloseDiffAlertVes(form.cashCloseDiffAlertVes) }
        : {}),
    };
    const change = computePaymentMethodsChange(
      normalizeEnabledPaymentMethods(data.enabledPaymentMethods),
      form.enabledPaymentMethods,
    );

    if (change.hasChanges) {
      updateSettings.reset();
      setPendingSave({ change, hasOtherChanges: dirty.other || dirty.cashClose, input });
      return;
    }

    updateSettings.mutate(input);
  }

  async function confirmPendingSave() {
    if (!pendingSave) {
      return;
    }

    try {
      await updateSettings.mutateAsync(pendingSave.input);
    } catch {
      // El motivo queda en `updateSettings.error` y se muestra en el diálogo.
      return;
    }

    setPendingSave(null);
  }

  function cancelPendingSave() {
    // El rechazo ya se leyó en el diálogo: no debe quedar bajo el formulario.
    updateSettings.reset();
    setPendingSave(null);
  }

  function discard() {
    if (data) {
      setForm(toFormState(data));
    }
  }

  return {
    cancelPendingSave,
    confirmPendingSave,
    discard,
    form,
    isDirty: dirty.cashClose || dirty.methods || dirty.other,
    isLoading: settingsQuery.isLoading,
    isSaved: updateSettings.isSuccess,
    isSaving: updateSettings.isPending,
    loadError: settingsQuery.error,
    pendingSave,
    saveError: updateSettings.error,
    setField,
    submit,
    togglePaymentMethod,
  };
}

export type GeneralSettingsForm = ReturnType<typeof useGeneralSettingsForm>;
