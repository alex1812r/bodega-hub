import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps } from "react";

import { useProcessGuard } from "@/shared/hooks/useProcessGuard";
import { withReturnTo } from "@/shared/utils/returnTo";

import { PageBackButton } from "./PageBackButton";

const mockPush = jest.fn();
const mockUseRouter = jest.fn();
const mockUsePathname = jest.fn();
const mockUseSearchParams = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => mockUseRouter(),
  useSearchParams: () => mockUseSearchParams(),
}));

type MockLinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string;
  onNavigate?: (event: { preventDefault: () => void }) => void;
  replace?: boolean;
};

const mockLinkNavigate = jest.fn();

// Reproduce el contrato de `next/link`: `onNavigate` solo corre en navegación
// de cliente y puede cancelarla con `preventDefault()`.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, onNavigate, replace, ...props }: MockLinkProps) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();

        let prevented = false;

        onNavigate?.({
          preventDefault: () => {
            prevented = true;
          },
        });

        if (!prevented) {
          mockLinkNavigate(href, replace ?? false);
        }
      }}
    />
  ),
}));

const LIST_URL = "/products?search=coca+cola&categoria=bebidas&page=3";

function setUrl(query: string) {
  mockUseSearchParams.mockReturnValue(new URLSearchParams(query));
}

/** Deja la URL del detalle tal como queda al pulsar el enlace de fila `href`. */
function openDetail(href: string) {
  setUrl(href.includes("?") ? href.slice(href.indexOf("?") + 1) : "");
}

function backLink() {
  return screen.getByRole("link", { name: /volver/i });
}

function pressAltLeft(target: Element | Window = window) {
  const event = new KeyboardEvent("keydown", {
    altKey: true,
    bubbles: true,
    cancelable: true,
    key: "ArrowLeft",
  });

  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}

function pressEscape(target: Element | Window = window) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });

  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRouter.mockReturnValue({ push: mockPush });
  mockUsePathname.mockReturnValue("/products/p-1");
  setUrl("");
});

