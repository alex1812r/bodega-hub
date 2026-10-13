/**
 * CNF-04 · «Recibir mercancía» confirma con el efecto real de la recepción: por
 * producto, stock antes → después, costo que se fija y ganancia que baja de
 * banda; sin efecto permitido a la vista no se puede recibir.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { formatRefUsd } from "@/shared/utils/currency";

import {
  allowedPurchaseImpact,
  purchaseImpactCostLine,
  purchaseImpactStockLine,
  rejectedPurchaseImpact,
} from "../../components/purchaseImpact.testFixtures";
import type { ReceivePreviewLine } from "../utils/buildReceivePreview";
import { PurchaseReceivePreviewModal } from "./PurchaseReceivePreviewModal";

type ModalProps = ComponentProps<typeof PurchaseReceivePreviewModal>;

const RECEIVE = "Recibir mercancía";

const LINES: ReceivePreviewLine[] = [
  {
    name: "Harina PAN 1 kg",
    productId: "prod-harina",
    productInactive: false,
    purchaseItemId: "item-harina",
    quantityIn: 5,
    // Stock de la previsualización del cliente, ya viejo: el efecto real manda.
    stockAfter: 15,
    stockBefore: 10,
    unitCostRef: 2,
  },
  {
    name: "Malta Maltín",
    productId: "prod-malta",
    productInactive: true,
    purchaseItemId: "item-malta",
    quantityIn: 36,
    stockAfter: 40,
    stockBefore: 4,
    unitCostRef: 0.75,
  },
];

/** Harina: costo 1,80 → 2,32 (con IVA); Malta inactiva: costo sin cambio. */
const IMPACT = allowedPurchaseImpact("receive", {
  costs: [
    purchaseImpactCostLine({ costRefAfter: 2.32, costRefBefore: 1.8 }),
    purchaseImpactCostLine({
      costRefAfter: 0.87,
      costRefBefore: 0.87,
      isActive: false,
      productId: "prod-malta",
      productName: "Malta Maltín",
      sku: null,
    }),
  ],
  stock: [
    // Otra venta bajó el stock después de cargar el detalle: 8, no 10.
    purchaseImpactStockLine({ purchasedIn: 5, quantityDelta: 5, stockAfter: 13, stockBefore: 8 }),
    purchaseImpactStockLine({
      isActive: false,
      productId: "prod-malta",
      productName: "Malta Maltín",
      purchasedIn: 36,
      quantityDelta: 36,
      sku: null,
      stockAfter: 40,
      stockBefore: 4,
    }),
  ],
});

function renderModal(overrides: Partial<ModalProps> = {}) {
  const handlers = { onConfirm: jest.fn(), onOpenChange: jest.fn() };

  render(
    <PurchaseReceivePreviewModal
      effect={{ impact: IMPACT, status: "ready" }}
      lines={LINES}
      open
      purchaseNumber="C-20261008-000003"
      // Harina: 44 % → 12 % de ganancia (alta → baja). Malta: sin cambio.
      salePrices={{ "prod-harina": 2.6, "prod-malta": 1.2 }}
      {...handlers}
      {...overrides}
    />,
  );

  return { ...handlers, dialog: within(screen.getByRole("dialog", { name: RECEIVE })) };
}

function effectRows(dialog: ReturnType<typeof within>) {
  return within(dialog.getByRole("list", { name: "Stock y costo por producto" })).getAllByRole(
    "listitem",
  );
}

