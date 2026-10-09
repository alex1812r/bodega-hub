"use client";

import { Search } from "lucide-react";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { CategoriesListFilterState } from "../categoriesListParams";

type CategoriesListFiltersProps = {
  onChange: (patch: Partial<CategoriesListFilterState>) => void;
  state: CategoriesListFilterState;
};

export function CategoriesListFilters({ onChange, state }: CategoriesListFiltersProps) {
  return (
    <section className="w-full min-w-0 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="categories-search">
            Búsqueda
          </label>
          <div className="relative min-w-0">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 z-10 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className={cn(stitchListFilterFieldClassName, "w-full min-w-0 pl-10")}
              id="categories-search"
              onChange={(event) => onChange({ search: event.target.value })}
              placeholder="Buscar por nombre..."
              type="search"
              value={state.search}
            />
          </div>
        </div>
        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="categories-status">
            Estado
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="categories-status"
            onChange={(event) =>
              onChange({ status: event.target.value as CategoriesListFilterState["status"] })
            }
            value={state.status}
          >
            <option value="all">Estado: Todos</option>
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </select>
        </div>
      </div>
    </section>
  );
}
