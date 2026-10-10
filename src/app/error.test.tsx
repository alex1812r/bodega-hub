/**
 * POS-H4: redes de seguridad de la raíz. `error.tsx` (dentro del layout raíz),
 * `global-error.tsx` (lo sustituye) y `not-found.tsx` hablan español, con el
 * tema, y nunca enseñan el mensaje interno del error.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { themeStorageKey } from "@/shared/theme/theme";

import RootError from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";
import SalesCreateError from "./sales/create/error";

const INTERNAL = 'Cannot read properties of null (reading "toFixed")';

function internalError(digest?: string) {
  const error: Error & { digest?: string } = new Error(INTERNAL);

  if (digest) {
    error.digest = digest;
  }

  return error;
}

describe("error.tsx, global-error.tsx y not-found.tsx de la raíz (POS-H4)", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    document.documentElement.classList.remove("light", "dark");
  });

  it("error.tsx: estado en español con «Reintentar» y «Volver al inicio»; no filtra el mensaje", async () => {
    const retry = jest.fn();

    render(<RootError error={internalError("digest-raiz-1")} unstable_retry={retry} />);

    expect(screen.getByRole("heading", { name: "Algo salió mal" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    expect(screen.getByText(/Referencia para soporte/)).toHaveTextContent("digest-raiz-1");
    expect(document.body.textContent).not.toMatch(/This page|Reload|toFixed|Cannot read/);
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: INTERNAL }));

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("global-error.tsx: trae su <html lang=\"es\">, aplica el tema guardado, reintenta y no filtra el mensaje", async () => {
    const retry = jest.fn();

    window.localStorage.setItem(themeStorageKey, "dark");
    render(<GlobalError error={internalError()} unstable_retry={retry} />);

    expect(document.documentElement).toHaveAttribute("lang", "es");
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("heading", { name: "Algo salió mal" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    expect(document.body.textContent).not.toMatch(/This page|Reload|toFixed|Cannot read/);

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("not-found.tsx: «No encontramos esta página» con enlace al inicio", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: "No encontramos esta página" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("/sales/create: estado propio del POS (dentro del shell del layout), reintenta y no filtra el mensaje", async () => {
    const retry = jest.fn();

    render(<SalesCreateError error={internalError()} unstable_retry={retry} />);

    expect(screen.getByRole("heading", { name: "No pudimos mostrar el punto de venta" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/toFixed|Cannot read/);

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
