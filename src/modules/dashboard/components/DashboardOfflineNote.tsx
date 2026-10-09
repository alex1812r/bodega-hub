import { REPORT_OFFLINE_MESSAGE } from "@/modules/reports/reports-list/reportQueryState";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

type DashboardOfflineNoteProps = {
  className?: string;
  onRetry?: () => void;
};

/**
 * Sin red, la consulta de una tarjeta queda en pausa (ni carga ni falla). Este
 * aviso ocupa el sitio del contenido para que no se lea como «no hay datos».
 */
export function DashboardOfflineNote({ className, onRetry }: DashboardOfflineNoteProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-3 text-sm text-muted-foreground", className)}
      role="status"
    >
      <span>{REPORT_OFFLINE_MESSAGE}</span>
      {onRetry ? (
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
