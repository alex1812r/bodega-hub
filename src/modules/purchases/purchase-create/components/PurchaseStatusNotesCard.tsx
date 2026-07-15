"use client";

import { ClipboardList } from "lucide-react";

import type { PurchaseStatus } from "@/shared/mocks/erp-data";

import {
  purchaseFormInputClassName,
  purchaseFormLabelClassName,
} from "../utils/purchaseCreateStyles";
import { PurchaseCreateSectionCard } from "./PurchaseCreateSectionCard";

type PurchaseStatusNotesCardProps = {
  notes: string;
  onNotesChange: (notes: string) => void;
  onStatusChange: (status: PurchaseStatus) => void;
  status: PurchaseStatus;
};

export function PurchaseStatusNotesCard({
  notes,
  onNotesChange,
  onStatusChange,
  status,
}: PurchaseStatusNotesCardProps) {
  return (
    <PurchaseCreateSectionCard icon={ClipboardList} title="Estado de la Compra">
      <div className="flex flex-col gap-4">
        <div>
          <label className={purchaseFormLabelClassName} htmlFor="purchase-status">
            Estado de la Compra
          </label>
          <select
            className={purchaseFormInputClassName}
            id="purchase-status"
            onChange={(event) => onStatusChange(event.target.value as PurchaseStatus)}
            value={status}
          >
            <option value="recibido">Recibido (Ingresa al inventario)</option>
            <option value="pedido">Pedido (Pendiente por recibir)</option>
          </select>
        </div>
        <div>
          <label className={purchaseFormLabelClassName} htmlFor="purchase-notes">
            Notas / Observaciones
          </label>
          <textarea
            className={`${purchaseFormInputClassName} min-h-[4.5rem] resize-none`}
            id="purchase-notes"
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Nro. de factura, condiciones..."
            rows={2}
            value={notes}
          />
        </div>
      </div>
    </PurchaseCreateSectionCard>
  );
}
