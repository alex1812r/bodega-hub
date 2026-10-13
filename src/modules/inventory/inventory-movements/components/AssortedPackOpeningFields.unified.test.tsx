import { fireEvent, render, screen } from "@testing-library/react";

import type { AssortedPackOpening } from "../hooks/useAssortedPackOpening";
import { computePackOpeningEffect } from "../utils/packOpeningEffect";
import { checkPackDistribution, parsePackDistribution } from "../utils/packDistribution";

import { AssortedPackOpeningFields } from "./AssortedPackOpeningFields";
import { PackDistributionFields } from "./PackDistributionFields";

/**
 * INT-02 · B1 — UN solo control de reparto de surtido. La apertura de empaque
 * (INV-08: modal de Inventario y detalle del producto) y «Desarmar al recibir»
 * (COM-14) pintan `PackDistributionFields`, y la aritmética del reparto sale de
 * `computePackOpeningEffect` en los dos caminos.
 */

jest.mock("./PackDistributionFields", () => {
  const actual = jest.requireActual("./PackDistributionFields");

  return { ...actual, PackDistributionFields: jest.fn(actual.PackDistributionFields) };
});

const COMPONENTS = [
  { currentStock: 4, isActive: true, name: "Cola", sku: "COLA", unitProductId: "cola", unitsPerPack: 3 },
  { currentStock: 0, isActive: false, name: "Uva", sku: "UVA", unitProductId: "uva", unitsPerPack: 2 },
  { currentStock: 9, isActive: true, name: "Naranja", sku: "NAR", unitProductId: "naranja", unitsPerPack: 1 },
];

function openingOf(texts: Record<string, string> | null, packQuantity = 2) {
  const values = Object.fromEntries(
    COMPONENTS.map((component) => [
      component.unitProductId,
      texts?.[component.unitProductId] ?? String(component.unitsPerPack * packQuantity),
    ]),
  );
  const setValues = jest.fn();
  const resetDistribution = jest.fn();
  const opening = {
    components: COMPONENTS,
    effect: computePackOpeningEffect({
      distribution: Object.fromEntries(Object.entries(values).map(([id, text]) => [id, Number(text)])),
      packQuantity,
      recipe: { components: COMPONENTS, pack: { currentStock: 10, name: "Surtido" } },
    }),
    isEdited: texts !== null,
    packQuantity,
    resetDistribution,
    setValues,
    showsDistribution: true,
    values,
  } as unknown as AssortedPackOpening;

  return { opening, resetDistribution, setValues };
}

const mockedControl = PackDistributionFields as unknown as jest.Mock;

beforeEach(() => {
  mockedControl.mockClear();
});

describe("AssortedPackOpeningFields pinta el control único PackDistributionFields", () => {
  it("le pasa los componentes de la receta, los empaques y lo tecleado; sin tocar, el reparto vacío (= receta)", () => {
    const untouched = openingOf(null);

    render(<AssortedPackOpeningFields opening={untouched.opening} />);

    expect(mockedControl).toHaveBeenCalledTimes(1);
    expect(mockedControl.mock.calls[0][0]).toMatchObject({
      components: COMPONENTS,
      packQuantity: 2,
      value: {},
    });
    expect(screen.getByLabelText("Unidades de Cola")).toHaveValue("6");
    expect(screen.getByText("12 de 12 unidades")).toBeInTheDocument();
    // Sin tocar no hay nada que restablecer (comportamiento del control único).
    expect(screen.getByRole("button", { name: "Restablecer receta" })).toBeDisabled();

    mockedControl.mockClear();
    const edited = openingOf({ cola: "8", uva: "2" });

    render(<AssortedPackOpeningFields opening={edited.opening} />);

    expect(mockedControl.mock.calls[0][0]).toMatchObject({
      value: { cola: "8", naranja: "2", uva: "2" },
    });
  });

  it("teclear en un campo guarda todo el reparto en el hook y «Restablecer receta» lo devuelve a la receta", () => {
    const { opening, resetDistribution, setValues } = openingOf({ cola: "8" });

    render(<AssortedPackOpeningFields opening={opening} />);

    fireEvent.change(screen.getByLabelText("Unidades de Uva"), { target: { value: "1" } });

    expect(setValues).toHaveBeenCalledWith({ cola: "8", naranja: "2", uva: "1" });

    fireEvent.click(screen.getByRole("button", { name: "Restablecer receta" }));

    expect(resetDistribution).toHaveBeenCalledTimes(1);
  });

  it("los mismos avisos que en la recepción de compra: suma que no cuadra y producto inactivo", () => {
    const { opening } = openingOf({ cola: "8" });

    render(<AssortedPackOpeningFields opening={opening} />);

    expect(
      screen.getByText("Sobran 2 unidad(es): el reparto debe sumar 12."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Uva está inactivo: recibirá stock, pero no se podrá vender hasta activarlo.",
      ),
    ).toBeInTheDocument();
  });

  it("sin surtido o sin una cantidad de empaques válida no pinta nada", () => {
    const { opening } = openingOf(null);

    const { container } = render(
      <AssortedPackOpeningFields
        opening={{ ...opening, showsDistribution: false } as AssortedPackOpening}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(mockedControl).not.toHaveBeenCalled();
  });
});

describe("checkPackDistribution calcula con computePackOpeningEffect", () => {
  it.each([
    ["receta", {}],
    ["ajustado que cuadra", { cola: "8", uva: "2", naranja: "2" }],
    ["sobran", { cola: "9" }],
    ["faltan", { cola: "", uva: "1" }],
    ["decimales", { cola: "1,5" }],
  ])("%s: mismos totales, diferencia y unidades que el efecto de Inventario", (_name, texts) => {
    const units = parsePackDistribution(COMPONENTS, 2, texts as Record<string, string>);
    const check = checkPackDistribution(COMPONENTS, 2, units);
    const effect = computePackOpeningEffect({
      distribution: units,
      packQuantity: 2,
      recipe: { components: COMPONENTS, pack: { currentStock: 2, name: "Surtido" } },
    });

    expect({
      difference: check.difference,
      distributedTotal: check.distributedTotal,
      expectedTotal: check.expectedTotal,
      hasInvalidUnits: check.hasInvalidUnits,
      isValid: check.isValid,
    }).toEqual({
      difference: effect.difference,
      distributedTotal: effect.distributedTotal,
      expectedTotal: effect.expectedTotal,
      hasInvalidUnits: effect.issues.includes("invalid_units"),
      isValid: effect.isValid,
    });
  });
});
