import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import type { PosCheckout } from "../utils/mixedPayments";
import { PosCheckoutModal } from "./PosCheckoutModal";

function renderModal(onConfirm = jest.fn()) {
  render(
    <PosCheckoutModal
      defaultMethod="efectivo_usd"
      enabledPaymentMethods={["efectivo_usd", "efectivo_ves"]}
      onConfirm={onConfirm}
      onOpenChange={jest.fn()}
      open
      rateVes={100}
      totalRef={10}
    />,
  );

  return onConfirm;
}

describe("PosCheckoutModal · NumberInput (SHR-09)", () => {
  it("el monto es un campo de texto con teclado decimal", () => {
    renderModal();

    const amount = screen.getByLabelText("Monto");

    expect(amount).toHaveAttribute("type", "text");
    expect(amount).toHaveAttribute("inputmode", "decimal");
    expect(amount).toHaveValue("");
  });

  it("Completar restante sigue llenando el monto exacto y cobra", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.click(screen.getByRole("button", { name: "Completar restante" }));

    expect(screen.getByLabelText("Monto")).toHaveValue("10");

    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0].lines).toHaveLength(1);
    expect(onConfirm.mock.calls[0][0].lines[0]).toMatchObject({ amount: 10, method: "efectivo_usd" });
    expect(onConfirm.mock.calls[0][0].change).toBeNull();
  });

  it("al cobrar con Enter un monto con 3 decimales viaja redondeado a 2", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.type(screen.getByLabelText("Monto"), "10,004{Enter}");

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0].lines[0]).toMatchObject({ amount: 10, method: "efectivo_usd" });
    expect(onConfirm.mock.calls[0][0].change).toBeNull();
  });
});

type ModalProps = ComponentProps<typeof PosCheckoutModal>;

const ALL_METHODS: ModalProps["enabledPaymentMethods"] = [
  "efectivo_usd",
  "efectivo_ves",
  "pago_movil",
  "punto_venta",
  "transferencia",
];

function renderCheckout(props: Partial<ModalProps> = {}) {
  const onConfirm = jest.fn();

  render(
    <PosCheckoutModal
      defaultMethod="pago_movil"
      enabledPaymentMethods={ALL_METHODS}
      onConfirm={onConfirm}
      onOpenChange={jest.fn()}
      open
      rateVes={100}
      totalRef={10}
      {...props}
    />,
  );

  return onConfirm;
}

/** Campos de entrada del modal: lo que mide la métrica de POS-01. */
function entryFields() {
  return Array.from(
    screen.getByRole("dialog").querySelectorAll("input, select, textarea"),
  );
}

function billButtons() {
  return screen.queryAllByRole("button", { name: /^Agregar billete de/ });
}

function withoutLineIds(checkout: PosCheckout) {
  return {
    ...checkout,
    lines: checkout.lines.map((line) => ({ ...line, id: "" })),
  };
}

