"use client";

import { cn } from "@/shared/utils/cn";

export type SettingsTabId = "general" | "users" | "rates";

const TABS: { id: SettingsTabId; label: string }[] = [
  { id: "general", label: "General / sistema" },
  { id: "users", label: "Usuarios" },
  { id: "rates", label: "Tasas" },
];

type SettingsTabsProps = {
  activeTab: SettingsTabId;
  onChange: (tab: SettingsTabId) => void;
};

export function SettingsTabs({ activeTab, onChange }: SettingsTabsProps) {
  const baseId = "settings-tabs";

  return (
    <div
      className="flex overflow-x-auto border-b border-outline-variant"
      role="tablist"
      aria-label="Secciones de configuracion"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const tabId = `${baseId}-${tab.id}`;

        return (
          <button
            aria-controls={`${tabId}-panel`}
            aria-selected={isActive}
            className={cn(
              "shrink-0 cursor-pointer whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors",
              isActive
                ? "border-b-2 border-primary font-semibold text-primary"
                : "text-on-surface-variant hover:bg-surface-container-low",
            )}
            id={tabId}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
