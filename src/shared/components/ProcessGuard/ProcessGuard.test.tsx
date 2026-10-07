/* eslint-disable @next/next/no-html-link-for-pages -- los `<a>` sin `next/link` son justo lo que intercepta el listener global */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, type ReactNode } from "react";

import { GuardedLink, ProcessGuard } from "./ProcessGuard";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockLinkNavigate = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

type MockLinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string;
  onNavigate?: (event: { preventDefault: () => void }) => void;
  replace?: boolean;
};

// Reproduce el contrato de `next/link`: `onNavigate` solo corre en navegación
// de cliente y puede cancelarla con `preventDefault()`.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, onNavigate, replace, ...props }: MockLinkProps) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented) {
          return;
        }

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

const LABEL = "Compra a Distribuidora X · 12 líneas · REF 240,00";

type ScreenProps = Partial<ComponentProps<typeof ProcessGuard>> & {
  children?: ReactNode;
};

/** El contenedor cancela el clic al final para que jsdom no intente navegar. */
function Screen({ children, ...guard }: ScreenProps) {
  return (
    <div onClick={(event) => event.preventDefault()}>
      <a href="/sales">Ventas</a>
      <a href="/inventory?tab=lots#top">
        <span>Inventario</span>
      </a>
      {children}
      <ProcessGuard active label={LABEL} onLeave="draft" {...guard} />
    </div>
  );
}

function link(name: string) {
  return screen.getByRole("link", { name });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, "", "/purchases/create");
});

