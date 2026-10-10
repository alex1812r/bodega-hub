import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";

import { ThemeProvider } from "@/shared/theme/ThemeProvider";

import { AppShell } from "./AppShell";

function renderShell(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
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

  it("opens mobile navigation drawer", () => {
    const { getAllByLabelText, getByLabelText, getByRole } = renderShell(
      <AppShell role="admin">
        <p>Contenido del dashboard</p>
      </AppShell>,
    );

    fireEvent.click(getByLabelText(/abrir menu de navegacion/i));

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
