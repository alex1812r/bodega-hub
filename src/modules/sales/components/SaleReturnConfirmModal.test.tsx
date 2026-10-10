/**
 * CNF-03 · «Devolver venta» confirma con el efecto real de `return_sale`:
 * devolución TOTAL, anula cada pago activo y revierte sus asientos.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import { createQueryWrapper, jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import type { SaleImpact } from "../services/saleImpact";
import {
  allowedSaleImpact,
  blockingPaymentLine,
  IMPACT_SALE_ID,
  impactPaymentLine,
  impactStockLine,
  rejectedSaleImpact,
} from "./saleImpact.testFixtures";
import { SaleReturnConfirmModal } from "./SaleReturnConfirmModal";

type ModalProps = ComponentProps<typeof SaleReturnConfirmModal>;

const fetchMock = jest.fn();

function respondWith(impact: SaleImpact) {
  fetchMock.mockResolvedValue(jsonResponse({ data: impact }));
}

function renderModal(overrides: Partial<ModalProps> = {}) {
  const handlers = { onConfirm: jest.fn(), onOpenChange: jest.fn() };

  const view = render(
    <SaleReturnConfirmModal
      open
      paymentsHref={`/payments?saleId=${IMPACT_SALE_ID}`}
      saleId={IMPACT_SALE_ID}
      {...handlers}
      {...overrides}
    />,
    { wrapper: createQueryWrapper() },
  );

  return { ...handlers, ...view };
}

/** El modal ya con el efecto calculado (antes hay otro, de carga). */
async function effectDialog() {
  await screen.findByText("Qué va a pasar");

  return within(screen.getByRole("dialog", { name: "Devolver venta" }));
}

const CLOSURE_TRANSFERRED =
  "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo";

/** Venta cobrada en efectivo (con vuelto por pago móvil) y por pago móvil. */
function paidReturnImpact() {
  return allowedSaleImpact("return", {
    paidVes: 10200,
    paidVesAfter: 0,
    payments: [
      impactPaymentLine({
        amount: 8000,
        amountVes: 8000,
        changeVes: 350,
        description: "Se anula: se revierte de la caja «Caja 1» y se revierte del baúl (cuenta).",
        effects: [
          {
            balanceAfter: 20350,
            balanceBefore: 20000,
            currency: "VES",
            delta: 350,
            note: null,
            physical: true,
            target: "baul_cuenta",
            targetName: null,
          },
          {
            balanceAfter: null,
            balanceBefore: null,
            currency: "VES",
            delta: -8000,
            note: "La caja ya está cerrada y sin transferir al baúl: su cierre guardado no se recalcula.",
            physical: true,
            target: "caja",
            targetName: "Caja 1",
          },
          {
            balanceAfter: null,
            balanceBefore: null,
            currency: "VES",
            delta: 350,
            note: null,
            physical: false,
            target: "caja",
            targetName: "Caja 1",
          },
        ],
        netVes: 7650,
      }),
      impactPaymentLine({
        amount: 2550,
        amountVes: 2550,
        description: "Se anula: se revierte del baúl (cuenta).",
        effects: [
          {
            balanceAfter: 17800,
            balanceBefore: 20350,
            currency: "VES",
            delta: -2550,
            note: null,
            physical: true,
            target: "baul_cuenta",
            targetName: null,
          },
        ],
        method: "pago_movil",
        netVes: 2550,
        paymentId: "pay-2",
      }),
    ],
    refund: {
      byMethod: [
        { amount: 8000, amountVes: 8000, currency: "VES", method: "efectivo_ves" },
        { amount: 2550, amountVes: 2550, currency: "VES", method: "pago_movil" },
      ],
      changeToRecover: [{ amount: 350, amountVes: 350, currency: "VES", method: "pago_movil" }],
      netVes: 10200,
    },
    stock: [
      impactStockLine(),
      impactStockLine({
        productId: "prod-cable",
        productName: "Cable HDMI 2 m",
        quantityDelta: 2,
        sku: null,
        stockAfter: 6,
        stockBefore: 4,
      }),
    ],
  });
}