describe("ProcessGuard", () => {
  it("inactivo: no intercepta los enlaces", async () => {
    const user = userEvent.setup();

    render(<Screen active={false} />);

    await user.click(link("Ventas"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("activo: el clic en un enlace interno abre el modal que nombra el proceso", async () => {
    const user = userEvent.setup();

    render(<Screen description="Las líneas bloqueadas se conservan." />);

    await user.click(link("Ventas"));

    const dialog = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(dialog).toHaveTextContent(LABEL);
    expect(dialog).toHaveTextContent(/se guardará un borrador/i);
    expect(dialog).toHaveTextContent("Las líneas bloqueadas se conservan.");
    expect(screen.getByRole("button", { name: "Seguir aquí" })).toHaveFocus();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("con onLeave discard el texto avisa de que se pierden los cambios", async () => {
    const user = userEvent.setup();

    render(<Screen onLeave="discard" />);

    await user.click(link("Ventas"));

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent(/se perderán los cambios/i);
    expect(dialog).not.toHaveTextContent(/borrador/i);
  });

  it("'Seguir aquí' cierra el modal y no navega ni ejecuta nada", async () => {
    const user = userEvent.setup();
    const onSaveDraft = jest.fn();

    render(<Screen onSaveDraft={onSaveDraft} />);

    await user.click(link("Ventas"));
    await user.click(await screen.findByRole("button", { name: "Seguir aquí" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
    expect(onSaveDraft).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/purchases/create");
  });

  it("Esc equivale a 'Seguir aquí'", async () => {
    const user = userEvent.setup();
    const onSaveDraft = jest.fn();

    render(<Screen onSaveDraft={onSaveDraft} />);

    await user.click(link("Ventas"));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("'Salir' con draft guarda el borrador y navega al destino con query y hash", async () => {
    const user = userEvent.setup();
    const onSaveDraft = jest.fn();
    const onDiscard = jest.fn();

    render(<Screen onDiscard={onDiscard} onSaveDraft={onSaveDraft} />);

    await user.click(screen.getByText("Inventario"));
    await user.click(await screen.findByRole("button", { name: "Salir" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/inventory?tab=lots#top"));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("'Salir' con discard descarta y navega", async () => {
    const user = userEvent.setup();
    const onSaveDraft = jest.fn();
    const onDiscard = jest.fn();

    render(<Screen onDiscard={onDiscard} onLeave="discard" onSaveDraft={onSaveDraft} />);

    await user.click(link("Ventas"));
    await user.click(await screen.findByRole("button", { name: "Salir" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/sales"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("doble clic en 'Salir' ejecuta y navega una sola vez", async () => {
    const user = userEvent.setup();
    const onSaveDraft = jest.fn();

    render(<Screen onSaveDraft={onSaveDraft} />);

    await user.click(link("Ventas"));

    const leaveButton = await screen.findByRole("button", { name: "Salir" });

    fireEvent.click(leaveButton);
    fireEvent.click(leaveButton);

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("espera al guardado asíncrono antes de navegar", async () => {
    const user = userEvent.setup();
    let finishSave: () => void = () => undefined;
    const onSaveDraft = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    render(<Screen onSaveDraft={onSaveDraft} />);

    await user.click(link("Ventas"));
    await user.click(await screen.findByRole("button", { name: "Salir" }));

    expect(screen.getByRole("button", { name: "Salir" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Seguir aquí" })).toBeDisabled();
    expect(mockPush).not.toHaveBeenCalled();

    finishSave();

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  });

  it("si el guardado falla muestra error.message tal cual y no navega", async () => {
    const user = userEvent.setup();
    const onSaveDraft = jest
      .fn()
      .mockRejectedValueOnce(new Error("No se pudo guardar el borrador de la compra"));

    render(<Screen onSaveDraft={onSaveDraft} />);

    await user.click(link("Ventas"));
    await user.click(await screen.findByRole("button", { name: "Salir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar el borrador de la compra",
    );
    expect(mockPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Salir" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(onSaveDraft).toHaveBeenCalledTimes(2);
  });

  it("tras salir no vuelve a preguntar en el siguiente enlace", async () => {
    const user = userEvent.setup();

    render(<Screen />);

    await user.click(link("Ventas"));
    await user.click(await screen.findByRole("button", { name: "Salir" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(link("Ventas"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  describe("navegaciones que no se interceptan", () => {
    async function expectNotIntercepted(action: () => Promise<void> | void) {
      await action();

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();
    }

    it("enlace externo", async () => {
      const user = userEvent.setup();

      render(
        <Screen>
          <a href="https://bcv.org.ve/tasas">BCV</a>
        </Screen>,
      );

      await expectNotIntercepted(() => user.click(link("BCV")));
    });

    it('target="_blank"', async () => {
      const user = userEvent.setup();

      render(
        <Screen>
          <a href="/sales/s-1/receipt" rel="noreferrer" target="_blank">
            Recibo
          </a>
        </Screen>,
      );

      await expectNotIntercepted(() => user.click(link("Recibo")));
    });

    it("enlace de descarga", async () => {
      const user = userEvent.setup();

      render(
        <Screen>
          <a download href="/api/reports/export.csv">
            Exportar
          </a>
        </Screen>,
      );

      await expectNotIntercepted(() => user.click(link("Exportar")));
    });

    it("clic con Ctrl, Cmd o botón central", async () => {
      render(<Screen />);

      await expectNotIntercepted(() => {
        fireEvent.click(link("Ventas"), { ctrlKey: true });
        fireEvent.click(link("Ventas"), { metaKey: true });
        fireEvent.click(link("Ventas"), { button: 1 });
      });
    });

    it("ancla y query de la misma página", async () => {
      const user = userEvent.setup();

      render(
        <Screen>
          <a href="#lineas">Ir a líneas</a>
          <a href="/purchases/create?tab=notas">Notas</a>
        </Screen>,
      );

      await expectNotIntercepted(async () => {
        await user.click(link("Ir a líneas"));
        await user.click(link("Notas"));
      });
    });

    it("clic que otro manejador ya canceló", async () => {
      render(<Screen />);

      const cancel = (event: MouseEvent) => event.preventDefault();

      window.addEventListener("click", cancel, true);
      await expectNotIntercepted(() => {
        fireEvent.click(link("Ventas"));
      });
      window.removeEventListener("click", cancel, true);
    });
  });

  describe("GuardedLink (onNavigate de next/link)", () => {
    it("sin ningún guardia montado navega como un Link normal", async () => {
      const user = userEvent.setup();

      render(<GuardedLink href="/sales">Ventas</GuardedLink>);

      await user.click(link("Ventas"));

      expect(mockLinkNavigate).toHaveBeenCalledWith("/sales", false);
    });

    it("con guardia inactivo navega como un Link normal", async () => {
      const user = userEvent.setup();

      render(
        <>
          <GuardedLink href="/sales">Menú ventas</GuardedLink>
          <ProcessGuard active={false} label={LABEL} onLeave="draft" />
        </>,
      );

      await user.click(link("Menú ventas"));

      expect(mockLinkNavigate).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("con guardia activo cancela la navegación del Link y abre el modal una vez", async () => {
      const user = userEvent.setup();
      const onSaveDraft = jest.fn();

      render(
        <>
          <GuardedLink href="/sales" replace>
            Menú ventas
          </GuardedLink>
          <ProcessGuard active label={LABEL} onLeave="draft" onSaveDraft={onSaveDraft} />
        </>,
      );

      await user.click(link("Menú ventas"));

      expect(mockLinkNavigate).not.toHaveBeenCalled();
      expect(await screen.findAllByRole("dialog")).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "Salir" }));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/sales"));
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("respeta el onNavigate propio que cancela la navegación", async () => {
      const user = userEvent.setup();

      render(
        <>
          <GuardedLink href="/sales" onNavigate={(event) => event.preventDefault()}>
            Menú ventas
          </GuardedLink>
          <ProcessGuard active label={LABEL} onLeave="draft" />
        </>,
      );

      await user.click(link("Menú ventas"));

      expect(mockLinkNavigate).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("si next/link no gestiona el clic (sin App Router, p. ej. Storybook) pregunta igualmente en vez de salir", async () => {
      const user = userEvent.setup();

      // Lo que pinta `next/link` cuando no hay router: un `<a>` cuyo clic nadie cancela.
      render(
        <>
          <a data-process-guard-link="" href="/sales">
            Menú ventas
          </a>
          <ProcessGuard active label={LABEL} onLeave="draft" />
        </>,
      );

      const click = new MouseEvent("click", { bubbles: true, cancelable: true });

      fireEvent(link("Menú ventas"), click);

      expect(click.defaultPrevented).toBe(true);
      expect(await screen.findAllByRole("dialog")).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "Salir" }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/sales"));
    });

    it("no intercepta un GuardedLink a la misma página", async () => {
      const user = userEvent.setup();

      render(
        <>
          <GuardedLink href="/purchases/create?tab=notas">Notas</GuardedLink>
          <ProcessGuard active label={LABEL} onLeave="draft" />
        </>,
      );

      await user.click(link("Notas"));

      expect(mockLinkNavigate).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
