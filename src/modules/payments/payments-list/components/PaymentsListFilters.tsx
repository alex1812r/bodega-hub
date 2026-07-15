"use client";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { PaymentsFilters } from "../../hooks/usePayments";

type PaymentsListFiltersProps = {
  filters: Pick<PaymentsFilters, "contactId" | "direction" | "purchaseId" | "saleId">;
  onChange: (patch: Partial<PaymentsFilters>) => void;
};

export function PaymentsListFilters({ filters, onChange }: PaymentsListFiltersProps) {
  return (
    <section className="rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="payments-contact">
            Contacto
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="payments-contact"
            onChange={(event) =>
              onChange({ contactId: event.target.value.trim() || undefined })
            }
            placeholder="cont-customer"
            type="text"
            value={filters.contactId ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="payments-sale">
            Venta
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="payments-sale"
            onChange={(event) =>
              onChange({ saleId: event.target.value.trim() || undefined })
            }
            placeholder="sale-002"
            type="text"
            value={filters.saleId ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="payments-purchase">
            Compra
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="payments-purchase"
            onChange={(event) =>
              onChange({ purchaseId: event.target.value.trim() || undefined })
            }
            placeholder="purchase-001"
            type="text"
            value={filters.purchaseId ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="payments-type">
            Tipo
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="payments-type"
            onChange={(event) =>
              onChange({
                direction: (event.target.value || undefined) as PaymentsFilters["direction"],
              })
            }
            value={filters.direction ?? ""}
          >
            <option value="">Todos los tipos</option>
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
          </select>
        </div>
      </div>
    </section>
  );
}
