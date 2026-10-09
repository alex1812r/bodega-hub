import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";

import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import {
  createDefaultPackConversionFormState,
  type PackConversionFormState,
  packConversionStateToInput,
  ProductPackConversionFields,
} from "./ProductPackConversionFields";

/**
 * COM-14 · casilla «Desarmar siempre al recibir compras» del formulario de la
 * receta: muestra la preferencia guardada y solo viaja al guardar si el usuario
 * la tocó (ausente = no cambia).
 */

const CHECKBOX = "Desarmar siempre al recibir compras";

function linkedPack(extra: Partial<ProductPackConversionSummary> = {}): ProductPackConversionSummary {
  return {
    id: "ppc-caja",
    linkedProduct: {
      currentCostRef: 1,
      currentStock: 3,
      id: "prod-lata",
      name: "Lata suelta",
      salePriceRef: 2,
      sku: "lata-001",
    },
    role: "pack",
    unitsPerPack: 12,
    ...extra,
  };
}

let lastState: PackConversionFormState;

function rememberState(state: PackConversionFormState) {
  lastState = state;
}

function Harness({ packConversion }: { packConversion?: ProductPackConversionSummary }) {
  const [state, setState] = useState<PackConversionFormState>(() =>
    packConversion
      ? createDefaultPackConversionFormState(packConversion)
      : { ...createDefaultPackConversionFormState(), enabled: true },
  );

  useEffect(() => rememberState(state), [state]);

  return (
    <ProductPackConversionFields
      onChange={(patch) => setState((current) => ({ ...current, ...patch }))}
      packConversion={packConversion}
      productName="Caja de latas"
      state={state}
    />
  );
}

describe("ProductPackConversionFields · «Desarmar siempre al recibir compras» (COM-14)", () => {
  it("la casilla sale con el empaque activo, desmarcada y con su línea de ayuda", () => {
    render(<Harness />);

    const checkbox = screen.getByRole("checkbox", { name: CHECKBOX });

    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAccessibleDescription(
      "Al comprar este empaque, la línea nace marcada «Desarmar al recibir»; se puede desmarcar en cada compra.",
    );
  });

  it("con «Se puede vender por unidad» apagado no hay casilla", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Se puede vender por unidad" }));

    expect(screen.queryByRole("checkbox", { name: CHECKBOX })).not.toBeInTheDocument();
  });

  it("sin tocarla, la receta se guarda sin nombrar la preferencia", () => {
    render(<Harness packConversion={linkedPack({ alwaysDisassembleOnReceive: true })} />);

    expect(screen.getByRole("checkbox", { name: CHECKBOX })).toBeChecked();
    expect(packConversionStateToInput(lastState)).not.toHaveProperty("alwaysDisassembleOnReceive");
  });

  it("marcarla envía alwaysDisassembleOnReceive: true; desmarcar la guardada, false", () => {
    const { unmount } = render(<Harness packConversion={linkedPack()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: CHECKBOX }));

    expect(screen.getByRole("checkbox", { name: CHECKBOX })).toBeChecked();
    expect(packConversionStateToInput(lastState)).toMatchObject({
      alwaysDisassembleOnReceive: true,
      mode: "link_existing",
    });

    unmount();
    render(<Harness packConversion={linkedPack({ alwaysDisassembleOnReceive: true })} />);
    fireEvent.click(screen.getByRole("checkbox", { name: CHECKBOX }));

    expect(screen.getByRole("checkbox", { name: CHECKBOX })).not.toBeChecked();
    expect(packConversionStateToInput(lastState)).toMatchObject({
      alwaysDisassembleOnReceive: false,
    });
  });

  it("viaja en los tres modos de la receta y nunca al desactivarla", () => {
    const base = { ...createDefaultPackConversionFormState(), alwaysDisassembleOnReceive: true, enabled: true };

    for (const mode of ["assorted", "create_unit", "link_existing"] as const) {
      expect(packConversionStateToInput({ ...base, mode })).toMatchObject({
        alwaysDisassembleOnReceive: true,
        mode,
      });
    }

    expect(packConversionStateToInput({ ...base, enabled: false })).toEqual({ enabled: false });
  });

  it("la preferencia de la receta de la que el producto es UNIDAD no marca su casilla", () => {
    const state = createDefaultPackConversionFormState(
      linkedPack({ alwaysDisassembleOnReceive: true, role: "unit" }),
    );

    expect(state.alwaysDisassembleOnReceive).toBeUndefined();
    expect(state.enabled).toBe(false);
  });
});
