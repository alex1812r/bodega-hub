import { Lock } from "lucide-react";

import { ClientApiError } from "@/shared/api/apiFetch";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";

import { ReportOfflineError, toReportErrorMessage } from "../../reportQueryState";

const frameClassName =
  "rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm";

/** El servidor respondió 403: la sesión no tiene (o perdió) el permiso del reporte. */
function isForbiddenError(error: unknown) {
  return error instanceof ClientApiError && error.status === 403;
}

/** 403 del tema: el reporte existe, pero esta sesión no puede verlo. */
export function ReportForbiddenState({ reportName }: { reportName: string }) {
  return (
    <section aria-label={`Sin permiso: ${reportName}`} className={frameClassName} data-testid="report-forbidden">
      <EmptyState
        description="Pide a un administrador de la tienda que te dé acceso."
        icon={<Lock aria-hidden className="size-5" />}
        title={`No tienes permiso para ver «${reportName}»`}
      />
    </section>
  );
}

type ReportQueryErrorProps = {
  error: Error;
  onRetry: () => void;
  reportName: string;
};

/**
 * Error de la consulta de un reporte: 403 → sin permiso; sin red → aviso de
 * conexión; el resto, con «Reintentar». Solo un error de negocio enseña su mensaje.
 */
export function ReportQueryError({ error, onRetry, reportName }: ReportQueryErrorProps) {
  if (isForbiddenError(error)) {
    return <ReportForbiddenState reportName={reportName} />;
  }

  if (error instanceof ReportOfflineError) {
    return <ErrorState onRetry={onRetry} title={error.message} />;
  }

  return (
    <ErrorState
      description={toReportErrorMessage(error)}
      onRetry={onRetry}
      title="No se pudo generar el reporte"
    />
  );
}
