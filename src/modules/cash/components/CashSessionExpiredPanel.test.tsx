/**
 * POS-F5 (qa-final F6): doble clic en «Cerrar con teórico y continuar» enviaba dos
 * cierres (200 + 400). El botón lleva un cerrojo síncrono: un solo POST.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CashSessionExpiredPanel } from "./CashSessionExpiredPanel";

type Reply = { payload: unknown; status: number };

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

    return {
      headers: { get: () => "application/json" },
      json: async () => ({ data: null }),
      ok: true,
      status: 200,
    };
  }) as unknown as typeof fetch;

  return posts;
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <CashSessionExpiredPanel
        registerName="Caja 1"
        sessionId="session-1"
        theoreticalRef={5}
        theoreticalVes={1200.5}
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
