/**
 * REP-F8 · R-14 en `/dashboard`: un rango de la URL invertido, con el año fuera
 * de rango o mal formado no se usa (ni se pide al servidor); el periodo es el de
 * por defecto (hoy) y el control de periodo lo avisa.
 */
import "@testing-library/jest-dom";
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardPeriodField } from "../components/DashboardPeriodField";
import { useDashboardUrlPeriod } from "./useDashboardKpiPeriod";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// Con datos mock el día operativo es fijo (ver `getBusinessTodayIsoDate`).
const TODAY = "2026-05-18";
const NOTICE = "El rango de la dirección no era válido; se muestra el rango por defecto.";

function setUrl(search: string) {
  window.history.replaceState(null, "", `/dashboard${search}`);
}

function PeriodField() {
  return <DashboardPeriodField period={useDashboardUrlPeriod()} />;
}

describe("useDashboardUrlPeriod · rango inválido en la URL (REP-F8 R-14)", () => {
  afterEach(() => {
    setUrl("");
  });

  it.each([
    ["invertido", "?from=2026-05-10&to=2026-05-01"],
    ["con el año fuera de rango", "?from=2026-05-01&to=9999-12-31"],
    ["anterior a 2000", "?from=1900-01-01&to=2026-05-10"],
    ["mal formado", "?from=ayer&to=2026-05-10"],
  ])("%s: el periodo es hoy y nada de la URL llega a los filtros", (_name, search) => {
    setUrl(search);
    const { result } = renderHook(() => useDashboardUrlPeriod());

    expect(result.current.urlRangeWasInvalid).toBe(true);
    expect(result.current.range).toMatchObject({ from: TODAY, to: TODAY });
    expect(result.current.currentFilters).toMatchObject({ from: TODAY, to: TODAY });
    expect(JSON.stringify([result.current.currentFilters, result.current.previousFilters])).not.toMatch(
      /9999|1900|2026-05-10|2026-05-01/,
    );
  });

  it("un rango válido se respeta y no avisa", () => {
    setUrl("?from=2026-05-01&to=2026-05-10");
    const { result } = renderHook(() => useDashboardUrlPeriod());

    expect(result.current.urlRangeWasInvalid).toBe(false);
    expect(result.current.range).toMatchObject({ from: "2026-05-01", to: "2026-05-10" });
  });

  it("el control de periodo muestra el aviso, descartable", async () => {
    setUrl("?from=2026-05-10&to=2026-05-01");
    render(<PeriodField />);

    expect(screen.getByRole("status")).toHaveTextContent(NOTICE);

    await userEvent.click(screen.getByRole("button", { name: "Descartar aviso" }));

    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("sin rango en la URL no hay aviso", () => {
    render(<PeriodField />);

    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
