import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import type { PackDistributionValue } from "../utils/packDistribution";
import { PackDistributionFields, type PackDistributionFieldComponent } from "./PackDistributionFields";

/** Surtido de 6: 2 Cola + 2 Manzana + 2 Naranja por empaque. */
const RECIPE: PackDistributionFieldComponent[] = [
  { name: "Cola", unitProductId: "cola", unitsPerPack: 2 },
  { name: "Manzana", unitProductId: "manzana", unitsPerPack: 2 },
  { name: "Naranja", unitProductId: "naranja", unitsPerPack: 2 },
];

function Harness({
  components = RECIPE,
  disabled,
  initial = {},
  onChange,
  packQuantity = 3,
}: {
  components?: PackDistributionFieldComponent[];
  disabled?: boolean;
  initial?: PackDistributionValue;
  onChange?: (value: PackDistributionValue) => void;
  packQuantity?: number;
}) {
  const [value, setValue] = useState(initial);

  return (
    <PackDistributionFields
      components={components}
      disabled={disabled}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
      packQuantity={packQuantity}
      value={value}
    />
  );
}

function field(name: string) {
  return screen.getByRole("textbox", { name: `Unidades de ${name}` }) as HTMLInputElement;
}

async function type(user: ReturnType<typeof userEvent.setup>, name: string, text: string) {
  await user.clear(field(name));
  if (text) {
    await user.type(field(name), text);
  }
}

describe("PackDistributionFields", () => {
  it("abre con la receta × empaques, la suma cuadrada y sin aviso", () => {
    render(<Harness />);

    expect(screen.getByRole("group", { name: "Reparto de unidades" })).toBeInTheDocument();
    expect(["Cola", "Manzana", "Naranja"].map((name) => field(name).value)).toEqual(["6", "6", "6"]);
    expect(screen.getByText("18 de 18 unidades")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restablecer receta" })).toBeDisabled();
    expect(screen.queryByText(/Faltan|Sobran/)).not.toBeInTheDocument();
  });

  it("los campos son de texto con teclado numérico (NumberInput), no type=number", () => {
    render(<Harness />);

    expect(field("Cola")).not.toHaveAttribute("type", "number");
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it("3 empaques con uno a 3-1-2: 7 / 5 / 6 suma 18 y no avisa; onChange entrega el texto de todos los campos", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();

    render(<Harness onChange={onChange} />);
    await type(user, "Cola", "7");
    await type(user, "Manzana", "5");

    expect(onChange).toHaveBeenLastCalledWith({ cola: "7", manzana: "5", naranja: "6" });
    expect(screen.getByText("18 de 18 unidades")).toBeInTheDocument();
    expect(screen.queryByText(/Faltan|Sobran/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restablecer receta" })).toBeEnabled();
  });

  it("si la suma no cuadra dice cuánto falta o sobra, en una región viva", async () => {
    const user = userEvent.setup();

    render(<Harness />);
    await type(user, "Naranja", "5");

    const short = screen.getByText("Faltan 1 unidad(es) por repartir: el reparto debe sumar 18.");

    expect(short.parentElement).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("17 de 18 unidades")).toBeInTheDocument();

    await type(user, "Naranja", "9");

    expect(screen.getByText("Sobran 3 unidad(es): el reparto debe sumar 18.")).toBeInTheDocument();
  });

  it("un campo vacío reparte 0 y un decimal invalida el reparto", async () => {
    const user = userEvent.setup();

    render(<Harness />);
    await type(user, "Cola", "");

    expect(screen.getByText("Faltan 6 unidad(es) por repartir: el reparto debe sumar 18.")).toBeInTheDocument();

    await type(user, "Cola", "6.5");

    expect(
      screen.getByText("Las unidades del reparto deben ser enteros mayores o iguales a cero."),
    ).toBeInTheDocument();
  });

  it("«Restablecer receta» pide volver a la receta con un valor vacío", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();

    render(<Harness initial={{ cola: "9" }} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Restablecer receta" }));

    expect(onChange).toHaveBeenLastCalledWith({});
    expect(["Cola", "Manzana", "Naranja"].map((name) => field(name).value)).toEqual(["6", "6", "6"]);
  });

  it("al cambiar los empaques, lo que no se tocó sigue a la receta y la suma se compara con el nuevo total", () => {
    const { rerender } = render(
      <PackDistributionFields components={RECIPE} onChange={jest.fn()} packQuantity={1} value={{ cola: "3" }} />,
    );

    expect(["Cola", "Manzana", "Naranja"].map((name) => field(name).value)).toEqual(["3", "2", "2"]);
    expect(screen.getByText("Sobran 1 unidad(es): el reparto debe sumar 6.")).toBeInTheDocument();

    rerender(
      <PackDistributionFields components={RECIPE} onChange={jest.fn()} packQuantity={2} value={{ cola: "3" }} />,
    );

    expect(["Cola", "Manzana", "Naranja"].map((name) => field(name).value)).toEqual(["3", "4", "4"]);
    expect(screen.getByText("Faltan 1 unidad(es) por repartir: el reparto debe sumar 12.")).toBeInTheDocument();
  });

  it("muestra SKU y stock si se pasan y avisa del componente inactivo que recibe unidades", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        components={[
          { currentStock: 4, name: "Cola", sku: "ref-cola", unitProductId: "cola", unitsPerPack: 3 },
          { isActive: false, name: "Uva", unitProductId: "uva", unitsPerPack: 3 },
        ]}
        packQuantity={1}
      />,
    );

    const group = screen.getByRole("group", { name: "Reparto de unidades" });

    expect(within(group).getByText("ref-cola · Stock actual 4")).toBeInTheDocument();
    expect(within(group).getByText("Uva (inactivo)")).toBeInTheDocument();
    expect(
      within(group).getByText("Uva está inactivo: recibirá stock, pero no se podrá vender hasta activarlo."),
    ).toBeInTheDocument();

    await type(user, "Uva", "0");

    expect(within(group).queryByText(/Uva está inactivo/)).not.toBeInTheDocument();
  });

  it("deshabilitado no deja teclear ni restablecer", () => {
    render(<Harness disabled initial={{ cola: "9" }} />);

    expect(field("Cola")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restablecer receta" })).toBeDisabled();
  });
});
