/**
 * REP-06b · visibilidad de los reportes según la sesión. La regla de los cinco
 * de dinero es la de sus rutas (`assertMoneyReportAccess`); aquí se comprueba
 * con los permisos reales de cada rol.
 */
import { getRolePermissions, type Permission, type UserRole } from "@/shared/auth/permissions";

import { INVENTORY_REPORT_SLUGS } from "../../services/inventoryReports";
import { MONEY_REPORT_SLUGS } from "../../services/moneyReports";
import { canViewReport, filterReportsByAccess } from "./reportAccess";
import {
  inventoryReportCatalog,
  MULTI_STORE_REPORT_IDS,
  reportCatalog,
  storeReportCatalog,
} from "./reportCatalog";

function viewer(role: UserRole, change: { add?: Permission[]; remove?: Permission[] } = {}) {
  const permissions = [...getRolePermissions(role), ...(change.add ?? [])].filter(
    (permission) => !(change.remove ?? []).includes(permission),
  );

  return { permissions, role };
}

function visibleMoneyReports(session: ReturnType<typeof viewer>) {
  return MONEY_REPORT_SLUGS.filter((id) => canViewReport(id, session));
}

describe("canViewReport", () => {
  it.each(["admin", "contador"] as const)("%s ve los cinco reportes de dinero", (role) => {
    expect(visibleMoneyReports(viewer(role))).toEqual([...MONEY_REPORT_SLUGS]);
  });

  it.each(["vendedor", "almacen"] as const)("%s no ve ninguno (no tiene reports.view)", (role) => {
    expect(visibleMoneyReports(viewer(role))).toEqual([]);
  });

  it("vendedor con reports.view: ve ventas, cobrar y caja, pero no cuentas por pagar", () => {
    expect(visibleMoneyReports(viewer("vendedor", { add: ["reports.view"] }))).toEqual([
      "sales-by-hour",
      "sales-by-category",
      "receivables-aging",
      "cash-close-differences",
    ]);
  });

  it("sin cash.view no se ve diferencias de cierre; sin payments.manage ni sales.create, tampoco cobrar ni pagar", () => {
    expect(visibleMoneyReports(viewer("contador", { remove: ["cash.view"] }))).toEqual([
      "sales-by-hour",
      "sales-by-category",
      "receivables-aging",
      "payables-aging",
    ]);
    expect(visibleMoneyReports(viewer("contador", { remove: ["payments.manage"] }))).toEqual([
      "sales-by-hour",
      "sales-by-category",
      "cash-close-differences",
    ]);
  });

  it("mientras la sesión carga (sin rol) no se ve ninguno de dinero", () => {
    expect(
      MONEY_REPORT_SLUGS.filter((id) => canViewReport(id, { permissions: [], role: undefined })),
    ).toEqual([]);
  });

  it("los reportes que ya existían no se filtran aquí", () => {
    for (const id of MULTI_STORE_REPORT_IDS) {
      expect(canViewReport(id, { permissions: [], role: undefined })).toBe(true);
      expect(canViewReport(id, viewer("almacen"))).toBe(true);
    }
  });
});

describe("canViewReport · reportes de inventario (REP-07b)", () => {
  const visibleInventoryReports = (session: ReturnType<typeof viewer>) =>
    INVENTORY_REPORT_SLUGS.filter((id) => canViewReport(id, session));

  it("administrador ve los tres", () => {
    expect(visibleInventoryReports(viewer("admin"))).toEqual([...INVENTORY_REPORT_SLUGS]);
  });

  it("contador (reports.view sin inventory.view) y almacén (al revés) no ven ninguno", () => {
    expect(visibleInventoryReports(viewer("contador"))).toEqual([]);
    expect(visibleInventoryReports(viewer("almacen"))).toEqual([]);
    expect(visibleInventoryReports(viewer("vendedor"))).toEqual([]);
  });

  it("hacen falta los dos permisos, los mismos que pide la ruta", () => {
    expect(visibleInventoryReports(viewer("contador", { add: ["inventory.view"] }))).toEqual([
      ...INVENTORY_REPORT_SLUGS,
    ]);
    expect(visibleInventoryReports(viewer("almacen", { add: ["reports.view"] }))).toEqual([
      ...INVENTORY_REPORT_SLUGS,
    ]);
    expect(visibleInventoryReports(viewer("admin", { remove: ["inventory.view"] }))).toEqual([]);
    expect(visibleInventoryReports(viewer("admin", { remove: ["reports.view"] }))).toEqual([]);
  });

  it("mientras la sesión carga (sin rol) no se ve ninguno", () => {
    expect(
      INVENTORY_REPORT_SLUGS.filter((id) =>
        canViewReport(id, { permissions: ["reports.view", "inventory.view"], role: undefined }),
      ),
    ).toEqual([]);
  });
});

describe("filterReportsByAccess", () => {
  it("un administrador recibe el catálogo completo, en su orden", () => {
    expect(filterReportsByAccess(storeReportCatalog, viewer("admin"))).toEqual(storeReportCatalog);
  });

  it("sin permiso, el catálogo queda como el multi-tienda", () => {
    expect(filterReportsByAccess(storeReportCatalog, viewer("almacen"))).toEqual(reportCatalog);
    expect(filterReportsByAccess(storeReportCatalog, { permissions: [], role: undefined })).toEqual(
      reportCatalog,
    );
  });

  it("quita solo los reportes que la sesión no puede abrir", () => {
    const visible = filterReportsByAccess(storeReportCatalog, viewer("contador", { remove: ["cash.view"] }));

    expect(visible.map((report) => report.id)).not.toContain("cash-close-differences");
    // Contador tampoco tiene `inventory.view`: los tres de inventario no se le ofrecen.
    expect(visible).toHaveLength(storeReportCatalog.length - 1 - inventoryReportCatalog.length);

    const withoutInventory = filterReportsByAccess(storeReportCatalog, viewer("admin", { remove: ["inventory.view"] }));

    expect(withoutInventory).toHaveLength(storeReportCatalog.length - inventoryReportCatalog.length);
    for (const id of INVENTORY_REPORT_SLUGS) {
      expect(withoutInventory.map((report) => report.id)).not.toContain(id);
    }
  });
});
