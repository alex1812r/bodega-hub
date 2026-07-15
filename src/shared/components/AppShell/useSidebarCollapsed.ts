"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "control-ventas:sidebar-collapsed";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      setCollapsed(false);
    }
    setHydrated(true);
  }, []);

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
