"use client";

import { Search } from "lucide-react";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { ContactsListFilterState } from "../contactsListParams";

type ContactsListFiltersProps = {
  customersOnly?: boolean;
  onChange: (patch: Partial<ContactsListFilterState>) => void;
  state: ContactsListFilterState;
};

export function ContactsListFilters({
  customersOnly = false,
  onChange,
  state,
}: ContactsListFiltersProps) {
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
            onChange={(event) => onChange({ search: event.target.value })}
            placeholder="Nombre, RIF o Cédula..."
            type="search"
            value={state.search}
          />
        </div>
      </div>

      {customersOnly ? null : (
        <div className="w-full min-w-[10rem] md:w-48">
          <label className={stitchListFilterLabelClassName} htmlFor="contacts-type">
            Tipo
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="contacts-type"
            onChange={(event) =>
              onChange({ type: event.target.value as ContactsListFilterState["type"] })
            }
            value={state.type}
          >
            <option value="all">Todos los tipos</option>
            <option value="cliente">Cliente</option>
            <option value="proveedor">Proveedor</option>
            <option value="ambos">Ambos</option>
          </select>
        </div>
      )}

      <div className="w-full min-w-[10rem] md:w-48">
        <label className={stitchListFilterLabelClassName} htmlFor="contacts-status">
          Estado
        </label>
        <select
          className={cn(stitchListFilterFieldClassName, "w-full")}
          id="contacts-status"
          onChange={(event) =>
            onChange({ status: event.target.value as ContactsListFilterState["status"] })
          }
          value={state.status}
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activo</option>
          <option value="inactive">Inactivo</option>
        </select>
      </div>
    </section>
  );
}