describe("PageBackButton", () => {
  describe("destino", () => {
    it("ida y vuelta: lista → detalle → Volver apunta a la URL exacta de la lista", () => {
      openDetail(withReturnTo("/products/p-1", LIST_URL));
      render(<PageBackButton fallbackHref="/products" />);

      expect(backLink()).toHaveAttribute("href", LIST_URL);
    });

    it("conserva returnTo al recargar el detalle y con otros parámetros en la URL", () => {
      openDetail(withReturnTo("/products/p-1?tab=stock", LIST_URL));

      const first = render(<PageBackButton fallbackHref="/products" />);

      expect(backLink()).toHaveAttribute("href", LIST_URL);

      // Recarga: se monta de nuevo con la misma URL.
      first.unmount();
      render(<PageBackButton fallbackHref="/products" />);

      expect(backLink()).toHaveAttribute("href", LIST_URL);
    });

    it("sin returnTo usa fallbackHref", () => {
      render(<PageBackButton fallbackHref="/products" />);

      expect(backLink()).toHaveAttribute("href", "/products");
    });

    it("ida y vuelta con una lista filtrada por fechas: Volver conserva from y to", () => {
      const listUrl = "/sales?from=2026-10-01&to=2026-10-31&status=paid";

      openDetail(withReturnTo("/sales/123", listUrl));
      render(<PageBackButton fallbackHref="/sales" />);

      expect(backLink()).toHaveAttribute("href", listUrl);
    });

    it.each([
      ["una ruta interna", "/sales?page=2"],
      ["un origen externo", "//evil.com"],
      ["una fecha", "2026-10-01"],
    ])("ignora un from con %s en la URL del detalle: no es el parámetro de retorno", (_label, from) => {
      setUrl(new URLSearchParams({ from }).toString());
      render(<PageBackButton fallbackHref="/products" />);

      expect(backLink()).toHaveAttribute("href", "/products");
    });

    it.each([
      ["URL absoluta", "https://evil.com"],
      ["protocolo relativo", "//evil.com"],
      ["barras invertidas", "\\\\evil.com"],
      ["barra y barra invertida", "/\\evil.com"],
      ["javascript:", "javascript:alert(1)"],
      ["data:", "data:text/html,hola"],
      ["salto de línea", "/products\nx"],
      ["tabulador", "/\t/evil.com"],
      ["codificación doble", "%2F%2Fevil.com"],
      ["barra invertida codificada", "/%5Cevil.com"],
      ["ruta relativa", "products"],
      ["ruta a la API", "/api/products"],
      ["demasiado largo", `/products?search=${"a".repeat(2100)}`],
    ])("rechaza un returnTo con %s y usa fallbackHref", (_label, returnTo) => {
      setUrl(new URLSearchParams({ returnTo }).toString());
      render(<PageBackButton fallbackHref="/products" />);

      expect(backLink()).toHaveAttribute("href", "/products");
    });

    it("es un enlace real con la etiqueta indicada", () => {
      render(<PageBackButton fallbackHref="/cash/registers" label="Volver a cajas" />);

      const link = screen.getByRole("link", { name: "Volver a cajas" });

      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", "/cash/registers");
    });
  });

  describe("compatibilidad con href", () => {
    it("href sigue funcionando igual y no emite avisos", () => {
      const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

      render(<PageBackButton className="shrink-0" href="/purchases" size="sm" />);

      expect(backLink()).toHaveAttribute("href", "/purchases");
      expect(backLink()).toHaveClass("shrink-0");
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();

      error.mockRestore();
      warn.mockRestore();
    });

    it("con solo href es el enlace fijo de siempre: no lee la URL ni usa el router", () => {
      openDetail(withReturnTo("/purchases/c-1", "/purchases?estado=pending"));
      mockUseSearchParams.mockClear();
      render(<PageBackButton href="/purchases" />);

      expect(backLink()).toHaveAttribute("href", "/purchases");
      expect(mockUseSearchParams).not.toHaveBeenCalled();
      expect(mockUseRouter).not.toHaveBeenCalled();
    });

    it("con href los atajos quedan apagados salvo que se pidan", () => {
      const legacy = render(<PageBackButton href="/sales" />);

      expect(pressEscape().defaultPrevented).toBe(false);
      expect(pressAltLeft().defaultPrevented).toBe(false);
      expect(mockPush).not.toHaveBeenCalled();

      legacy.unmount();
      render(<PageBackButton href="/sales" shortcuts />);
      pressEscape();

      expect(mockPush).toHaveBeenCalledWith("/sales");
    });

    it("si llegan los dos, manda fallbackHref", () => {
      render(<PageBackButton fallbackHref="/products" href="/otra" />);

      expect(backLink()).toHaveAttribute("href", "/products");
    });
  });

  describe("atajos de teclado", () => {
    it("Esc vuelve a returnTo", () => {
      openDetail(withReturnTo("/products/p-1", LIST_URL));
      render(<PageBackButton fallbackHref="/products" />);

      pressEscape();

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(LIST_URL);
    });

    it("Alt+← vuelve y hace preventDefault para no duplicar el atrás nativo", () => {
      render(<PageBackButton fallbackHref="/products" />);

      const event = pressAltLeft();

      expect(event.defaultPrevented).toBe(true);
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith("/products");
    });

    it("anuncia los atajos en el enlace", () => {
      render(<PageBackButton fallbackHref="/products" />);

      expect(backLink()).toHaveAttribute("aria-keyshortcuts", "Escape Alt+ArrowLeft");
    });

    it.each([
      ["dialog", <div key="o" role="dialog" />],
      ["alertdialog", <div key="o" role="alertdialog" />],
      ["listbox", <ul key="o" role="listbox" />],
      ["menu", <div key="o" role="menu" />],
      ["popover de Radix", <div data-radix-popper-content-wrapper="" key="o" />],
      ["disparador desplegado", <button aria-expanded="true" aria-haspopup="menu" key="o" />],
    ])("no actúa con %s abierto", (_label, overlay) => {
      render(
        <>
          <PageBackButton fallbackHref="/products" />
          {overlay}
        </>,
      );

      expect(pressEscape().defaultPrevented).toBe(false);
      expect(pressAltLeft().defaultPrevented).toBe(false);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("no actúa si el diálogo se cierra con la misma tecla antes de que burbujee", () => {
      render(
        <>
          <PageBackButton fallbackHref="/products" />
          <div data-testid="modal" role="dialog" />
        </>,
      );

      const modal = screen.getByTestId("modal");
      const closeOnEscape = () => modal.removeAttribute("role");

      document.addEventListener("keydown", closeOnEscape, true);
      pressEscape();
      document.removeEventListener("keydown", closeOnEscape, true);

      expect(mockPush).not.toHaveBeenCalled();
    });

    it("ignora una lista desplegable oculta", () => {
      render(
        <>
          <PageBackButton fallbackHref="/products" />
          <ul hidden role="listbox" />
        </>,
      );

      pressEscape();

      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["input", <input aria-label="campo" key="f" />],
      ["textarea", <textarea aria-label="campo" key="f" />],
      [
        "select",
        <select aria-label="campo" key="f">
          <option>a</option>
        </select>,
      ],
      [
        "contenteditable",
        <div aria-label="campo" contentEditable key="f" role="textbox" suppressContentEditableWarning tabIndex={0} />,
      ],
    ])("no actúa con el foco en %s", (_label, field) => {
      render(
        <>
          <PageBackButton fallbackHref="/products" />
          {field}
        </>,
      );

      const element = screen.getByLabelText("campo");

      act(() => element.focus());

      expect(pressEscape(element).defaultPrevented).toBe(false);
      expect(pressAltLeft(element).defaultPrevented).toBe(false);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("no actúa si otro manejador ya hizo preventDefault", () => {
      render(
        <>
          <PageBackButton fallbackHref="/products" />
          <div data-testid="zona" onKeyDown={(event) => event.preventDefault()} tabIndex={0} />
        </>,
      );

      fireEvent.keyDown(screen.getByTestId("zona"), { key: "Escape" });
      fireEvent.keyDown(screen.getByTestId("zona"), { altKey: true, key: "ArrowLeft" });

      expect(mockPush).not.toHaveBeenCalled();
    });

    it("ignora otras teclas y combinaciones", () => {
      render(<PageBackButton fallbackHref="/products" />);

      fireEvent.keyDown(window, { key: "ArrowLeft" });
      fireEvent.keyDown(window, { altKey: true, key: "ArrowRight" });
      fireEvent.keyDown(window, { altKey: true, ctrlKey: true, key: "ArrowLeft" });
      fireEvent.keyDown(window, { key: "Escape", shiftKey: true });
      fireEvent.keyDown(window, { key: "Escape", repeat: true });

      expect(mockPush).not.toHaveBeenCalled();
    });

    it("shortcuts={false} los desactiva", () => {
      render(<PageBackButton fallbackHref="/products" shortcuts={false} />);

      expect(pressEscape().defaultPrevented).toBe(false);
      expect(pressAltLeft().defaultPrevented).toBe(false);
      expect(mockPush).not.toHaveBeenCalled();
      expect(backLink()).not.toHaveAttribute("aria-keyshortcuts");
    });

    it("con dos botones montados navega una sola vez", () => {
      render(
        <>
          <PageBackButton fallbackHref="/products" />
          <PageBackButton fallbackHref="/products" />
        </>,
      );

      pressEscape();

      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("deja de escuchar al desmontarse", () => {
      const view = render(<PageBackButton fallbackHref="/products" />);

      view.unmount();
      pressEscape();

      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("guardia de proceso", () => {
    function GuardedScreen() {
      const guard = useProcessGuard({ active: true, label: "Compra en curso", onLeave: "discard" });

      return (
        <>
          <PageBackButton fallbackHref="/purchases" />
          <p>{guard.dialog.open ? "guardia preguntando" : "guardia en reposo"}</p>
        </>
      );
    }

    it("Esc pregunta al guardia activo en vez de navegar", () => {
      render(<GuardedScreen />);

      pressEscape();

      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.getByText("guardia preguntando")).toBeInTheDocument();
    });

    it("el clic en el enlace pregunta al guardia activo", async () => {
      const user = userEvent.setup();
      render(<GuardedScreen />);

      await user.click(backLink());

      expect(screen.getByText("guardia preguntando")).toBeInTheDocument();
      expect(mockLinkNavigate).not.toHaveBeenCalled();
    });

    it("sin guardia, el clic navega a la lista de origen", async () => {
      const user = userEvent.setup();
      openDetail(withReturnTo("/products/p-1", LIST_URL));
      render(<PageBackButton fallbackHref="/products" />);

      await user.click(backLink());

      expect(mockLinkNavigate).toHaveBeenCalledWith(LIST_URL, false);
    });
  });
});