describe("PurchaseReceivePreviewModal · efecto real de la recepción (CNF-04)", () => {
  it("por producto: cantidad que entra, stock antes → después del impact y costo anterior → nuevo", () => {
    const { dialog } = renderModal();
    const [harina, malta] = effectRows(dialog);

    expect(harina).toHaveTextContent("Harina PAN 1 kg");
    expect(harina).toHaveTextContent("+5 un");
    // Manda el impact (8 → 13), no el stock de la previsualización (10 → 15).
    expect(harina).toHaveTextContent("8 unpasa a13 un");
    expect(dialog.queryByText("15 un")).not.toBeInTheDocument();
    expect(harina).toHaveTextContent(
      `Costo que se fija (con IVA)${formatRefUsd(1.8)}pasa a${formatRefUsd(2.32)}`,
    );

    expect(malta).toHaveTextContent("+36 un");
    expect(malta).toHaveTextContent("4 unpasa a40 un");
    expect(malta).toHaveTextContent(`${formatRefUsd(0.87)} (no cambia)`);
  });

  it("marca los productos cuya ganancia baja de banda con el costo nuevo y lo enlaza con el reprecio", () => {
    const { dialog } = renderModal();
    const [harina, malta] = effectRows(dialog);

    expect(harina).toHaveAttribute("data-band-drop", "true");
    expect(harina).toHaveTextContent("Ganancia: baja de banda");

    const [before, after] = Array.from(harina.querySelectorAll("[data-band]"));

    expect(before).toHaveAttribute("data-band", "high");
    expect(after).toHaveAttribute("data-band", "low");
    expect(malta).not.toHaveAttribute("data-band-drop");
    expect(malta).not.toHaveTextContent("Ganancia");
    expect(
      dialog.getByText(
        "1 producto baja de banda de ganancia con el costo nuevo. Al recibir, el aviso de reprecio de esta compra te deja ajustar sus precios.",
      ),
    ).toBeInTheDocument();
  });

  it("usa los cortes de ganancia de la tienda: con cortes más bajos el mismo cambio no baja de banda", () => {
    const { dialog } = renderModal({ thresholds: { high: 10, low: 5 } });

    expect(effectRows(dialog)[0]).not.toHaveAttribute("data-band-drop");
    expect(dialog.queryByText(/baja de banda/)).not.toBeInTheDocument();
  });

  it("producto desactivado: se recibe igual y el aviso se ve en la línea y en su efecto", () => {
    const { dialog } = renderModal();

    expect(dialog.getByText("Producto inactivo: se recibirá igualmente")).toBeInTheDocument();
    expect(effectRows(dialog)[1]).toHaveTextContent("Producto inactivo: se recibe igual.");
    expect(dialog.getByRole("button", { name: RECEIVE })).toBeEnabled();
  });

  it("al desarmar: el empaque queda neto 0 con su desglose y el componente sube con su costo promedio", () => {
    const { dialog } = renderModal({
      effect: {
        impact: allowedPurchaseImpact("receive", {
          costs: [
            purchaseImpactCostLine({
              costRefAfter: 9,
              costRefBefore: 8.5,
              productId: "prod-caja",
              productName: "Caja de refrescos",
              sku: null,
            }),
            purchaseImpactCostLine({
              costRefAfter: null,
              costRefBefore: 1.4,
              inexact: { reason: "No se pudo leer con exactitud el peso de la receta." },
              productId: "prod-lata",
              productName: "Refresco 355 ml",
              sku: null,
              source: "disassemble",
            }),
          ],
          stock: [
            purchaseImpactStockLine({
              disassembledOut: 3,
              productId: "prod-caja",
              productName: "Caja de refrescos",
              purchasedIn: 3,
              quantityDelta: 0,
              sku: null,
              stockAfter: 2,
              stockBefore: 2,
            }),
            purchaseImpactStockLine({
              componentsIn: 18,
              productId: "prod-lata",
              productName: "Refresco 355 ml",
              quantityDelta: 18,
              sku: null,
              stockAfter: 22,
              stockBefore: 4,
            }),
          ],
        }),
        status: "ready",
      },
    });
    const [box, can] = effectRows(dialog);

    expect(box).toHaveTextContent("2 un (no cambia)");
    expect(box).toHaveTextContent("Entran 3 un por la compra · salen 3 un al desarmarse");
    expect(can).toHaveTextContent("+18 un");
    expect(can).toHaveTextContent("4 unpasa a22 un");
    expect(can).toHaveTextContent("Entran 18 un de empaques desarmados");
    // Costo que no se puede anticipar: se dice, sin cifra inventada.
    expect(can).toHaveTextContent(`${formatRefUsd(1.4)} (no se puede anticipar)`);
    expect(can).toHaveTextContent("No se pudo leer con exactitud el peso de la receta.");
  });

  it("confirmar llama una sola vez aunque haya doble clic; cancelar no llama", () => {
    const onConfirm = jest.fn(() => new Promise<void>(() => undefined));
    const { dialog } = renderModal({ onConfirm });
    const confirm = dialog.getByRole("button", { name: RECEIVE });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("un lector de códigos con la confirmación abierta no recibe la mercancía (CNF-F7 · CAOS-01)", async () => {
    const { dialog, onConfirm, onOpenChange } = renderModal();
    const user = userEvent.setup({ delay: null });

    expect(dialog.getByRole("button", { name: RECEIVE })).toHaveFocus();

    await user.keyboard("7591234567895{Enter}");
    await user.keyboard("HER-TAL-001{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("«Cancelar» cierra sin recibir", async () => {
    const { dialog, onConfirm, onOpenChange } = renderModal();

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("mientras llega el efecto: se ven las líneas, no hay botón de recibir", () => {
    const { dialog } = renderModal({ effect: { impact: null, status: "loading" } });

    expect(dialog.getByRole("status")).toHaveTextContent(
      "Calculando el stock y el costo que quedarán…",
    );
    expect(dialog.getByRole("list", { name: "Mercancía que entra" })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();
  });

  it("si el efecto falla: error, «Reintentar» y no deja recibir a ciegas", () => {
    const onRetry = jest.fn();
    const { dialog } = renderModal({
      effect: { impact: null, message: "Compra no encontrada", onRetry, status: "error" },
    });

    expect(dialog.getByRole("alert")).toHaveTextContent("Compra no encontrada");
    expect(dialog.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();

    fireEvent.click(dialog.getByRole("button", { name: "Reintentar" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("si la RPC rechazaría la recepción: bloqueada con el motivo tal cual, sin botón y con las líneas editables", () => {
    const reason =
      "Sin receta de apertura activa: Caja de refrescos. Desmarca «Desarmar al recibir» en esas líneas o activa su receta";
    const onDisassembleChange = jest.fn();
    const { dialog } = renderModal({
      effect: { impact: rejectedPurchaseImpact("receive", reason), status: "blocked" },
      lines: [{ ...LINES[0]!, canDisassemble: true }],
      onDisassembleChange,
    });

    expect(dialog.getByRole("alert")).toHaveTextContent(reason);
    expect(dialog.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();
    expect(dialog.queryByText("Qué va a pasar")).not.toBeInTheDocument();

    fireEvent.click(dialog.getByRole("switch", { name: "Desarmar al recibir" }));

    expect(onDisassembleChange).toHaveBeenCalledWith("item-harina", true);
  });

  it("recalculando tras un cambio: el efecto anterior queda atenuado y no se puede confirmar", () => {
    const { dialog, onConfirm } = renderModal({
      effect: { impact: IMPACT, recalculating: true, status: "ready" },
    });

    expect(dialog.getByText("Recalculando el efecto con los cambios…")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();

    const busy = dialog.getByRole("button", { name: /Procesando/ });

    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("con un reparto que no cuadra no enseña un efecto que no es el que se enviaría", () => {
    const { dialog } = renderModal({
      lines: [
        {
          ...LINES[0]!,
          canDisassemble: true,
          disassemble: {
            canAdjustDistribution: true,
            components: [],
            distributionError: "Faltan 1 unidad(es) por repartir: el reparto debe sumar 18.",
            packsOut: 3,
          },
        },
      ],
    });

    expect(
      dialog.getByText(
        "El reparto de un surtido no cuadra: corrígelo para ver el stock y el costo que quedarán.",
      ),
    ).toBeInTheDocument();
    expect(dialog.queryByRole("list", { name: "Stock y costo por producto" })).not.toBeInTheDocument();
  });
});
