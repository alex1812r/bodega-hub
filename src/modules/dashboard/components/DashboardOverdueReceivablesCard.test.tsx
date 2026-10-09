/**
 * REP-09b · tarjeta "Cuentas por cobrar vencidas" del dashboard. Lee solo el
 * resumen de `/api/reports/receivables-aging`, cuya ruta exige `reports.view` y
 * (`payments.manage` o `sales.create`): un rol que recibiría 403 ni la pide ni
 * la monta.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

import { rolePermissions, type Permission, type UserRole } from "@/shared/auth/permissions";

let mockRole: UserRole | undefined = "admin";
let mockPermissionsOverride: Permission[] | null = null;
let mockIsLoading = false;

function mockCurrentPermissions(): readonly Permission[] {
  if (mockPermissionsOverride) {
    return mockPermissionsOverride;
  }

  return mockRole ? jest.requireActual("../../../shared/auth/permissions").rolePermissions[mockRole] : [];
}

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: Permission) => mockCurrentPermissions().includes(permission),
    isLoading: mockIsLoading,
    permissions: mockCurrentPermissions(),
    role: mockRole,
  }),
}));

import {
  canViewOverdueReceivables,
  DashboardOverdueReceivablesCard,
  describeOverdueReceivables,
  OVERDUE_RECEIVABLES_HREF,
} from "./DashboardOverdueReceivablesCard";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

type Bucket = { documentsCount: number; pendingRef: number; pendingVes: number };

const EMPTY: Bucket = { documentsCount: 0, pendingRef: 0, pendingVes: 0 };

function agingReport(overdue: Bucket, dueSoon: Bucket) {
  return {
    data: {
      items: [],
      limit: 10,
      skip: 0,
      summary: {
        buckets: [
          { bucket: "0-7", documentsCount: 9, pendingRef: 999, pendingVes: 499500 },
          { bucket: "8-30", ...dueSoon },
          { bucket: "30+", ...overdue },
        ],
        totals: { documentsCount: 0, pendingRef: 0, pendingVes: 0 },
      },
      total: 0,
    },
  };
}

describe("DashboardOverdueReceivablesCard", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    mockRole = "admin";
    mockPermissionsOverride = null;
    mockIsLoading = false;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      jsonResponse(
        agingReport(
          { documentsCount: 3, pendingRef: 128.75, pendingVes: 65662.5 },
          { documentsCount: 4, pendingRef: 61.2, pendingVes: 31212 },
        ),
      ),
    );
    global.fetch = fetchMock;
  });

  function renderCard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <DashboardOverdueReceivablesCard />
      </QueryClientProvider>,
    );
  }

  async function settle() {
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchMock.mock.results[0].type).toBe("return"));
    await Promise.resolve();
  }

  it.each(["admin", "contador"] as const)(
    "%s la ve: documentos de más de 30 días, pendiente en REF y Bs, y el tramo por vencer",
    async (role) => {
      mockRole = role;
      renderCard();

      const link = await screen.findByRole("link", { name: /Cuentas por cobrar vencidas/ });

      expect(link).toHaveAttribute("href", "/reports?report=receivables-aging&bucket=30%2B");
      expect(link).toHaveTextContent("3 documentos con más de 30 días · ref 128.75");
      expect(link).toHaveTextContent("Bs. 65.662,50");
      expect(link).toHaveTextContent("Por vencer: 4 · ref 61.20");
      // El tramo 0-7 no es ni vencido ni por vencer: no aparece.
      expect(link).not.toHaveTextContent("999");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/receivables-aging?limit=10");
    },
  );

  it.each(["almacen", "vendedor"] as const)(
    "%s recibiría 403: ni pide el reporte ni pinta la tarjeta",
    async (role) => {
      expect(rolePermissions[role]).not.toContain("reports.view");
      mockRole = role;

      const { container } = renderCard();

      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("con reports.view pero sin payments.manage ni sales.create tampoco pide nada", async () => {
    mockPermissionsOverride = ["reports.view", "cash.view"];

    const { container } = renderCard();

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("mientras no se conocen los permisos (o el rol) no pide nada ni reserva hueco", async () => {
    mockIsLoading = true;

    const loading = renderCard();

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loading.container).toBeEmptyDOMElement();
    loading.unmount();

    mockIsLoading = false;
    mockRole = undefined;
    mockPermissionsOverride = ["reports.view", "payments.manage"];

    const withoutRole = renderCard();

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(withoutRole.container).toBeEmptyDOMElement();
  });

  it.each([
    ["mientras carga el reporte", () => new Promise<Response>(() => undefined)],
    ["sin documentos de más de 30 días ni de 8 a 30", async () => jsonResponse(agingReport(EMPTY, EMPTY))],
    ["con un 403", async () => jsonResponse({ error: { code: "FORBIDDEN", message: "Sin permiso." } }, 403)],
    ["con un 500", async () => jsonResponse({ error: { code: "ERROR", message: "No disponible." } }, 500)],
  ])("%s no pinta nada", async (_name, respond) => {
    fetchMock.mockImplementation(respond);

    const { container } = renderCard();

    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it("solo con documentos de 8 a 30 días avisa de los que están por vencer", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(agingReport(EMPTY, { documentsCount: 2, pendingRef: 15.5, pendingVes: 7750 })),
    );
    renderCard();

    const link = await screen.findByRole("link", { name: /Cuentas por cobrar vencidas/ });

    expect(link).toHaveTextContent("Sin documentos con más de 30 días");
    expect(link).toHaveTextContent("Por vencer: 2 · ref 15.50");
    expect(link).not.toHaveTextContent("Bs.");
  });

  it("solo con documentos de más de 30 días no muestra la línea de por vencer", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(agingReport({ documentsCount: 1, pendingRef: 20, pendingVes: 10000 }, EMPTY)),
    );
    renderCard();

    const link = await screen.findByRole("link", { name: /Cuentas por cobrar vencidas/ });

    expect(link).toHaveTextContent("1 documento con más de 30 días · ref 20.00");
    expect(link).not.toHaveTextContent("Por vencer");
  });

  it("usa los colores de aviso del tema en claro y en oscuro, sin colores literales", async () => {
    renderCard();

    const link = await screen.findByRole("link", { name: /Cuentas por cobrar vencidas/ });

    expect(link.className).toMatch(/border-amber-200/);
    expect(link.className).toMatch(/dark:bg-amber-950/);
    expect(link.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|style=/i);
  });
});

describe("reglas de la tarjeta", () => {
  it("el enlace lleva al reporte con el tramo vencido codificado", () => {
    expect(OVERDUE_RECEIVABLES_HREF).toBe("/reports?report=receivables-aging&bucket=30%2B");
  });

  it("describe el número de documentos en singular y plural", () => {
    expect(describeOverdueReceivables(0)).toBe("Sin documentos con más de 30 días");
    expect(describeOverdueReceivables(1)).toBe("1 documento con más de 30 días");
    expect(describeOverdueReceivables(12)).toBe("12 documentos con más de 30 días");
  });

  it.each([
    ["admin", true],
    ["contador", true],
    ["almacen", false],
    ["vendedor", false],
  ] as const)("con los permisos por defecto, %s → %s", (role, expected) => {
    expect(canViewOverdueReceivables(rolePermissions[role], role)).toBe(expected);
  });

  it("sin rol no hay acceso aunque haya permisos", () => {
    expect(canViewOverdueReceivables(["reports.view", "payments.manage"], undefined)).toBe(false);
  });
});