describe("SaleReturnConfirmModal", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("muestra todas las unidades que vuelven, el estado resultante y lo cobrado antes → después", async () => {
    respondWith(paidReturnImpact());
    renderModal();

    const dialog = await effectDialog();

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/sales/${IMPACT_SALE_ID}/impact?action=return`);
    expect(dialog.getByText("Pagada")).toBeInTheDocument();
    expect(dialog.getByText("Devuelta")).toBeInTheDocument();
    expect(dialog.getByText("Bs. 10.200,00", { selector: "dd span" })).toBeInTheDocument();
    expect(dialog.getByText("Bs. 0,00")).toBeInTheDocument();

    const [harina, cable] = within(
      dialog.getByRole("list", { name: "Productos que vuelven al stock" }),
    ).getAllByRole("listitem");

    expect(harina).toHaveTextContent("+3 und");
    expect(harina).toHaveTextContent("7 und");
    expect(harina).toHaveTextContent("10 und");
    expect(cable).toHaveTextContent("+2 und");
    expect(cable).toHaveTextContent("4 und");
    expect(cable).toHaveTextContent("6 und");
    // Devolución total: no hay cantidades que elegir.
    expect(dialog.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(dialog.getAllByRole("textbox")).toHaveLength(1);
  });

  it("por pago: de qué caja o baúl sale el dinero, con el saldo antes → después cuando viene", async () => {
    respondWith(paidReturnImpact());
    renderModal();

    const dialog = await effectDialog();
    const cash = within(
      dialog.getByRole("list", { name: "Asientos que revierte el pago por Efectivo VES" }),
    ).getAllByRole("listitem");

    expect(
      dialog.getByText("Se anula: se revierte de la caja «Caja 1» y se revierte del baúl (cuenta)."),
    ).toBeInTheDocument();
    expect(dialog.getByText("Vuelto entregado: Bs. 350,00")).toBeInTheDocument();

    expect(cash[0]).toHaveTextContent("Baúl (cuenta)");
    expect(cash[0]).toHaveTextContent("+ Bs. 350,00");
    expect(cash[0]).toHaveTextContent("Bs. 20.000,00");
    expect(cash[0]).toHaveTextContent("Bs. 20.350,00");
    expect(cash[1]).toHaveTextContent("Caja «Caja 1»");
    expect(cash[1]).toHaveTextContent("− Bs. 8.000,00");
    expect(cash[1]).not.toHaveTextContent("Saldo");
    expect(cash[1]).toHaveTextContent("su cierre guardado no se recalcula");
    expect(cash[2]).toHaveTextContent("Asiento informativo de la sesión");

    const mobile = within(
      dialog.getByRole("list", { name: "Asientos que revierte el pago por Pago móvil" }),
    ).getByRole("listitem");

    expect(mobile).toHaveTextContent("− Bs. 2.550,00");
    expect(mobile).toHaveTextContent("Bs. 20.350,00");
    expect(mobile).toHaveTextContent("Bs. 17.800,00");
  });

  it("sin permiso de baúl ni de caja (AUD-01): muestra cuánto se mueve, sin saldos ni nombre de caja", async () => {
    respondWith(
      allowedSaleImpact("return", {
        paidVes: 2550,
        payments: [
          impactPaymentLine({
            amount: 2550,
            amountVes: 2550,
            description: "Se anula: se revierte de caja y se revierte del baúl (cuenta).",
            effects: [
              {
                balanceAfter: null,
                balanceBefore: null,
                currency: "VES",
                delta: -2550,
                note: null,
                physical: false,
                restricted: true,
                target: "caja",
                targetName: null,
              },
              {
                balanceAfter: null,
                balanceBefore: null,
                currency: "VES",
                delta: -2550,
                note: null,
                physical: true,
                restricted: true,
                target: "baul_cuenta",
                targetName: null,
              },
            ],
            method: "pago_movil",
            netVes: 2550,
            paymentId: "pay-2",
          }),
        ],
      }),
    );
    renderModal();

    const dialog = await effectDialog();
    const [cash, vault] = within(
      dialog.getByRole("list", { name: "Asientos que revierte el pago por Pago móvil" }),
    ).getAllByRole("listitem");

    expect(cash).toHaveTextContent("Caja");
    expect(cash).not.toHaveTextContent("sin nombre");
    expect(vault).toHaveTextContent("Baúl (cuenta)");
    expect(vault).toHaveTextContent("− Bs. 2.550,00");
    expect(vault).not.toHaveTextContent("Saldo");
    // No es un fallo de lectura: no hay aviso de efecto inexacto.
    expect(dialog.queryByText(/No se pudo leer el saldo del baúl/)).not.toBeInTheDocument();
  });

  it("dinero a devolver al cliente por método, vuelto que se descuenta y neto", async () => {
    respondWith(paidReturnImpact());
    renderModal();

    const dialog = await effectDialog();
    const byMethod = within(
      dialog.getByRole("list", { name: "Recibido del cliente por método" }),
    ).getAllByRole("listitem");

    expect(byMethod[0]).toHaveTextContent("Efectivo VES");
    expect(byMethod[0]).toHaveTextContent("Bs. 8.000,00");
    expect(byMethod[1]).toHaveTextContent("Pago móvil");
    expect(byMethod[1]).toHaveTextContent("Bs. 2.550,00");
    expect(
      within(dialog.getByRole("list", { name: "Vuelto entregado por método" })).getByRole(
        "listitem",
      ),
    ).toHaveTextContent("Bs. 350,00");
    expect(dialog.getByText("Neto a devolver").parentElement).toHaveTextContent("Bs. 10.200,00");
  });

  it("un cobro en dólares muestra su monto y el equivalente en Bs", async () => {
    respondWith(
      allowedSaleImpact("return", {
        paidVes: 5100,
        payments: [
          impactPaymentLine({
            amount: 10,
            amountRef: 10,
            amountVes: 5100,
            currency: "USD",
            effects: [],
            method: "efectivo_usd",
            netVes: 5100,
          }),
        ],
        refund: {
          byMethod: [{ amount: 10, amountVes: 5100, currency: "USD", method: "efectivo_usd" }],
          changeToRecover: [],
          netVes: 5100,
        },
      }),
    );
    renderModal();

    const dialog = await effectDialog();

    expect(
      within(dialog.getByRole("list", { name: "Pagos de la venta" })).getByRole("listitem"),
    ).toHaveTextContent("ref 10.00 (Bs. 5.100,00)");
    expect(dialog.queryByRole("list", { name: "Vuelto entregado por método" })).toBeNull();
  });

  it("con dinero cobrado exige teclear DEVOLVER (sin distinguir mayúsculas) y ejecuta una vez con doble clic", async () => {
    respondWith(paidReturnImpact());
    const onConfirm = jest.fn(() => new Promise<void>(() => undefined));

    renderModal({ onConfirm });

    const dialog = await effectDialog();
    const confirm = dialog.getByRole("button", { name: "Devolver venta" });

    expect(confirm).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Palabra de confirmación"), {
      target: { value: "Devolver" },
    });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("sin cobros no pide palabra, cancelar no ejecuta y confirmar sí", async () => {
    respondWith(allowedSaleImpact("return"));
    const { onConfirm, onOpenChange } = renderModal();
    const dialog = await effectDialog();

    expect(dialog.queryByLabelText("Palabra de confirmación")).not.toBeInTheDocument();
    expect(dialog.getByText("No hay cobros activos: no se devuelve dinero.")).toBeInTheDocument();

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole("button", { name: "Devolver venta" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("pago sin asientos legibles (modo demo): lo dice a la vista y no inventa de dónde sale el dinero", async () => {
    const reason =
      "El modo demo no guarda los asientos de caja ni de baúl: no se puede anticipar de dónde sale el dinero.";

    respondWith(
      allowedSaleImpact("return", {
        inexact: { reason },
        paidVes: 7650,
        payments: [
          impactPaymentLine({
            description: "Se anula con la devolución.",
            effects: [],
            inexact: { reason },
          }),
        ],
        refund: {
          byMethod: [{ amount: 7650, amountVes: 7650, currency: "VES", method: "efectivo_ves" }],
          changeToRecover: [],
          netVes: 7650,
        },
      }),
    );
    renderModal();

    const dialog = await effectDialog();

    expect(dialog.getAllByText(reason)).toHaveLength(2);
    expect(dialog.queryByRole("list", { name: /^Asientos que revierte/ })).toBeNull();
    expect(dialog.queryByText(/Caja «/)).not.toBeInTheDocument();
  });

  it("si un pago no se puede anular no ofrece devolver: motivo exacto y pago culpable", async () => {
    respondWith(
      rejectedSaleImpact("return", CLOSURE_TRANSFERRED, {
        paidVes: 7650,
        payments: [
          blockingPaymentLine({
            description: "No se puede anular: por este pago la devolución se rechaza.",
          }),
        ],
      }),
    );
    const { onConfirm } = renderModal();
    const dialog = within(
      await screen.findByRole("dialog", { name: "No se puede devolver la venta" }),
    );

    expect(dialog.getByRole("alert")).toHaveTextContent(CLOSURE_TRANSFERRED);
    expect(dialog.queryByRole("button", { name: "Devolver venta" })).not.toBeInTheDocument();
    expect(dialog.getByText("No se puede anular: por este pago la devolución se rechaza.")).toBeInTheDocument();
    expect(dialog.getByRole("link", { name: "Ver pagos de la venta" })).toHaveAttribute(
      "href",
      `/payments?saleId=${IMPACT_SALE_ID}`,
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("si el efecto falla (403) lo muestra y no deja confirmar a ciegas", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso" } }, 403),
    );
    renderModal();

    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso");

    const dialog = within(screen.getByRole("dialog", { name: "Devolver venta" }));

    expect(dialog.queryByRole("button", { name: "Devolver venta" })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it.each([
    [
      "un 200 sin `document`",
      Object.fromEntries(
        Object.entries(allowedSaleImpact("return")).filter(([key]) => key !== "document"),
      ),
    ],
    ["un 200 con `data: null`", null],
    [
      "el efecto de OTRA venta",
      {
        ...allowedSaleImpact("return"),
        document: { ...allowedSaleImpact("return").document, id: "sale-otra" },
      },
    ],
  ])(
    "%s (CNF-F7 · CAOS-05): no rompe la pantalla ni se queda calculando; error, «Reintentar» y sin confirmar",
    async (_label, data) => {
      fetchMock.mockResolvedValue(jsonResponse({ data }));
      renderModal();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No se pudo calcular el efecto. Reintenta.",
      );

      const dialog = within(screen.getByRole("dialog", { name: "Devolver venta" }));

      expect(dialog.queryByRole("button", { name: "Devolver venta" })).not.toBeInTheDocument();
      expect(dialog.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      expect(dialog.queryByText("Qué va a pasar")).not.toBeInTheDocument();
    },
  );
});
