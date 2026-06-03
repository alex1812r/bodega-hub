import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";

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
});
