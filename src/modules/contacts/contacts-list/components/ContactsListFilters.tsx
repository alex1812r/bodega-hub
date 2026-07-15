"use client";

import { Search } from "lucide-react";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { ContactsFilters } from "../../hooks/useContacts";

type ContactsListFiltersProps = {
  filters: Pick<ContactsFilters, "isActive" | "search" | "type">;
  onChange: (patch: Partial<ContactsFilters>) => void;
};

function isActiveFilterValue(isActive: ContactsFilters["isActive"]) {
  if (isActive === true || isActive === "true") {
    return "true";
  }

  if (isActive === false || isActive === "false") {
    return "false";
  }

  return "";
}

export function ContactsListFilters({ filters, onChange }: ContactsListFiltersProps) {
  return (
    <section className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <label className={stitchListFilterLabelClassName} htmlFor="contacts-search">
          Buscar
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className={cn(stitchListFilterFieldClassName, "w-full pl-10")}
            id="contacts-search"
            onChange={(event) =>
              onChange({ search: event.target.value.trim() || undefined })
            }
            placeholder="Nombre, RIF o Cédula..."
            type="search"
            value={filters.search ?? ""}
          />
        </div>
      </div>

      <div className="w-full min-w-[10rem] md:w-48">
        <label className={stitchListFilterLabelClassName} htmlFor="contacts-type">
          Tipo
        </label>
        <select
          className={cn(stitchListFilterFieldClassName, "w-full")}
          id="contacts-type"
          onChange={(event) =>
            onChange({
              type: (event.target.value || undefined) as ContactsFilters["type"],
            })
          }
          value={filters.type ?? ""}
        >
          <option value="">Todos los tipos</option>
          <option value="cliente">Cliente</option>
          <option value="proveedor">Proveedor</option>
          <option value="ambos">Ambos</option>
        </select>
      </div>

      <div className="w-full min-w-[10rem] md:w-48">
        <label className={stitchListFilterLabelClassName} htmlFor="contacts-status">
          Estado
        </label>
        <select
          className={cn(stitchListFilterFieldClassName, "w-full")}
          id="contacts-status"
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              isActive:
                value === "true" ? true : value === "false" ? false : undefined,
            });
          }}
          value={isActiveFilterValue(filters.isActive)}
        >
          <option value="">Todos los estados</option>
          <option value="true">Activo</option>
          <option value="false">Inactivo</option>
        </select>
      </div>
    </section>
  );
}
