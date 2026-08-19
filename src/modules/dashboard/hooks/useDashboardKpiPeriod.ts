"use client";

import { useMemo, useState } from "react";

import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import {
  DASHBOARD_KPI_PERIODS,
  type DashboardKpiPreset,
  getKpiComparisonLabel,
  getKpiPeriodLabel,
  resolveKpiMetricsFilters,
  resolvePreviousKpiMetricsFilters,
} from "@/modules/dashboard/utils/kpiPeriod";

export function useDashboardKpiPeriod() {
  const today = getBusinessTodayIsoDate();
  const [preset, setPreset] = useState<DashboardKpiPreset>("hoy");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [modalOpen, setModalOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState<DashboardKpiPreset>("hoy");
  const [draftFrom, setDraftFrom] = useState(today);
  const [draftTo, setDraftTo] = useState(today);

  const customRange = useMemo(
    () => ({ from: customFrom, to: customTo }),
    [customFrom, customTo],
  );

  const currentFilters = useMemo(
    () => resolveKpiMetricsFilters(preset, customRange),
    [customRange, preset],
  );
  const previousFilters = useMemo(
    () => resolvePreviousKpiMetricsFilters(preset, customRange),
    [customRange, preset],
  );

  const applyDisabled =
    draftPreset === "rango" && (!draftFrom || !draftTo || draftFrom > draftTo);

  function openModal() {
    setDraftPreset(preset);
    setDraftFrom(customFrom || today);
    setDraftTo(customTo || today);
    setModalOpen(true);
  }

  function apply() {
    if (applyDisabled) {
      return;
    }

    setPreset(draftPreset);
    if (draftPreset === "rango") {
      setCustomFrom(draftFrom);
      setCustomTo(draftTo);
    }
    setModalOpen(false);
  }

  function changeDraftPreset(key: string) {
    const next = key as DashboardKpiPreset;
    setDraftPreset(next);
    if (next === "rango" && (!draftFrom || !draftTo)) {
      setDraftFrom(today);
      setDraftTo(today);
    }
  }

  return {
    apply,
    applyDisabled,
    changeDraftPreset,
    comparisonLabel: getKpiComparisonLabel(preset),
    currentFilters,
    draftFrom,
    draftPreset,
    draftTo,
    kpiPeriodLabel: getKpiPeriodLabel(preset, customRange),
    modalOpen,
    openModal,
    periods: DASHBOARD_KPI_PERIODS,
    preset,
    previousFilters,
    setDraftFrom,
    setDraftTo,
    setModalOpen,
    today,
  };
}
