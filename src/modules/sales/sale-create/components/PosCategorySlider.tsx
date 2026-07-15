"use client";

import { LayoutGrid, type LucideIcon, Package } from "lucide-react";

import type { CategoryMock } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

const ALL_CATEGORY_ID = "";

type PosCategorySliderProps = {
  categories: CategoryMock[];
  onSelect: (categoryId: string) => void;
  selectedCategoryId: string;
};

function getCategoryIcon(name: string): LucideIcon {
  const normalized = name.toLowerCase();

  if (normalized.includes("bebida")) {
    return Package;
  }

  return Package;
}

export function PosCategorySlider({
  categories,
  onSelect,
  selectedCategoryId,
}: PosCategorySliderProps) {
  const chips = [{ id: ALL_CATEGORY_ID, name: "Todos" }, ...categories];

  return (
    <div className="min-w-0 shrink-0 overflow-hidden border-b border-border bg-surface-container-lowest px-4 py-3 dark:border-slate-800">
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((category) => {
          const isActive =
            category.id === selectedCategoryId ||
            (category.id === ALL_CATEGORY_ID && !selectedCategoryId);
          const Icon = category.id === ALL_CATEGORY_ID ? LayoutGrid : getCategoryIcon(category.name);

          return (
            <button
              className={cn(
                "inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-surface-container-lowest text-foreground hover:bg-surface-container-low",
              )}
              key={category.id || "all"}
              onClick={() => onSelect(category.id)}
              type="button"
            >
              <Icon aria-hidden className="size-4" />
              {category.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
