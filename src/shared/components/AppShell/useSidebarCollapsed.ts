"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "bodega-hub:sidebar-collapsed";

function readStoredCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribeToNothing() {
  return () => {};
}

export function useSidebarCollapsed() {
  // La preferencia se lee una sola vez al montar. Durante SSR/hidratación se
  // devuelve `false` (hydrated = false) para no desajustar el HTML del servidor.
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // ignore quota / private mode
    }
  }, [collapsed, hydrated]);

  const toggle = useCallback(() => {
    setCollapsed((current) => !current);
  }, []);

  return { collapsed: hydrated ? collapsed : false, toggle };
}
