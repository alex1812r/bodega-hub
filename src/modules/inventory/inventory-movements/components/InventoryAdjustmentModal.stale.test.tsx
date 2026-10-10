/**
 * CAOS-04 · ajuste de stock con efecto rancio: al abrir la confirmación se relee
 * el stock del producto y el «antes → después» se pinta con el dato fresco; si
 * cambió respecto al del formulario, se avisa. Tras registrar, el aviso de éxito
 * dice el stock que devolvió el servidor.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "@/shared/components/Toast";
import { IMPACT_TIMEOUT_MS } from "@/shared/impact";

import { jsonResponse } from "../../utils/requestAttempt.testUtils";
import { InventoryAdjustmentModal } from "./InventoryAdjustmentModal";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const lockedProduct = { currentStock: 30, id: "prod-cable", name: "Cable HDMI", sku: "ELE-CAB-001" };
const formId = "inventory-adjustment-form";
const CONFIRM_TITLE = "Confirmar ajuste de stock";

type Reply = () => Promise<Response>;

const ok = (data: unknown, status = 200): Reply => () => Promise.resolve(jsonResponse({ data }, status));
const stock = (currentStock: number) => ok({ ...lockedProduct, currentStock, isActive: true });

/** Cada GET del producto y cada POST consumen la siguiente respuesta de su cola. */
function installServer({ posts = [], reads }: { posts?: Reply[]; reads: Reply[] }) {
  const calls = { posts: [] as Array<Record<string, unknown>>, reads: [] as string[] };

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "POST") {
      calls.posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);

      return (posts.shift() ?? (() => Promise.reject(new Error("POST inesperado"))))();
    }

    calls.reads.push(url);

    return (reads.shift() ?? (() => Promise.reject(new Error("GET inesperado"))))();
  }) as unknown as typeof fetch;

  return calls;
}

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(<InventoryAdjustmentModal lockedProduct={lockedProduct} open />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    ),
  });
}

function fill(quantity: string, type?: string) {
  fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: quantity } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Conteo físico" } });
  if (type) {
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: type } });
  }
}

async function openConfirm() {
  fireEvent.submit(document.getElementById(formId) as HTMLFormElement);

  return screen.findByRole("dialog", { name: CONFIRM_TITLE });
}

const confirmButton = (dialog: HTMLElement) =>
  within(dialog).queryByRole("button", { name: "Registrar movimiento" });

