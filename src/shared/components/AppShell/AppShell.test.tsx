import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";

import { ThemeProvider } from "@/shared/theme/ThemeProvider";

import { AppShell } from "./AppShell";

// La búsqueda global del header navega con el router y consulta con React Query.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

function renderShell(ui: ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders navigation and children", () => {
    const { getAllByLabelText, getByText } = renderShell(
      <AppShell>
        <p>Contenido del dashboard</p>
      </AppShell>,
    );

    expect(getAllByLabelText(/navegación principal/i).length).toBeGreaterThan(0);
    expect(getByText(/contenido del dashboard/i)).toBeVisible();
  });

  // GQ-01: un descendiente `position: absolute` (p. ej. `sr-only`) sin ancestro
  // posicionado se coloca respecto al documento, escapa del recorte de `<main>`
  // y deja desplazar la aplicación entera. `<main>` debe ser su bloque contenedor.
  it.each(["auto", "hidden"] as const)(
    "makes the %s-scroll main the containing block of its absolute descendants",
    (mainScroll) => {
      const { getByRole } = renderShell(
        <AppShell mainScroll={mainScroll}>
          <span className="sr-only">Solo lectores de pantalla</span>
        </AppShell>,
      );

      expect(getByRole("main")).toHaveClass("relative");
    },
  );

  it("opens mobile navigation drawer", () => {
    const { getAllByLabelText, getByLabelText, getByRole } = renderShell(
      <AppShell role="admin">
        <p>Contenido del dashboard</p>
      </AppShell>,
    );

    fireEvent.click(getByLabelText("Abrir menú de navegación"));

    expect(getByRole("dialog")).toBeInTheDocument();
    expect(getAllByLabelText(/navegación principal/i).length).toBeGreaterThan(1);
    expect(getByRole("link", { name: /^inicio$/i })).toBeVisible();
    expect(getByRole("button", { name: /^dinero$/i })).toHaveAttribute("aria-expanded", "true");
    expect(getByRole("link", { name: /^baúl$/i })).toBeVisible();
    expect(getByRole("button", { name: /^análisis$/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("filters navigation by role permissions", () => {
    const { getByRole, queryByRole } = renderShell(
      <AppShell role="vendedor">
        <p>Contenido del dashboard</p>
      </AppShell>,
    );

    expect(getByRole("link", { name: /^ventas$/i })).toBeVisible();
    expect(queryByRole("link", { name: /^compras$/i })).not.toBeInTheDocument();
    expect(queryByRole("link", { name: /^configuración$/i })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: /^configuración$/i })).not.toBeInTheDocument();
    expect(queryByRole("link", { name: /^mis recibos$/i })).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: /^dinero$/i }));

    expect(getByRole("link", { name: /^mis recibos$/i })).toBeVisible();
  });

  it("shows the global search only with a search permission", () => {
    const withSearch = renderShell(
      <AppShell role="vendedor">
        <p>Contenido</p>
      </AppShell>,
    );

    expect(withSearch.getByRole("combobox", { name: "Búsqueda global" })).toBeInTheDocument();
    withSearch.unmount();

    const withoutSearch = renderShell(
      <AppShell permissions={["dashboard.view", "reports.view"]} role="vendedor">
        <p>Contenido</p>
      </AppShell>,
    );

    expect(withoutSearch.queryByRole("combobox", { name: "Búsqueda global" })).not.toBeInTheDocument();
  });

  it("filters navigation by effective permissions when provided", () => {
    const { getByRole, queryByRole } = renderShell(
      <AppShell permissions={["dashboard.view", "reports.view"]} role="vendedor">
        <p>Contenido del dashboard</p>
      </AppShell>,
    );

    fireEvent.click(getByRole("button", { name: /^análisis$/i }));

    expect(getByRole("link", { name: /^reportes$/i })).toBeVisible();
    expect(queryByRole("link", { name: /^ventas$/i })).not.toBeInTheDocument();
  });
});
