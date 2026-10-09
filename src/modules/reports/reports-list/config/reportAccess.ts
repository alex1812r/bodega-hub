import type { Permission, UserRole } from "@/shared/auth/permissions";

import { assertInventoryReportAccess } from "../../services/inventoryReports";
import { assertMoneyReportAccess } from "../../services/moneyReports";
import {
  isInventoryReportId,
  isMoneyReportId,
  type ReportDefinition,
  type ReportId,
} from "./reportCatalog";

/** Lo que el cliente sabe de la sesión (`usePermission`); `role` falta mientras carga. */
export type ReportViewer = {
  permissions: readonly Permission[];
  role: UserRole | undefined;
};

/**
 * ¿Puede esta sesión ver el reporte? Los de dinero de REP-06 y los de inventario
 * de REP-07 usan la MISMA regla que su ruta (`assertMoneyReportAccess`,
 * `assertInventoryReportAccess`: no se copia ninguna lista de permisos ni de
 * roles). El resto no se filtra aquí: solo exige `reports.view`, que ya pide la
 * pantalla entera.
 *
 * Sin sesión cargada (`role` ausente) ninguno de dinero ni de inventario es
 * visible.
 */
export function canViewReport(reportId: ReportId, viewer: ReportViewer) {
  const isMoney = isMoneyReportId(reportId);

  if (!isMoney && !isInventoryReportId(reportId)) {
    return true;
  }

  if (!viewer.role) {
    return false;
  }

  try {
    if (isMoney) {
      assertMoneyReportAccess(reportId, { permissions: viewer.permissions, role: viewer.role });
    } else {
      assertInventoryReportAccess({ permissions: viewer.permissions });
    }

    return true;
  } catch {
    return false;
  }
}

/** Reportes del catálogo que la sesión puede abrir, en el mismo orden. */
export function filterReportsByAccess<TReport extends Pick<ReportDefinition, "id">>(
  reports: readonly TReport[],
  viewer: ReportViewer,
) {
  return reports.filter((report) => canViewReport(report.id, viewer));
}
