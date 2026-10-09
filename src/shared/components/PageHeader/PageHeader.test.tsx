import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { PageHeader } from "./PageHeader";

const LONG_TITLE = "Detalle de la compra a Distribuidora Alimentos Polar del Centro";

function renderWithActions() {
  return render(
    <PageHeader
      actions={
        <>
          <button type="button">Volver</button>
          <button type="button">Editar</button>
          <button type="button">Recibir</button>
          <button type="button">Registrar pago</button>
          <button type="button">Más</button>
        </>
      }
      description="Recibida el 9 de octubre"
      title={LONG_TITLE}
    />,
  );
}

describe("PageHeader", () => {
  it("pinta título, descripción, badge y acciones", () => {
    render(
      <PageHeader
        actions={<button type="button">Nuevo</button>}
        badge={<span>Borrador</span>}
        description="Listado de productos"
        title="Productos"
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Productos" })).toBeVisible();
    expect(screen.getByText("Listado de productos")).toBeVisible();
    expect(screen.getByText("Borrador")).toBeVisible();
    expect(screen.getByRole("button", { name: "Nuevo" })).toBeVisible();
  });

  it("acepta un nodo como título sin envolverlo en otro encabezado", () => {
    render(<PageHeader title={<h1>Factura 0001</h1>} />);

    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("el contenedor permite que las acciones bajen a una segunda línea", () => {
    const { container } = renderWithActions();

    expect(container.firstElementChild).toHaveClass("sm:flex-row", "sm:flex-wrap");
  });

  it("el título reserva un ancho mínimo y ocupa el resto de la línea: no se aplasta", () => {
    const { container } = renderWithActions();
    const title = container.querySelector("[data-page-header-title]");

    expect(title).toHaveClass("min-w-0", "sm:grow", "sm:basis-64");
    expect(title).toContainElement(screen.getByRole("heading", { name: LONG_TITLE }));
    // Sin cortes letra a letra en el título.
    expect(screen.getByRole("heading", { name: LONG_TITLE }).className).not.toMatch(/break-all|anywhere/);
  });

  it("las acciones se reparten en líneas, no pasan del ancho disponible y quedan a la derecha", () => {
    const { container } = renderWithActions();
    const actions = container.querySelector("[data-page-header-actions]");

    expect(actions).toHaveClass("sm:flex-wrap", "sm:max-w-full", "sm:ml-auto", "sm:justify-end");
    expect(actions?.querySelectorAll("button")).toHaveLength(5);
  });

  it("className del consumidor se sigue aplicando al contenedor", () => {
    const { container } = render(<PageHeader className="mb-6" title="Productos" />);

    expect(container.firstElementChild).toHaveClass("mb-6");
    expect(container.querySelector("[data-page-header-actions]")).toBeNull();
  });
});