describe("PosCheckoutModal · modo compacto (POS-01)", () => {
  it("abre con pago móvil exacto mostrando solo método y monto", () => {
    renderCheckout();

    expect(entryFields()).toHaveLength(2);
    expect(screen.getByLabelText("Método de pago")).toHaveValue("pago_movil");
    expect(screen.getByLabelText("Monto")).toHaveValue("1000");
    expect(billButtons()).toHaveLength(0);
    expect(screen.queryByText("Vuelto en")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Completar restante" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expandir" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("efectivo exacto no muestra billetes ni vuelto; con diferencia aparecen", async () => {
    const user = userEvent.setup();
    renderCheckout({ defaultMethod: "efectivo_usd" });

    expect(entryFields()).toHaveLength(2);
    expect(billButtons()).toHaveLength(0);

    await user.type(screen.getByLabelText("Monto"), "10");

    expect(billButtons()).toHaveLength(0);
    expect(screen.queryByText("Vuelto en")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "20");

    expect(billButtons().length).toBeGreaterThan(0);
    expect(screen.getByText("Vuelto en")).toBeInTheDocument();
  });

  it("al cambiar de método en compacto el pago bancario se prellena con el total", async () => {
    const user = userEvent.setup();
    const onConfirm = renderCheckout({ defaultMethod: "efectivo_usd" });

    await user.selectOptions(screen.getByLabelText("Método de pago"), "punto_venta");

    expect(screen.getByLabelText("Monto")).toHaveValue("1000");
    expect(entryFields()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Cobrar" }));
    await user.type(screen.getByLabelText("Referencia"), "778899");
    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(withoutLineIds(onConfirm.mock.calls[0][0])).toEqual({
      change: null,
      changeCarrierLineId: null,
      lines: [{ amount: 1000, id: "", method: "punto_venta", referenceCode: "778899" }],
    });
  });

  it("Expandir muestra todo lo de antes y Compactar vuelve", async () => {
    const user = userEvent.setup();
    renderCheckout();

    await user.click(screen.getByRole("button", { name: "Expandir" }));

    expect(screen.getByLabelText("Referencia")).toBeInTheDocument();
    expect(screen.getByLabelText("Numero telefonico")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Efectivo USD" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Completar restante" })).toBeInTheDocument();
    expect(screen.getByText("Falta")).toBeInTheDocument();
    expect(screen.queryByLabelText("Método de pago")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Compactar" }));

    expect(entryFields()).toHaveLength(2);
    expect(screen.getByLabelText("Método de pago")).toHaveValue("pago_movil");
  });

  it("con más de un pago se muestra expandido y sin opción de compactar", async () => {
    const user = userEvent.setup();
    renderCheckout({
      initialCheckout: {
        change: null,
        changeCarrierLineId: null,
        lines: [
          { amount: 4, id: "a", method: "efectivo_usd" },
          { amount: 600, id: "b", method: "punto_venta", referenceCode: "1234" },
        ],
      },
    });

    expect(screen.queryByRole("button", { name: "Expandir" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compactar" })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Monto")).toHaveLength(2);
    expect(billButtons().length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Quitar Punto de venta" }));

    // Queda un solo pago: sigue expandido hasta que el cajero lo compacte.
    expect(screen.getByRole("button", { name: "Compactar" })).toBeInTheDocument();
    expect(billButtons().length).toBeGreaterThan(0);
  });

  it("un cobro guardado con billetes contados abre expandido", () => {
    renderCheckout({
      initialCheckout: {
        change: null,
        changeCarrierLineId: null,
        lines: [{ amount: 10, denominations: { 10: 1 }, id: "a", method: "efectivo_usd" }],
      },
    });

    expect(billButtons().length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Compactar" })).toBeInTheDocument();
  });

  it("pago móvil sin datos: el primer Cobrar solo revela los campos, sin errores, y enfoca el banco", async () => {
    const user = userEvent.setup();
    const onConfirm = renderCheckout();

    expect(
      screen.getByText("Al cobrar se piden banco, teléfono y referencia."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Banco")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Banco")).toHaveFocus();
    expect(screen.getByLabelText("Numero telefonico")).toBeInTheDocument();
    expect(screen.getByLabelText("Referencia")).toBeInTheDocument();
    expect(screen.queryByText(/^Linea 1:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Al cobrar se piden banco, teléfono y referencia."),
    ).not.toBeInTheDocument();
  });

  it("pago móvil: tras rellenar los datos el segundo Cobrar confirma una vez con el payload esperado", async () => {
    const user = userEvent.setup();
    const onConfirm = renderCheckout();

    await user.click(screen.getByRole("button", { name: "Cobrar" }));
    await user.type(screen.getByLabelText("Banco"), "0134");
    await user.click(await screen.findByRole("button", { name: /0134/ }));
    await user.type(screen.getByLabelText("Numero telefonico"), "5551234");
    await user.type(screen.getByLabelText("Referencia"), "4321");

    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    const confirmed: PosCheckout = onConfirm.mock.calls[0][0];

    expect(confirmed.change).toBeNull();
    expect(confirmed.changeCarrierLineId).toBeNull();
    expect(confirmed.lines).toHaveLength(1);
    expect(confirmed.lines[0]).toMatchObject({
      amount: 1000,
      method: "pago_movil",
      referenceCode: "4321",
    });
    expect(confirmed.lines[0].bankName).toMatch(/^0134/);
    expect(confirmed.lines[0].phone).toMatch(/5551234$/);
  });

  it("pago móvil: el segundo Cobrar con los datos vacíos muestra los errores de siempre", async () => {
    const user = userEvent.setup();
    const onConfirm = renderCheckout();

    await user.click(screen.getByRole("button", { name: "Cobrar" }));
    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Linea 1: indica el banco.")).toBeInTheDocument();
    expect(screen.getByText("Linea 1: indica el telefono.")).toBeInTheDocument();
    expect(
      screen.getByText("Linea 1: la referencia de pago movil debe tener 4 digitos."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Referencia")).toBeInTheDocument();
    expect(screen.getByLabelText("Numero telefonico")).toBeInTheDocument();
  });

  it("el aviso se genera según los datos que exige cada método", async () => {
    const user = userEvent.setup();
    renderCheckout({ defaultMethod: "punto_venta" });

    expect(screen.getByText("Al cobrar se pide referencia.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Método de pago"), "transferencia");

    expect(screen.getByText("Al cobrar se piden banco y referencia.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Método de pago"), "efectivo_ves");

    expect(screen.queryByText(/^Al cobrar/)).not.toBeInTheDocument();
  });

  it("efectivo exacto: un solo Cobrar confirma", async () => {
    const user = userEvent.setup();
    const onConfirm = renderCheckout({ defaultMethod: "efectivo_usd" });

    await user.type(screen.getByLabelText("Monto"), "10");
    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(withoutLineIds(onConfirm.mock.calls[0][0])).toEqual({
      change: null,
      changeCarrierLineId: null,
      lines: [{ amount: 10, denominations: null, id: "", method: "efectivo_usd" }],
    });
  });

  it("un monto insuficiente en compacto no cobra", async () => {
    const user = userEvent.setup();
    const onConfirm = renderCheckout({ defaultMethod: "efectivo_usd" });

    await user.type(screen.getByLabelText("Monto"), "4{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/^Falta por cubrir/)).toBeInTheDocument();
  });

  it("pago simple: el payload es el mismo en compacto que expandido", async () => {
    const user = userEvent.setup();
    const initialCheckout: PosCheckout = {
      change: null,
      changeCarrierLineId: null,
      lines: [
        {
          amount: 1000,
          bankName: "0134 - Banesco",
          id: "pm-1",
          method: "pago_movil",
          phone: "04245551234",
          referenceCode: "4321",
        },
      ],
    };

    const compact = renderCheckout({ initialCheckout });
    await user.click(screen.getByRole("button", { name: "Cobrar" }));
    await waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
    cleanup();

    const expanded = renderCheckout({ initialCheckout });
    await user.click(screen.getByRole("button", { name: "Expandir" }));
    await user.click(screen.getByRole("button", { name: "Cobrar" }));
    await waitFor(() => expect(expanded).toHaveBeenCalledTimes(1));

    expect(compact.mock.calls[0][0]).toEqual(initialCheckout);
    expect(expanded.mock.calls[0][0]).toEqual(initialCheckout);
  });

  it("efectivo simple: mismo payload tecleando el monto en compacto o expandido", async () => {
    const user = userEvent.setup();
    const expected = {
      change: null,
      changeCarrierLineId: null,
      lines: [{ amount: 10, denominations: null, id: "", method: "efectivo_usd" }],
    };

    const compact = renderCheckout({ defaultMethod: "efectivo_usd" });
    await user.type(screen.getByLabelText("Monto"), "10{Enter}");
    await waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
    cleanup();

    const expanded = renderCheckout({ defaultMethod: "efectivo_usd" });
    await user.click(screen.getByRole("button", { name: "Expandir" }));
    await user.type(screen.getByLabelText("Monto"), "10{Enter}");
    await waitFor(() => expect(expanded).toHaveBeenCalledTimes(1));

    expect(withoutLineIds(compact.mock.calls[0][0])).toEqual(expected);
    expect(withoutLineIds(expanded.mock.calls[0][0])).toEqual(expected);
  });

  it("pago mixto: Expandir permite agregar otro método y el payload no cambia", async () => {
    const user = userEvent.setup();
    const onConfirm = renderCheckout({ defaultMethod: "efectivo_usd" });

    await user.click(screen.getByRole("button", { name: "Expandir" }));
    await user.type(screen.getByLabelText("Monto"), "4");
    await user.click(screen.getByRole("button", { name: "Punto de venta" }));

    const amounts = screen.getAllByLabelText("Monto");
    await user.type(amounts[1], "600");
    await user.type(screen.getByLabelText("Referencia"), "9911");
    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(withoutLineIds(onConfirm.mock.calls[0][0])).toEqual({
      change: null,
      changeCarrierLineId: null,
      lines: [
        { amount: 4, denominations: null, id: "", method: "efectivo_usd" },
        {
          amount: 600,
          denominations: null,
          id: "",
          method: "punto_venta",
          referenceCode: "9911",
        },
      ],
    });
  });

  it("pago bancario mayor que el total: el vuelto en efectivo aparece en compacto y viaja en el payload", async () => {
    const user = userEvent.setup();
    const onConfirm = renderCheckout({ defaultMethod: "punto_venta", drawerVes: 5000 });

    expect(screen.queryByText("Vuelto en")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "1500");

    expect(screen.getByText("Vuelto en")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Efectivo VES", pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Sugerido:/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cobrar" }));
    await user.type(screen.getByLabelText("Referencia"), "5566");
    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    const confirmed: PosCheckout = onConfirm.mock.calls[0][0];

    expect(confirmed.lines).toHaveLength(1);
    expect(confirmed.lines[0]).toMatchObject({
      amount: 1500,
      method: "punto_venta",
      referenceCode: "5566",
    });
    expect(confirmed.change).toMatchObject({ amount: 500, method: "efectivo_ves" });
    expect(confirmed.changeCarrierLineId).toBe(confirmed.lines[0].id);
  });
});
