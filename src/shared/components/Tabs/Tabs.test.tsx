import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Tabs, type TabItem } from "./Tabs";

const mockReplace = jest.fn();
const mockUseRouter = jest.fn();
const mockUsePathname = jest.fn();
const mockUseSearchParams = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => mockUseRouter(),
  useSearchParams: () => mockUseSearchParams(),
}));

type DemoTab = "resumen" | "ventas" | "pagos" | "notas";

const items: TabItem<DemoTab>[] = [
  { value: "resumen", label: "Resumen", content: <p>Panel resumen</p> },
  { value: "ventas", label: "Ventas", badge: 3, content: <p>Panel ventas</p> },
  { value: "pagos", label: "Pagos", disabled: true, content: <p>Panel pagos</p> },
  { value: "notas", label: "Notas", content: <p>Panel notas</p> },
];

function setUrl(query: string) {
  mockUseSearchParams.mockReturnValue(new URLSearchParams(query));
}

function tab(name: RegExp) {
  return screen.getByRole("tab", { name });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRouter.mockReturnValue({ replace: mockReplace });
  mockUsePathname.mockReturnValue("/contactos/c-1");
  setUrl("");
});

describe("Tabs", () => {
  describe("roles y teclado", () => {
    it("expone tablist, tab y tabpanel enlazados", () => {
      render(<Tabs ariaLabel="Secciones del contacto" items={items} />);

      expect(screen.getByRole("tablist", { name: "Secciones del contacto" })).toBeInTheDocument();
      expect(screen.getAllByRole("tab")).toHaveLength(4);

      const active = tab(/resumen/i);
      const panel = screen.getByRole("tabpanel");

      expect(active).toHaveAttribute("aria-selected", "true");
      expect(active).toHaveAttribute("aria-controls", panel.id);
      expect(panel).toHaveAttribute("aria-labelledby", active.id);
      expect(panel).toHaveTextContent("Panel resumen");
      expect(tab(/ventas/i)).toHaveAttribute("aria-selected", "false");
      expect(screen.queryByText("Panel ventas")).not.toBeInTheDocument();

      for (const element of screen.getAllByRole("tab")) {
        expect(document.getElementById(element.getAttribute("aria-controls") ?? "")).not.toBeNull();
      }
    });

    it("usa roving tabindex: solo la pestaña activa entra en el orden de tabulación", async () => {
      const user = userEvent.setup();
      render(<Tabs ariaLabel="Secciones" items={items} />);

      expect(tab(/resumen/i)).toHaveAttribute("tabindex", "0");
      expect(tab(/ventas/i)).toHaveAttribute("tabindex", "-1");

      await user.click(tab(/ventas/i));

      expect(tab(/resumen/i)).toHaveAttribute("tabindex", "-1");
      expect(tab(/ventas/i)).toHaveAttribute("tabindex", "0");
    });

    it("mueve con flechas saltando deshabilitadas y dando la vuelta", async () => {
      const user = userEvent.setup();
      render(<Tabs ariaLabel="Secciones" items={items} />);

      await user.click(tab(/resumen/i));
      await user.keyboard("{ArrowRight}");
      expect(tab(/ventas/i)).toHaveFocus();
      expect(tab(/ventas/i)).toHaveAttribute("aria-selected", "true");

      await user.keyboard("{ArrowRight}");
      expect(tab(/notas/i)).toHaveFocus();
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel notas");

      await user.keyboard("{ArrowRight}");
      expect(tab(/resumen/i)).toHaveFocus();

      await user.keyboard("{ArrowLeft}");
      expect(tab(/notas/i)).toHaveFocus();

      await user.keyboard("{ArrowLeft}");
      expect(tab(/ventas/i)).toHaveFocus();
    });

    it("Home y End van a la primera y a la última habilitada", async () => {
      const user = userEvent.setup();
      const edgeItems: TabItem[] = [
        { value: "a", label: "Alfa", disabled: true, content: <p>Panel alfa</p> },
        { value: "b", label: "Beta", content: <p>Panel beta</p> },
        { value: "c", label: "Gama", content: <p>Panel gama</p> },
        { value: "d", label: "Delta", content: <p>Panel delta</p> },
        { value: "e", label: "Epsilon", disabled: true, content: <p>Panel epsilon</p> },
      ];
      render(<Tabs ariaLabel="Secciones" defaultValue="c" items={edgeItems} />);

      await user.click(tab(/gama/i));
      await user.keyboard("{End}");
      expect(tab(/delta/i)).toHaveFocus();
      expect(tab(/delta/i)).toHaveAttribute("aria-selected", "true");

      await user.keyboard("{Home}");
      expect(tab(/beta/i)).toHaveFocus();
      expect(tab(/beta/i)).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("modo no controlado", () => {
    it("arranca en defaultValue y cambia al hacer clic", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();
      render(
        <Tabs
          ariaLabel="Secciones"
          defaultValue="ventas"
          items={items}
          onValueChange={onValueChange}
        />,
      );

      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel ventas");

      await user.click(tab(/notas/i));

      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel notas");
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith("notas");
    });

    it("no avisa si se pulsa la pestaña ya activa", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();
      render(<Tabs ariaLabel="Secciones" items={items} onValueChange={onValueChange} />);

      await user.click(tab(/resumen/i));

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("cae a la primera habilitada si defaultValue está deshabilitado", () => {
      render(<Tabs ariaLabel="Secciones" defaultValue="pagos" items={items} />);

      expect(tab(/resumen/i)).toHaveAttribute("aria-selected", "true");
    });

    it("muestra el badge dentro de la pestaña", () => {
      render(<Tabs ariaLabel="Secciones" items={items} />);

      expect(tab(/ventas/i)).toHaveTextContent("3");
    });

    it("no usa hooks de navegación sin urlParam", async () => {
      const user = userEvent.setup();
      render(<Tabs ariaLabel="Secciones" items={items} />);

      await user.click(tab(/ventas/i));

      expect(mockUseRouter).not.toHaveBeenCalled();
      expect(mockUsePathname).not.toHaveBeenCalled();
      expect(mockUseSearchParams).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("modo controlado", () => {
    it("no cambia hasta que el padre actualiza value", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();
      const { rerender } = render(
        <Tabs ariaLabel="Secciones" items={items} onValueChange={onValueChange} value="resumen" />,
      );

      await user.click(tab(/ventas/i));

      expect(onValueChange).toHaveBeenCalledWith("ventas");
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel resumen");

      rerender(
        <Tabs ariaLabel="Secciones" items={items} onValueChange={onValueChange} value="ventas" />,
      );

      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel ventas");
    });

    it("sigue al estado del padre", async () => {
      const user = userEvent.setup();

      function Controlled() {
        const [value, setValue] = useState<DemoTab>("notas");

        return <Tabs ariaLabel="Secciones" items={items} onValueChange={setValue} value={value} />;
      }

      render(<Controlled />);

      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel notas");

      await user.click(tab(/resumen/i));

      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel resumen");
    });
  });

  describe("pestaña deshabilitada", () => {
    it("no se selecciona con clic ni recibe foco", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();
      render(<Tabs ariaLabel="Secciones" items={items} onValueChange={onValueChange} />);

      expect(tab(/pagos/i)).toBeDisabled();

      await user.click(tab(/pagos/i));

      expect(onValueChange).not.toHaveBeenCalled();
      expect(tab(/pagos/i)).toHaveAttribute("aria-selected", "false");
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel resumen");
    });

    it("un value controlado deshabilitado cae al default", () => {
      render(<Tabs ariaLabel="Secciones" items={items} value="pagos" />);

      expect(tab(/resumen/i)).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("tema oscuro", () => {
    // Tokens sin valor en `.dark` o con contraste insuficiente en oscuro (SHR-02 F1).
    const classesWithoutDarkContrast = [
      "text-on-surface-variant",
      "text-on-primary-container",
      "bg-primary-container",
      "bg-surface-container-high",
      "disabled:opacity-50",
    ];

    it("no usa clases que pierden contraste en oscuro", () => {
      render(<Tabs ariaLabel="Secciones" defaultValue="ventas" items={items} />);

      const painted = [
        screen.getByRole("tablist"),
        ...screen.getAllByRole("tab"),
        ...screen.getAllByRole("tab").flatMap((element) => [...element.querySelectorAll("span")]),
      ];
      const used = painted.flatMap((element) => [...element.classList]);

      for (const forbidden of classesWithoutDarkContrast) {
        expect(used).not.toContain(forbidden);
      }
    });

    it("la pestaña activa y su badge llevan variante oscura; la inactiva usa un token con valor oscuro", () => {
      render(
        <Tabs
          ariaLabel="Secciones"
          items={[
            { value: "a", label: "Alfa", badge: 12, content: <p>Panel alfa</p> },
            { value: "b", label: "Beta", badge: 3, content: <p>Panel beta</p> },
          ]}
        />,
      );

      expect(tab(/alfa/i)).toHaveClass("text-primary", "dark:text-indigo-300");
      expect(screen.getByText("12")).toHaveClass("dark:bg-indigo-950", "dark:text-indigo-300");
      expect(tab(/beta/i)).toHaveClass("text-muted-foreground");
      expect(screen.getByText("3")).toHaveClass("bg-surface-container", "text-muted-foreground");
    });
  });

  describe("pestaña activa a la vista", () => {
    const barRect = { left: 16, right: 374 };
    // Posición de cada pestaña con la barra sin desplazar (`scrollLeft` 0).
    const tabRects: Record<string, { left: number; right: number }> = {
      Resumen: { left: 16, right: 116 },
      Ventas: { left: 116, right: 216 },
      Pagos: { left: 216, right: 316 },
      Notas: { left: 316, right: 416 },
    };
    let scrollIntoView: jest.Mock;

    // Como en el navegador, las pestañas se mueven con el `scrollLeft` de la barra.
    function mockLayout() {
      jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const role = this.getAttribute("role");
        const label = Object.keys(tabRects).find((key) => this.textContent?.startsWith(key));

        if (role === "tablist") {
          return new DOMRect(barRect.left, 0, barRect.right - barRect.left, 44);
        }

        if (role !== "tab" || !label) {
          return new DOMRect(0, 0, 0, 44);
        }

        const { left, right } = tabRects[label];
        const scrolled = this.closest('[role="tablist"]')?.scrollLeft ?? 0;

        return new DOMRect(left - scrolled, 0, right - left, 44);
      });
    }

    beforeEach(() => {
      scrollIntoView = jest.fn();
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("desplaza la barra cuando la pestaña activada por teclado queda recortada a la derecha", async () => {
      const user = userEvent.setup();
      mockLayout();
      render(<Tabs ariaLabel="Secciones" defaultValue="ventas" items={items} />);

      expect(screen.getByRole("tablist").scrollLeft).toBe(0);

      tab(/ventas/i).focus();
      await user.keyboard("{ArrowRight}");

      expect(tab(/notas/i)).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tablist").scrollLeft).toBe(42);
    });

    it("desplaza la barra cuando la pestaña activada con clic queda recortada a la izquierda", async () => {
      const user = userEvent.setup();
      mockLayout();
      render(<Tabs ariaLabel="Secciones" defaultValue="ventas" items={items} />);
      // Con la barra desplazada 76 px, "Resumen" queda en -60..40.
      screen.getByRole("tablist").scrollLeft = 76;

      await user.click(tab(/resumen/i));

      expect(screen.getByRole("tablist").scrollLeft).toBe(0);
    });

    it("al montar con la pestaña de la URL fuera de vista la trae a la vista", () => {
      mockLayout();
      setUrl("tab=notas");
      render(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      expect(screen.getByRole("tablist").scrollLeft).toBe(42);
    });

    it("no mueve la barra si la pestaña activa ya se ve entera", async () => {
      const user = userEvent.setup();
      mockLayout();
      render(<Tabs ariaLabel="Secciones" items={items} />);

      await user.click(tab(/ventas/i));

      expect(screen.getByRole("tablist").scrollLeft).toBe(0);
    });

    // SHR-02G: el usuario desplazó la barra a mano y la pestaña YA activa quedó recortada.
    it("clic sobre la pestaña ya activa y recortada la trae a la vista", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();
      mockLayout();
      render(
        <Tabs
          ariaLabel="Secciones"
          defaultValue="ventas"
          items={items}
          onValueChange={onValueChange}
        />,
      );
      // Con la barra desplazada 176 px, "Ventas" queda en -60..40.
      screen.getByRole("tablist").scrollLeft = 176;

      await user.click(tab(/ventas/i));

      expect(screen.getByRole("tablist").scrollLeft).toBe(100);
      expect(onValueChange).not.toHaveBeenCalled();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("el foco sobre la pestaña ya activa y recortada la trae a la vista", () => {
      mockLayout();
      render(<Tabs ariaLabel="Secciones" defaultValue="notas" items={items} />);
      expect(screen.getByRole("tablist").scrollLeft).toBe(42);
      // El usuario devuelve la barra al inicio: "Notas" queda en 316..416.
      screen.getByRole("tablist").scrollLeft = 0;

      tab(/notas/i).focus();

      expect(tab(/notas/i)).toHaveFocus();
      expect(screen.getByRole("tablist").scrollLeft).toBe(42);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("clic y foco sobre la pestaña activa ya visible no mueven la barra", async () => {
      const user = userEvent.setup();
      mockLayout();
      render(<Tabs ariaLabel="Secciones" defaultValue="ventas" items={items} />);
      screen.getByRole("tablist").scrollLeft = 30;

      tab(/ventas/i).focus();
      await user.click(tab(/ventas/i));

      expect(screen.getByRole("tablist").scrollLeft).toBe(30);
    });

    it("nunca desplaza la página: no llama a scrollIntoView", async () => {
      const user = userEvent.setup();
      mockLayout();
      render(<Tabs ariaLabel="Secciones" items={items} />);

      await user.click(tab(/notas/i));

      expect(screen.getByRole("tablist").scrollLeft).toBe(42);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe("sin pestañas", () => {
    it("items vacío renderiza la barra sin pestañas ni paneles y no rompe", () => {
      render(<Tabs ariaLabel="Secciones" items={[]} />);

      expect(screen.getByRole("tablist", { name: "Secciones" })).toBeInTheDocument();
      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
      expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    });

    it("items vacío con urlParam no rompe ni escribe en la URL", () => {
      setUrl("tab=ventas");
      render(<Tabs ariaLabel="Secciones" items={[]} urlParam="tab" />);

      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("urlParam", () => {
    it("lee la pestaña activa del parámetro al montar", () => {
      setUrl("tab=notas");
      render(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      expect(tab(/notas/i)).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel notas");
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("escribe el parámetro con replace sin scroll y conserva los demás", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();
      setUrl("q=harina&page=2");
      render(
        <Tabs ariaLabel="Secciones" items={items} onValueChange={onValueChange} urlParam="tab" />,
      );

      await user.click(tab(/ventas/i));

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/contactos/c-1?q=harina&page=2&tab=ventas", {
        scroll: false,
      });
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel ventas");
      expect(onValueChange).toHaveBeenCalledWith("ventas");
    });

    it("omite de la URL la pestaña por defecto conservando el resto", async () => {
      const user = userEvent.setup();
      setUrl("q=harina&tab=ventas");
      render(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      await user.click(tab(/resumen/i));

      expect(mockReplace).toHaveBeenCalledWith("/contactos/c-1?q=harina", { scroll: false });
    });

    it("deja la ruta sin query al volver al default sin otros parámetros", async () => {
      const user = userEvent.setup();
      setUrl("tab=ventas");
      render(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      await user.click(tab(/resumen/i));

      expect(mockReplace).toHaveBeenCalledWith("/contactos/c-1", { scroll: false });
    });

    it("respeta defaultValue como pestaña omitida", async () => {
      const user = userEvent.setup();
      render(<Tabs ariaLabel="Secciones" defaultValue="ventas" items={items} urlParam="tab" />);

      expect(tab(/ventas/i)).toHaveAttribute("aria-selected", "true");

      await user.click(tab(/resumen/i));
      expect(mockReplace).toHaveBeenLastCalledWith("/contactos/c-1?tab=resumen", { scroll: false });
    });

    it("un valor inexistente en la URL cae al default sin error", () => {
      setUrl("tab=no-existe");
      render(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      expect(tab(/resumen/i)).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel resumen");
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("una pestaña deshabilitada en la URL cae al default", () => {
      setUrl("tab=pagos");
      render(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      expect(tab(/pagos/i)).toHaveAttribute("aria-selected", "false");
      expect(tab(/resumen/i)).toHaveAttribute("aria-selected", "true");
    });

    it("sigue a la URL cuando cambia por fuera", () => {
      setUrl("tab=ventas");
      const { rerender } = render(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      setUrl("tab=notas");
      rerender(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      expect(tab(/notas/i)).toHaveAttribute("aria-selected", "true");
    });

    it("el teclado también escribe en la URL", async () => {
      const user = userEvent.setup();
      setUrl("tab=ventas");
      render(<Tabs ariaLabel="Secciones" items={items} urlParam="tab" />);

      tab(/ventas/i).focus();
      await user.keyboard("{ArrowRight}");

      expect(mockReplace).toHaveBeenCalledWith("/contactos/c-1?tab=notas", { scroll: false });
    });
  });
});
