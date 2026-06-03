import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";

import { ThemeProvider } from "@/shared/theme/ThemeProvider";

import { AppShell } from "./AppShell";

function renderShell(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("AppShell", () => {
  it("renders navigation and children", () => {
    const { getAllByLabelText, getByText } = renderShell(
      <AppShell>
        <p>Contenido del dashboard</p>
      </AppShell>,
    );

    expect(getAllByLabelText(/navegacion principal/i).length).toBeGreaterThan(0);
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
    expect(getAllByLabelText(/navegacion principal/i).length).toBeGreaterThan(1);
    expect(getByRole("link", { name: /^inicio$/i })).toBeVisible();
  });

  it("filters navigation by role permissions", () => {
    const { getByRole, queryByRole } = renderShell(
      <AppShell role="vendedor">
        <p>Contenido del dashboard</p>
      </AppShell>,
    );

    expect(getByRole("link", { name: /^ventas$/i })).toBeVisible();
    expect(queryByRole("link", { name: /^compras$/i })).not.toBeInTheDocument();
    expect(queryByRole("link", { name: /^configuracion$/i })).not.toBeInTheDocument();
  });

  it("filters navigation by effective permissions when provided", () => {
    const { getByRole, queryByRole } = renderShell(
      <AppShell permissions={["dashboard.view", "reports.view"]} role="vendedor">
        <p>Contenido del dashboard</p>
      </AppShell>,
    );

    expect(getByRole("link", { name: /^reportes$/i })).toBeVisible();
    expect(queryByRole("link", { name: /^ventas$/i })).not.toBeInTheDocument();
  });
});
