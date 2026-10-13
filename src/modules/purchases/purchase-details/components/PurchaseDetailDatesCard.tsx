import moment from "moment";

import { DATE_FORMATS, formatDate } from "@/shared/utils/date";

type PurchaseDetailDatesCardProps = {
  createdAt: string;
};

/** Día y mes de creación, como lo resume la sección «Fechas» cerrada. */
export function formatPurchaseCreatedLabel(createdAt: string) {
  return moment(createdAt).locale("es").format("D MMM");
}

/** Contenido de la sección «Fechas». */
export function PurchaseDetailDatesCard({ createdAt }: PurchaseDetailDatesCardProps) {
  return (
    <div>
      <p className="text-sm text-foreground">Creada el {formatPurchaseCreatedLabel(createdAt)}</p>
      <p className="mt-1 text-sm text-on-surface-variant">
        {formatDate(createdAt, DATE_FORMATS.time)} hrs
      </p>
    </div>
  );
}
