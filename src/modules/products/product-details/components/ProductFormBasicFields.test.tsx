import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import type { CategoryMock } from "@/shared/mocks/erp-data";

import {
  CATEGORY_REQUIRED_MESSAGE,
  ProductFormBasicFields,
} from "./ProductFormBasicFields";

const categories: CategoryMock[] = [
  { id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 },
  { id: "cat-2", isActive: true, name: "Víveres", taxRate: 16 },
];

type HarnessProps = {
  categoryId?: string;
  defaults?: Parameters<typeof ProductFormBasicFields>[0]["defaults"];
  name?: string;
  onSubmit: (categoryId: string) => void;
};

function Harness({ categoryId: initialCategoryId = "", defaults = {}, name: initialName = "Harina", onSubmit }: HarnessProps) {
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [name, setName] = useState(initialName);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(String(new FormData(event.currentTarget).get("categoryId") ?? ""));
      }}
    >
      <ProductFormBasicFields
        categories={categories}
        categoryId={categoryId}
        defaults={defaults}
        name={name}
        onCategoryChange={setCategoryId}
        onNameChange={setName}
      />
      <button type="submit">Guardar</button>
    </form>
  );
}

function categorySelect() {
  return screen.getByLabelText("Categoría");
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
}

describe("ProductFormBasicFields · categoría obligatoria (PRO-F10 · M3)", () => {
  it("un alta sin categoría no se envía: muestra «Elige una categoría.» y enfoca el selector", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    expect(screen.queryByText(CATEGORY_REQUIRED_MESSAGE)).not.toBeInTheDocument();

    save();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(CATEGORY_REQUIRED_MESSAGE).toBe("Elige una categoría.");
    expect(screen.getByText(CATEGORY_REQUIRED_MESSAGE)).toBeVisible();
    expect(categorySelect()).toHaveAttribute("aria-invalid", "true");
    expect(categorySelect()).toHaveAccessibleDescription(CATEGORY_REQUIRED_MESSAGE);
    expect(categorySelect()).toHaveFocus();
  });

  it("al elegir una categoría el aviso desaparece y el alta se envía con ella", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    save();
    fireEvent.change(categorySelect(), { target: { value: "cat-2" } });

    expect(screen.queryByText(CATEGORY_REQUIRED_MESSAGE)).not.toBeInTheDocument();
    expect(categorySelect()).not.toHaveAttribute("aria-invalid");

    save();

    expect(onSubmit).toHaveBeenCalledWith("cat-2");
  });

  it("si el nombre también falta, el aviso de categoría se muestra pero no le quita el foco al primer campo", () => {
    const onSubmit = jest.fn();
    render(<Harness name="" onSubmit={onSubmit} />);

    save();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(CATEGORY_REQUIRED_MESSAGE)).toBeVisible();
    expect(categorySelect()).not.toHaveFocus();
  });

  it("un alta precargada con categoría se envía sin aviso", () => {
    const onSubmit = jest.fn();
    render(<Harness categoryId="cat-1" defaults={{ categoryId: "cat-1" }} onSubmit={onSubmit} />);

    save();

    expect(onSubmit).toHaveBeenCalledWith("cat-1");
  });

  it("un producto antiguo sin categoría se puede guardar sin elegirla", () => {
    const onSubmit = jest.fn();
    render(<Harness defaults={{ id: "prod-1" }} onSubmit={onSubmit} />);

    save();

    expect(onSubmit).toHaveBeenCalledWith("");
    expect(screen.queryByText(CATEGORY_REQUIRED_MESSAGE)).not.toBeInTheDocument();
  });

  it("a un producto que tiene categoría no se le puede quitar", () => {
    const onSubmit = jest.fn();
    render(
      <Harness
        categoryId="cat-1"
        defaults={{ categoryId: "cat-1", id: "prod-1" }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(categorySelect(), { target: { value: "" } });
    save();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(CATEGORY_REQUIRED_MESSAGE)).toBeVisible();
    expect(categorySelect()).toHaveFocus();
  });

  it("un producto cuya categoría ya no está entre las opciones (inactiva) se puede guardar", () => {
    const onSubmit = jest.fn();
    render(
      <Harness
        categoryId="cat-inactiva"
        defaults={{ categoryId: "cat-inactiva", id: "prod-1" }}
        onSubmit={onSubmit}
      />,
    );

    save();

    expect(onSubmit).toHaveBeenCalledWith("");
  });
});
