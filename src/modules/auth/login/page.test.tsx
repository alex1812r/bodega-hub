import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { LoginPage } from "./page";

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: jest.fn() }),
}));

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const sessionResponse = () =>
  jsonResponse({
    data: {
      role: "admin",
      user: { email: "admin@example.com", id: "user-admin", isActive: true, name: "Administrador" },
    },
  });

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<LoginPage />, { wrapper: Wrapper });
}

function fillCredentials() {
  fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: "admin@example.com" } });
  fireEvent.change(screen.getByLabelText(/clave/i), { target: { value: "secret" } });
}

const loginPosts = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/auth/login");

describe("LoginPage · POS-H3 un solo POST por intento", () => {
  const fetchMock = jest.fn();
  let resolveLogin: (response: Response) => void;

  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    global.fetch = fetchMock;
    window.history.replaceState({}, "", "/login");
  });

  it("sends one POST for a double click on the submit button", async () => {
    renderPage();
    fillCredentials();
    const button = screen.getByRole("button", { name: /iniciar sesion/i });

    // Los dos clics llegan antes de que React pinte el botón deshabilitado.
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(loginPosts(fetchMock)).toHaveLength(1));
    await act(async () => {
      await Promise.resolve();
    });

    expect(loginPosts(fetchMock)).toHaveLength(1);
  });

  it("sends one POST for Enter followed by a click", async () => {
    const { container } = renderPage();
    fillCredentials();
    const form = container.querySelector("form") as HTMLFormElement;

    act(() => {
      // Enter en un campo envía el formulario; el clic llega en el mismo tick.
      fireEvent.submit(form);
      fireEvent.click(screen.getByRole("button", { name: /iniciar sesion/i }));
      fireEvent.submit(form);
    });

    await waitFor(() => expect(loginPosts(fetchMock)).toHaveLength(1));
    await act(async () => {
      await Promise.resolve();
    });

    expect(loginPosts(fetchMock)).toHaveLength(1);
  });

  it("keeps the form locked after a successful login while the app navigates away", async () => {
    const { container } = renderPage();
    fillCredentials();
    const form = container.querySelector("form") as HTMLFormElement;

    fireEvent.submit(form);
    await waitFor(() => expect(loginPosts(fetchMock)).toHaveLength(1));

    await act(async () => {
      resolveLogin(sessionResponse());
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));

    fireEvent.submit(form);
    await act(async () => {
      await Promise.resolve();
    });

    expect(loginPosts(fetchMock)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /entrando/i })).toBeDisabled();
  });

  it("allows a new attempt after wrong credentials, without leaving the login", async () => {
    const { container } = renderPage();
    fillCredentials();
    const form = container.querySelector("form") as HTMLFormElement;

    fireEvent.submit(form);
    await waitFor(() => expect(loginPosts(fetchMock)).toHaveLength(1));

    await act(async () => {
      resolveLogin(
        jsonResponse({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas." } }, 401),
      );
    });

    expect(await screen.findByText("Credenciales invalidas.")).toBeVisible();
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.submit(form);

    await waitFor(() => expect(loginPosts(fetchMock)).toHaveLength(2));
  });
});
