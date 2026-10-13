/**
 * REP-F8 · R-05: red de seguridad de las rutas `/dashboard` y `/reports`. Si un
 * error escapa a los límites de cada panel, la ruta muestra un estado en
 * español con «Reintentar» (no el «This page couldn't load» de Next) y nunca el
 * mensaje interno del error.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import ReportsError from "../reports/error";
import DashboardError from "./error";

jest.mock("../../shared/components/AppShell", () => ({
  AuthenticatedAppShell: ({ children, currentPath }: { children: ReactNode; currentPath: string }) => (
    <div data-current-path={currentPath} data-testid="app-shell">
      {children}
    </div>
  ),
}));

const INTERNAL = 'Cannot read properties of null (reading "toFixed")';

describe("error.tsx de /dashboard y /reports (REP-F8 R-05)", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("/dashboard: estado en español; «Reintentar» descarta las consultas del dashboard y reintenta", async () => {
    const retry = jest.fn();
    const client = new QueryClient();

    client.setQueryData(["dashboard", "summary", "store"], { totalRef: null });
    client.setQueryData(["products", "list"], { items: [] });
    render(
      <QueryClientProvider client={client}>
        <DashboardError error={new Error(INTERNAL)} unstable_retry={retry} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("No pudimos mostrar el dashboard")).toBeInTheDocument();
    expect(screen.queryByText(INTERNAL)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/This page|Reload|toFixed/);
    // El error no se silencia: queda en la consola.
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: INTERNAL }));

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["dashboard", "summary", "store"])).toBeUndefined();
    expect(client.getQueryData(["products", "list"])).toEqual({ items: [] });
  });

  it("/reports: conserva el AppShell de la ruta y reintenta", async () => {
    const retry = jest.fn();

    render(<ReportsError error={new Error(INTERNAL)} unstable_retry={retry} />);

    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-current-path", "/reports");
    expect(screen.getByText("No pudimos mostrar los reportes")).toBeInTheDocument();
    expect(screen.queryByText(INTERNAL)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
