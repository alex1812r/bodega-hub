/**
 * POS-F5 (qa-final F6): doble clic en «Cerrar con teórico y continuar» enviaba dos
 * cierres (200 + 400). El botón lleva un cerrojo síncrono: un solo POST.
 *
 * POS-F8: el teórico con el que cierra se lee del servidor al pulsar; el que recibe por
 * props viene de la caché y puede ser anterior a la última venta.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CashSessionExpiredPanel } from "./CashSessionExpiredPanel";

type Reply = { payload: unknown; status: number };

/** Teórico que tiene el servidor; `null` = la lectura falla. */
let serverTheoretical: { ref: number; ves: number } | null = { ref: 5, ves: 1200.5 };

beforeEach(() => {
  serverTheoretical = { ref: 5, ves: 1200.5 };
});

function installFetch(reply: () => Promise<Reply>) {
  const posts: unknown[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/cash/session/close" && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      const { payload, status } = await reply();

      return {
        headers: { get: () => "application/json" },
        json: async () => payload,
        ok: status < 300,
        status,
      };
    }

    if (String(input).startsWith("/api/cash/movements")) {
      const theoretical = serverTheoretical;

      return {
        headers: { get: () => "application/json" },
        json: async () =>
          theoretical
            ? { data: { accountVes: 0, items: [], theoretical } }
            : { error: { code: "INTERNAL", message: "No pudimos leer los movimientos de caja." } },
        ok: theoretical !== null,
        status: theoretical ? 200 : 500,
      };
    }

    return {
      headers: { get: () => "application/json" },
      json: async () => ({ data: null }),
      ok: true,
      status: 200,
    };
  }) as unknown as typeof fetch;

  return posts;
}

function renderPanel(cached: { ref: number; ves: number } = { ref: 5, ves: 1200.5 }) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <CashSessionExpiredPanel
        registerName="Caja 1"
        sessionId="session-1"
        theoreticalRef={cached.ref}
        theoreticalVes={cached.ves}
      />
    </QueryClientProvider>,
  );
}

const closeButton = () => screen.getByRole("button", { name: /Cerrar con teórico y continuar|Cerrando/ });

describe("CashSessionExpiredPanel · un solo cierre", () => {
  it("dos clics seguidos envían UN solo POST con el teórico", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const posts = installFetch(
      () =>
        new Promise<Reply>((resolve) => {
          release = resolve;
        }),
    );

    renderPanel();

    const button = closeButton();

    // Sin esperar entre clics: el segundo llega antes de que React pinte `isPending`.
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(closeButton()).toBeDisabled());
    expect(posts).toEqual([{ closingRef: 5, closingVes: 1200.5, sessionId: "session-1" }]);

    release({ payload: { data: { id: "session-1", status: "closed" } }, status: 200 });

    // Cerrado: mientras la pantalla se actualiza, otro clic tampoco envía nada.
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Cerrar con teórico"));
    fireEvent.click(screen.getByRole("button"));
    expect(posts).toHaveLength(1);
  });

  it("si el cierre falla muestra el motivo y deja reintentar", async () => {
    const replies: Reply[] = [
      { payload: { error: { code: "BAD_REQUEST", message: "El baúl no responde." } }, status: 400 },
      { payload: { data: { id: "session-1", status: "closed" } }, status: 200 },
    ];
    const posts = installFetch(async () => replies.shift() as Reply);

    renderPanel();
    fireEvent.click(closeButton());

    expect(await screen.findByText("El baúl no responde.")).toBeInTheDocument();
    await waitFor(() => expect(closeButton()).toBeEnabled());

    fireEvent.click(closeButton());

    await waitFor(() => expect(posts).toHaveLength(2));
  });
});

describe("CashSessionExpiredPanel · POS-F8 · cierra con el teórico del servidor, no con el de la caché", () => {
  it("con el teórico recibido en 0 (caché previa a la venta) envía el que el servidor tiene al pulsar", async () => {
    serverTheoretical = { ref: 0, ves: 7618.16 };

    const posts = installFetch(async () => ({
      payload: { data: { id: "session-1", status: "closed" } },
      status: 200,
    }));

    renderPanel({ ref: 0, ves: 0 });
    fireEvent.click(closeButton());

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts).toEqual([{ closingRef: 0, closingVes: 7618.16, sessionId: "session-1" }]);
  });

  it("si no puede leer el teórico no cierra: lo dice y deja reintentar", async () => {
    serverTheoretical = null;

    const posts = installFetch(async () => ({
      payload: { data: { id: "session-1", status: "closed" } },
      status: 200,
    }));

    renderPanel({ ref: 0, ves: 0 });
    fireEvent.click(closeButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos leer los movimientos de caja.",
    );
    expect(posts).toHaveLength(0);
    await waitFor(() => expect(closeButton()).toBeEnabled());

    serverTheoretical = { ref: 0, ves: 7618.16 };
    fireEvent.click(closeButton());

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ closingRef: 0, closingVes: 7618.16, sessionId: "session-1" });
  });
});
