import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import type { UIMessage } from "ai";

import { useAssistantChat } from "../hooks/useAssistantChat";

import { AssistantHomePage } from "./page";

// Con factory: el modulo real nunca se carga y jsdom no necesita TransformStream
// (que es lo que arrastra `@ai-sdk/react`).
jest.mock("../hooks/useAssistantChat", () => ({ useAssistantChat: jest.fn() }));
// El alias @/ lo reescribe SWC en los imports, no dentro de jest.mock.
jest.mock("../../auth/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { role: "admin" } }),
}));

const mockedUseAssistantChat = useAssistantChat as jest.MockedFunction<typeof useAssistantChat>;

const ask = jest.fn();

function chatState(overrides: Partial<ReturnType<typeof useAssistantChat>> = {}) {
  return {
    ask,
    clearError: jest.fn(),
    errorMessage: null,
    isBusy: false,
    messages: [] as UIMessage[],
    regenerate: jest.fn(),
    stop: jest.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAssistantChat>;
}

function renderPage(usage: unknown = { limit: 100, resetsAt: "", used: 3 }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  global.fetch = jest.fn(async () =>
    ({
      headers: { get: () => "application/json" },
      json: async () => ({ data: usage }),
      ok: true,
      status: 200,
    }) as unknown as Response,
  ) as unknown as typeof fetch;

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<AssistantHomePage />, { wrapper: Wrapper });
}

const answerMessages = [
  {
    id: "u1",
    parts: [{ text: "cuanto vendimos hoy", type: "text" }],
    role: "user",
  },
  {
    id: "a1",
    parts: [
      {
        input: { preset: "hoy" },
        output: {
          data: { actual: { salesCount: 3, totalRef: 77.5 } },
          ok: true,
          range: { from: "2026-05-18", to: "2026-05-18" },
          source: "ventas_periodo",
        },
        state: "output-available",
        type: "tool-ventas_periodo",
      },
      { text: "Vendimos US$ 77.50 hoy.", type: "text" },
    ],
    role: "assistant",
  },
] as unknown as UIMessage[];

describe("AssistantHomePage", () => {
  beforeEach(() => {
    ask.mockClear();
    mockedUseAssistantChat.mockReturnValue(chatState());
  });

  it("shows the empty state with example chips", () => {
    renderPage();

    expect(screen.getByText("Pregúntale a tus datos")).toBeVisible();
    expect(screen.getByRole("button", { name: /producto más vendido/i })).toBeVisible();
  });

  it("sends the question typed in the composer", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/escribe tu pregunta/i), "cuanto vendimos hoy");
    await user.click(screen.getByRole("button", { name: /enviar pregunta/i }));

    expect(ask).toHaveBeenCalledWith("cuanto vendimos hoy");
  });

  it("sends the question when a suggestion chip is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /capital actual/i }));

    expect(ask).toHaveBeenCalledWith("¿Cuál es el capital actual?");
  });

  it("renders both bubbles and expands the source block", async () => {
    const user = userEvent.setup();
    mockedUseAssistantChat.mockReturnValue(chatState({ messages: answerMessages }));
    renderPage();

    expect(screen.getByText("cuanto vendimos hoy")).toBeVisible();
    expect(screen.getByText("Vendimos US$ 77.50 hoy.")).toBeVisible();

    const toggle = screen.getByRole("button", { name: /fuente: ventas_periodo/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("actual.totalRef")).toBeVisible();
    expect(screen.getByText("77,5")).toBeVisible();
  });

  it("marks the message list as a live log", () => {
    mockedUseAssistantChat.mockReturnValue(chatState({ messages: answerMessages }));
    renderPage();

    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
  });

  it("shows the error banner with a retry button", () => {
    mockedUseAssistantChat.mockReturnValue(
      chatState({ errorMessage: "El servicio de IA no esta disponible en este momento." }),
    );
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("El servicio de IA no esta disponible");
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeVisible();
  });

  it("disables the composer when the daily limit is reached", async () => {
    renderPage({ limit: 5, resetsAt: "", used: 5 });

    await waitFor(() => {
      expect(screen.getByLabelText(/escribe tu pregunta/i)).toBeDisabled();
    });

    expect(screen.getByText("5/5 consultas hoy")).toBeVisible();
  });

  it("shows a stop button while streaming", () => {
    mockedUseAssistantChat.mockReturnValue(
      chatState({ isBusy: true, messages: answerMessages }),
    );
    renderPage();

    expect(screen.getByRole("button", { name: /detener respuesta/i })).toBeVisible();
  });
});
