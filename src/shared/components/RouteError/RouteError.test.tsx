import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RouteError } from "./RouteError";

const INTERNAL = 'Cannot read properties of null (reading "toFixed")';

function internalError(digest?: string) {
  const error: Error & { digest?: string } = new Error(INTERNAL);

  error.stack = "Error: at SecretComponent (secret-file.tsx:12:3)";

  if (digest) {
    error.digest = digest;
  }

  return error;
}

describe("RouteError", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("muestra título y texto en español, «Reintentar» y «Volver al inicio», sin proveedores", () => {
    render(<RouteError error={internalError()} retry={jest.fn()} title="Algo salió mal" />);

    expect(screen.getByRole("heading", { name: "Algo salió mal" })).toBeInTheDocument();
    expect(screen.getByText(/Ocurrió un error inesperado al mostrar esta página/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });

  it("no filtra el mensaje ni la traza del error; lo deja en la consola", () => {
    render(<RouteError error={internalError()} retry={jest.fn()} title="Algo salió mal" />);

    expect(document.body.textContent).not.toMatch(/toFixed|Cannot read|SecretComponent|secret-file/);
    expect(screen.queryByText(/Referencia para soporte/)).not.toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: INTERNAL }));
  });

  it("muestra el `digest` como referencia para soporte cuando existe", () => {
    render(<RouteError error={internalError("3912847561")} retry={jest.fn()} title="Algo salió mal" />);

    expect(screen.getByText(/Referencia para soporte/)).toHaveTextContent(
      "Referencia para soporte: 3912847561",
    );
    expect(document.body.textContent).not.toMatch(/toFixed/);
  });

  it("«Reintentar» llama a `retry` una vez", async () => {
    const retry = jest.fn();

    render(<RouteError error={internalError()} retry={retry} title="Algo salió mal" />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("con `queryKey` descarta solo esas consultas antes de reintentar", async () => {
    const retry = jest.fn();
    const client = new QueryClient();

    client.setQueryData(["dashboard", "summary"], { totalRef: null });
    client.setQueryData(["products", "list"], { items: [] });
    render(
      <QueryClientProvider client={client}>
        <RouteError error={internalError()} queryKey={["dashboard"]} retry={retry} title="Algo salió mal" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["dashboard", "summary"])).toBeUndefined();
    expect(client.getQueryData(["products", "list"])).toEqual({ items: [] });
  });

  it("sin `queryKey` no toca la caché", async () => {
    const client = new QueryClient();

    client.setQueryData(["products", "list"], { items: [] });
    render(
      <QueryClientProvider client={client}>
        <RouteError error={internalError()} retry={jest.fn()} title="Algo salió mal" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(client.getQueryData(["products", "list"])).toEqual({ items: [] });
  });

  it("`homeHref={null}` oculta el enlace al inicio", () => {
    render(<RouteError error={internalError()} homeHref={null} retry={jest.fn()} title="Algo salió mal" />);

    expect(screen.queryByRole("link", { name: "Volver al inicio" })).not.toBeInTheDocument();
  });
});
