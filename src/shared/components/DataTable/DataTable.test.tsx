import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";

import { DataTable, type DataTableColumn } from "./DataTable";

jest.mock("../../hooks/useMediaQuery", () => ({
  useIsBelowMd: jest.fn(() => false),
}));

type Row = {
  id: string;
  name: string;
};

const columns: DataTableColumn<Row>[] = [
  { header: "Nombre", hideInCard: true, key: "name", render: (row) => row.name },
];

describe("DataTable", () => {
  it("renders rows in table layout", () => {
    const { getByText } = render(
      <DataTable
        columns={columns}
        data={[{ id: "1", name: "Aceite 1L" }]}
        getRowId={(row) => row.id}
        layout="table"
      />,
    );

    expect(getByText("Aceite 1L")).toBeVisible();
  });

  it("renders card layout when layout is cards", () => {
    const { getByText } = render(
      <DataTable
        cardTitle={(row) => row.name}
        columns={columns}
        data={[{ id: "1", name: "Aceite 1L" }]}
        getRowId={(row) => row.id}
        layout="cards"
      />,
    );

    expect(getByText("Aceite 1L")).toBeVisible();
  });

  it("renders empty state", () => {
    const { getByText } = render(
      <DataTable columns={columns} data={[]} getRowId={(row) => row.id} layout="table" />,
    );

    expect(getByText(/no hay registros/i)).toBeVisible();
  });

  it("renders loading skeleton rows", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        data={[]}
        getRowId={(row) => row.id}
        isLoading
        layout="table"
        loadingRows={3}
      />,
    );

    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("renders error state and calls retry", () => {
    const onRetry = jest.fn();
    const { getByRole, getByText } = render(
      <DataTable
        columns={columns}
        data={[]}
        error="Error de prueba"
        getRowId={(row) => row.id}
        layout="table"
        onRetry={onRetry}
      />,
    );

    fireEvent.click(getByRole("button", { name: /reintentar/i }));

    expect(getByText(/error de prueba/i)).toBeVisible();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  describe("columna Acciones fijada", () => {
    const rows = [
      { id: "1", name: "Aceite 1L" },
      { id: "2", name: "Harina PAN" },
    ];
    const actions = () => [{ label: "Ver detalle", onSelect: jest.fn() }];

    function renderTable(variant?: "default" | "stitch" | "stitch-sales" | "stitch-purchases") {
      return render(
        <DataTable
          actions={actions}
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          layout="table"
          variant={variant}
        />,
      );
    }

    it.each([undefined, "stitch", "stitch-sales", "stitch-purchases"] as const)(
      "variante %s: el contenedor hace su propio scroll y la celda de acciones queda pegada a la derecha con fondo opaco",
      (variant) => {
        const { container, getAllByRole } = renderTable(variant);
        const cells = container.querySelectorAll("[data-table-actions-cell]");

        expect(container.querySelector("[data-table-scroll]")).toHaveClass("overflow-x-auto", "w-full");
        expect(container.querySelector("[data-table-scroll] > table")).not.toBeNull();
        expect(cells).toHaveLength(rows.length);

        cells.forEach((cell) => {
          expect(cell).toHaveClass(
            "sticky",
            "right-0",
            "bg-surface-container-lowest",
            "dark:bg-slate-900",
          );
          expect(cell.querySelector("button")).not.toBeNull();
        });

        expect(getAllByRole("button", { name: /abrir acciones/i })).toHaveLength(rows.length);
      },
    );

    it("el encabezado Acciones también queda fijado, con el fondo de la cabecera", () => {
      const { getByRole } = renderTable("stitch");

      expect(getByRole("columnheader", { name: "Acciones" })).toHaveClass(
        "sticky",
        "right-0",
        "bg-surface-container",
      );
    });

    it("la celda fijada repite el rayado y el hover de su fila", () => {
      const { container } = renderTable("stitch");
      const [even, odd] = Array.from(container.querySelectorAll("[data-table-actions-cell]"));

      expect(even).toHaveClass("group-hover:before:bg-surface-container-low");
      expect(even).not.toHaveClass("before:bg-surface-bright");
      expect(odd).toHaveClass("before:bg-surface-bright", "dark:before:bg-slate-800/40");
      expect(odd.closest("tr")).toHaveClass("group", "bg-surface-bright");
    });

    it("las tablas stitch conservan su ancho mínimo y las demás no lo tienen", () => {
      expect(renderTable("stitch").container.querySelector("table")).toHaveClass("min-w-[720px]");
      expect(renderTable().container.querySelector("table")).not.toHaveClass("min-w-[720px]");
    });

    it("sin acciones no hay columna fijada", () => {
      const { container, queryByRole } = render(
        <DataTable columns={columns} data={rows} getRowId={(row) => row.id} layout="table" />,
      );

      expect(container.querySelector("[data-table-actions-cell]")).toBeNull();
      expect(queryByRole("columnheader", { name: "Acciones" })).toBeNull();
    });
  });

  describe("renderExpandedRow", () => {
    const rows: Row[] = [
      { id: "1", name: "Aceite 1L" },
      { id: "2", name: "Harina PAN" },
      { id: "3", name: "Arroz 1 kg" },
    ];
    const actions = () => [{ label: "Ver detalle", onSelect: jest.fn() }];

    function renderTable(
      layout: "cards" | "table",
      renderExpandedRow?: (row: Row) => ReactNode,
    ) {
      return render(
        <DataTable
          actions={actions}
          cardTitle={(row) => row.name}
          columns={[...columns, { header: "Código", key: "id", render: (row) => row.id }]}
          data={rows}
          getRowId={(row) => row.id}
          layout={layout}
          renderExpandedRow={renderExpandedRow}
        />,
      );
    }

    it.each(["table", "cards"] as const)(
      "changes nothing in the %s markup without the prop or while every row is closed",
      (layout) => {
        const plain = renderTable(layout).container.innerHTML;

        expect(renderTable(layout, () => null).container.innerHTML).toBe(plain);
        expect(renderTable(layout, () => undefined).container.innerHTML).toBe(plain);
        expect(renderTable(layout, () => false).container.innerHTML).toBe(plain);
      },
    );

    it("keeps one table row per record and two blocks per card without the prop", () => {
      const table = renderTable("table").container;

      expect(table.querySelectorAll("tbody > tr")).toHaveLength(3);

      const cards = renderTable("cards").container;

      expect(cards.querySelectorAll("li")).toHaveLength(3);

      for (const card of cards.querySelectorAll("li")) {
        expect(card.children).toHaveLength(2);
      }
    });

    it("paints the expanded content in a full-width row right after its row", () => {
      const { container, getByText } = renderTable("table", (row) =>
        row.id === "2" ? <p>Detalle de {row.name}</p> : null,
      );
      const bodyRows = Array.from(container.querySelectorAll("tbody > tr"));

      expect(bodyRows).toHaveLength(4);
      expect(bodyRows[1]).toHaveTextContent("Harina PAN");

      const expandedCell = getByText("Detalle de Harina PAN").closest("td");

      expect(expandedCell?.parentElement).toBe(bodyRows[2]);
      expect(bodyRows[2].children).toHaveLength(1);
      // Dos columnas + la de acciones.
      expect(expandedCell).toHaveAttribute("colspan", "3");
      expect(expandedCell).toHaveClass("p-0");
      expect(bodyRows[3]).toHaveTextContent("Arroz 1 kg");
    });

    it("spans only the data columns when the table has no actions", () => {
      const { getByText } = render(
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          layout="table"
          renderExpandedRow={(row) => (row.id === "1" ? <p>Detalle</p> : null)}
        />,
      );

      expect(getByText("Detalle").closest("td")).toHaveAttribute("colspan", "1");
    });

    it("paints the expanded content at the foot of its card", () => {
      const { container, getByText } = renderTable("cards", (row) =>
        row.id === "2" ? <p>Detalle de {row.name}</p> : null,
      );
      const cards = Array.from(container.querySelectorAll("li"));

      expect(cards.map((card) => card.children.length)).toEqual([2, 3, 2]);
      expect(cards[1].lastElementChild).toContainElement(getByText("Detalle de Harina PAN"));
    });

    it("follows the row when the expanded one changes", () => {
      function renderExpandedRow(openId: string) {
        return function expandedRow(row: Row) {
          return row.id === openId ? <p>Detalle de {row.name}</p> : null;
        };
      }

      const props = {
        columns,
        data: rows,
        getRowId: (row: Row) => row.id,
        layout: "table" as const,
      };
      const { queryByText, rerender } = render(
        <DataTable {...props} renderExpandedRow={renderExpandedRow("1")} />,
      );

      expect(queryByText("Detalle de Aceite 1L")).toBeInTheDocument();

      rerender(<DataTable {...props} renderExpandedRow={renderExpandedRow("3")} />);

      expect(queryByText("Detalle de Aceite 1L")).not.toBeInTheDocument();
      expect(queryByText("Detalle de Arroz 1 kg")).toBeInTheDocument();
    });
  });
});
