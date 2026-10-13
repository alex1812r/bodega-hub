import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PrimaryStateAction, type PrimaryStateFigure } from "./PrimaryStateAction";

const figures: PrimaryStateFigure[] = [
  { label: "Total", value: "REF 1.250,00", hint: "Bs 187.500,00" },
  { label: "Pagado", value: "REF 400,00", tone: "success" },
  { label: "Saldo", value: "REF 850,00", tone: "danger" },
  { label: "Productos", value: "12" },
];

describe("PrimaryStateAction", () => {
  it.each([1, 2, 3, 4])("renders %i figure(s) with label, value and hint", (count) => {
    render(<PrimaryStateAction figures={figures.slice(0, count)} />);

    expect(screen.getAllByRole("term")).toHaveLength(count);
    expect(screen.getByText("Total")).toBeVisible();
    expect(screen.getByText("REF 1.250,00")).toBeVisible();
    expect(screen.getByText("Bs 187.500,00")).toBeVisible();
  });

  it("renders only four figures and warns in development when more are given", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    render(
      <PrimaryStateAction figures={[...figures, { label: "Sobrante", value: "99" }]} />,
    );

    expect(screen.getAllByRole("term")).toHaveLength(4);
    expect(screen.queryByText("Sobrante")).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("5 cifras"));

    warn.mockRestore();
  });

  it("does not warn with four figures or fewer", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    render(<PrimaryStateAction figures={figures} />);

    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it("applies the tone to the figure value", () => {
    render(<PrimaryStateAction figures={figures} />);

    expect(screen.getByText("REF 850,00")).toHaveClass("text-red-700");
    expect(screen.getByText("REF 400,00")).toHaveClass("text-emerald-700");
  });

  it("exposes a labelled region and the status badge", () => {
    render(
      <PrimaryStateAction
        ariaLabel="Resumen de la compra"
        figures={figures}
        status={<span>Pedido</span>}
      />,
    );

    const region = screen.getByRole("region", { name: "Resumen de la compra" });

    expect(within(region).getByText("Pedido")).toBeVisible();
  });

  it("renders the primary action with its explicit label and triggers it", async () => {
    const onClick = jest.fn();

    render(
      <PrimaryStateAction
        figures={figures}
        primaryAction={{ label: "Recibir mercancía", onClick }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Recibir mercancía" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the primary action as a link when it has href", () => {
    render(
      <PrimaryStateAction
        figures={figures}
        primaryAction={{ label: "Ver PDF", href: "/purchases/1/pdf" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Ver PDF" })).toHaveAttribute(
      "href",
      "/purchases/1/pdf",
    );
  });

  it("blocks the primary action while pending", async () => {
    const onClick = jest.fn();

    render(
      <PrimaryStateAction
        figures={figures}
        primaryAction={{ label: "Pagar", onClick, isPending: true }}
      />,
    );

    const button = screen.getByRole("button", { name: "Pagar" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await userEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("blocks a pending href action instead of rendering a link", () => {
    render(
      <PrimaryStateAction
        figures={figures}
        primaryAction={{ label: "Ver PDF", href: "/purchases/1/pdf", isPending: true }}
      />,
    );

    expect(screen.queryByRole("link", { name: "Ver PDF" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver PDF" })).toBeDisabled();
  });

  it("shows the disabled reason and links it to the button", async () => {
    const onClick = jest.fn();

    render(
      <PrimaryStateAction
        figures={figures}
        primaryAction={{
          label: "Pagar",
          onClick,
          disabled: true,
          disabledReason: "No tienes permiso para registrar pagos.",
        }}
      />,
    );

    const button = screen.getByRole("button", { name: "Pagar" });

    expect(button).toBeDisabled();
    expect(screen.getByText("No tienes permiso para registrar pagos.")).toBeVisible();
    expect(button).toHaveAccessibleDescription("No tienes permiso para registrar pagos.");

    await userEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("hides the disabled reason when the action is enabled", () => {
    render(
      <PrimaryStateAction
        figures={figures}
        primaryAction={{
          label: "Pagar",
          onClick: jest.fn(),
          disabledReason: "No tienes permiso para registrar pagos.",
        }}
      />,
    );

    expect(
      screen.queryByText("No tienes permiso para registrar pagos."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pagar" })).toBeEnabled();
  });

  it("renders no button without primary action nor secondary actions", () => {
    render(<PrimaryStateAction figures={figures} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders only the menu when there is no primary action", () => {
    render(
      <PrimaryStateAction
        figures={figures}
        secondaryActions={[{ label: "Ver recibo", onSelect: jest.fn() }]}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Más acciones" })).toBeVisible();
  });

  it("opens the secondary menu and triggers the selected action", async () => {
    const onSelect = jest.fn();

    render(
      <PrimaryStateAction
        figures={figures}
        primaryAction={{ label: "Pagar", onClick: jest.fn() }}
        secondaryActions={[
          { label: "Descargar PDF", onSelect },
          { label: "Anular", onSelect: jest.fn(), variant: "danger" },
        ]}
      />,
    );

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Descargar PDF" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it.each([
    ["info", "status"],
    ["success", "status"],
    ["warning", "status"],
    ["danger", "alert"],
  ] as const)("shows the %s notice with role %s", (tone, role) => {
    render(
      <PrimaryStateAction
        figures={figures}
        notice={{ tone, text: "El inventario no ha cambiado." }}
      />,
    );

    expect(screen.getByRole(role)).toHaveTextContent("El inventario no ha cambiado.");
    expect(screen.getByRole(role)).toBeVisible();
  });

  it("renders no notice when it is not provided", () => {
    render(<PrimaryStateAction figures={figures} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
