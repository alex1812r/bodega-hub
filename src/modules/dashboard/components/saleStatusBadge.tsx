import { Badge } from "@/shared/components/Badge";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  cancelada: "Cancelada",
  devuelta: "Devuelta",
  pagada: "Pagado",
  pendiente_pago: "Pendiente",
};

export function getSaleStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

export function SaleStatusBadge({ status }: { status: string }) {
  const variant =
    status === "pagada"
      ? "success"
      : status === "pendiente_pago"
        ? "warning"
        : status === "cancelada" || status === "devuelta"
          ? "danger"
          : "info";

  return <Badge variant={variant}>{getSaleStatusLabel(status)}</Badge>;
}