describe("InventoryAdjustmentModal · el efecto se pinta con el stock releído (CAOS-04)", () => {
  it("mientras relee no deja confirmar; si el stock cambió lo avisa y el antes → después usa el fresco", async () => {
    let release: (response: Response) => void = () => undefined;
    const calls = installServer({
      reads: [() => new Promise<Response>((resolve) => { release = resolve; })],
    });

    renderModal();
    fill("5");

    const dialog = await openConfirm();

    expect(await within(dialog).findByText("Comprobando el stock actual…")).toBeInTheDocument();
    expect(confirmButton(dialog)).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("pasa a");
    expect(calls.reads).toEqual(["/api/products/prod-cable"]);

    release(jsonResponse({ data: { ...lockedProduct, currentStock: 40, isActive: true } }));

    expect(await within(dialog).findByText("El stock cambió: ahora es 40.")).toBeInTheDocument();
    expect(within(dialog).getByRole("listitem")).toHaveTextContent(
      /\+5 Cable HDMI\s*Stock 40\s*pasa a\s*45$/,
    );
    expect(dialog).not.toHaveTextContent("Stock 30");
    expect(confirmButton(dialog)).toBeEnabled();
    expect(calls.posts).toHaveLength(0);
  });

  it("si el stock no cambió no hay aviso", async () => {
    installServer({ reads: [stock(30)] });
    renderModal();
    fill("5");

    const dialog = await openConfirm();

    expect(await within(dialog).findByRole("listitem")).toHaveTextContent(/Stock 30\s*pasa a\s*35$/);
    expect(dialog).not.toHaveTextContent("El stock cambió");
  });

  it("cada apertura relee: cancelar y volver a abrir no reutiliza el dato anterior", async () => {
    const calls = installServer({ reads: [stock(30), stock(12)] });

    renderModal();
    fill("5");

    const first = await openConfirm();

    await within(first).findByRole("listitem");
    fireEvent.click(within(first).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: CONFIRM_TITLE })).not.toBeInTheDocument(),
    );

    const second = await openConfirm();

    expect(await within(second).findByText("El stock cambió: ahora es 12.")).toBeInTheDocument();
    expect(within(second).getByRole("listitem")).toHaveTextContent(/Stock 12\s*pasa a\s*17$/);
    expect(calls.reads).toHaveLength(2);
  });

  it("si la relectura falla lo dice, no deja confirmar a ciegas y se puede reintentar", async () => {
    const calls = installServer({
      reads: [
        () => Promise.resolve(jsonResponse({ error: { code: "INTERNAL_ERROR", message: "x" } }, 500)),
        stock(31),
      ],
    });

    renderModal();
    fill("5");

    const dialog = await openConfirm();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No se pudo comprobar el stock actual.",
    );
    expect(confirmButton(dialog)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));

    expect(await within(dialog).findByRole("listitem")).toHaveTextContent(/Stock 31\s*pasa a\s*36$/);
    expect(calls.posts).toHaveLength(0);
  });

  it("CNF-F10: una relectura que no responde deja de «comprobar» a los 15 s y se puede reintentar", async () => {
    installServer({ reads: [() => new Promise<Response>(() => undefined), stock(31)] });
    renderModal();
    fill("5");

    // El reloj falso, antes de abrir: el límite de la relectura se arma al pedirla.
    jest.useFakeTimers();
    try {
      fireEvent.submit(document.getElementById(formId) as HTMLFormElement);

      const dialog = screen.getByRole("dialog", { name: CONFIRM_TITLE });

      expect(within(dialog).getByText("Comprobando el stock actual…")).toBeInTheDocument();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(IMPACT_TIMEOUT_MS + 1);
      });

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "No se pudo comprobar el stock actual.",
      );
      expect(confirmButton(dialog)).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("listitem")).toHaveTextContent(/Stock 31s*pasa as*36$/);
  });

  it("una salida que con el stock fresco quedaría en negativo se bloquea con el motivo", async () => {
    const calls = installServer({ reads: [stock(10)] });

    renderModal();
    fill("25", "ajuste_salida");

    const dialog = await openConfirm();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Stock insuficiente: ahora hay 10 en stock y la salida es de 25.",
    );
    expect(confirmButton(dialog)).not.toBeInTheDocument();
    expect(calls.posts).toHaveLength(0);
  });
});

describe("InventoryAdjustmentModal · el éxito dice el stock que devolvió el servidor (CAOS-04)", () => {
  const movement = (stockAfter: number) =>
    ok({ id: "mov-1", productId: "prod-cable", quantityDelta: 5, stockAfter, type: "ajuste_entrada" }, 201);

  async function registerWith(posts: Reply[]) {
    const calls = installServer({ posts, reads: [stock(30)] });

    renderModal();
    fill("5");

    const dialog = await openConfirm();

    await within(dialog).findByRole("listitem");
    fireEvent.click(confirmButton(dialog) as HTMLElement);
    await waitFor(() => expect(calls.posts).toHaveLength(1));

    return calls;
  }

  it("coincide con lo previsto: «Stock final: 35.»", async () => {
    await registerWith([movement(35)]);

    expect(await screen.findByText("Ajuste registrado: Cable HDMI")).toBeInTheDocument();
    expect(screen.getByText("Stock final: 35.")).toBeInTheDocument();
  });

  it("otro movimiento se coló entre la relectura y el envío: dice el real y que no es el previsto", async () => {
    await registerWith([movement(45)]);

    expect(
      await screen.findByText(
        "Stock final: 45. Se preveía 35: hubo otro movimiento de este producto mientras confirmabas.",
      ),
    ).toBeInTheDocument();
  });

  it("si la respuesta no trae el stock, no inventa una cifra", async () => {
    await registerWith([ok({ id: "mov-1" }, 201)]);

    expect(await screen.findByText("Ajuste registrado: Cable HDMI")).toBeInTheDocument();
    expect(screen.queryByText(/Stock final/)).not.toBeInTheDocument();
  });
});
