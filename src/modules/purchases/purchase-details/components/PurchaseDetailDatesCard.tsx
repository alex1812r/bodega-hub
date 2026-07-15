import { Calendar } from "lucide-react";
import moment from "moment";

import { DATE_FORMATS, formatDate } from "@/shared/utils/date";

import { PurchaseDetailInfoCard } from "./PurchaseDetailInfoCard";

type PurchaseDetailDatesCardProps = {
  createdAt: string;
};

export function PurchaseDetailDatesCard({ createdAt }: PurchaseDetailDatesCardProps) {
  const createdLabel = moment(createdAt).locale("es").format("D MMM");

  return (
    <PurchaseDetailInfoCard icon={Calendar} title="Fechas">
      <p className="text-sm text-foreground">Creada el {createdLabel}</p>
      <p className="mt-1 text-sm text-on-surface-variant">
        {formatDate(createdAt, DATE_FORMATS.time)} hrs
      </p>
    </PurchaseDetailInfoCard>
  );
}
