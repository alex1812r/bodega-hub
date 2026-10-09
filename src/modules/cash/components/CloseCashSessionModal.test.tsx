import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { CloseCashSessionModal } from "./CloseCashSessionModal";

const mutateAsync = jest.fn();
const mockCashCloseSettings: { data?: { cashCloseDiffAlertVes: number } } = {};

jest.mock("../hooks/useCash", () => ({
  useCloseCashSession: () => ({ isPending: false, mutateAsync }),
}));

jest.mock("../../settings/hooks/useSettings", () => ({
  useCashCloseSettings: () => mockCashCloseSettings,
}));

type User = ReturnType<typeof userEvent.setup>;

function renderModal(
  props: Partial<{ onOpenChange: jest.Mock; theoreticalRef: number; theoreticalVes: number }> = {},
) {
  const onOpenChange = props.onOpenChange ?? jest.fn();

  render(
    <CloseCashSessionModal
      onOpenChange={onOpenChange}
      open
      openingRef={10}
      openingVes={500}
      registerName="Caja 1"
      sessionId="session-1"
      theoreticalRef={props.theoreticalRef ?? 25.5}
      theoreticalVes={props.theoreticalVes ?? 1500.25}
    />,
  );

  return { onOpenChange };
}

function vesInput() {
  return screen.getByLabelText("Efectivo contado Bs. (cajon completo)");
}

function refInput() {
  return screen.getByLabelText("Efectivo contado REF (cajon completo)");
}

async function count(user: User, input: HTMLElement, value: string) {
  await user.clear(input);
  await user.type(input, value);
}

function differenceRow(label: "Diferencia Bs." | "Diferencia REF") {
  const term = screen.getByText(label, { selector: "dt" });
  const value = term.parentElement?.querySelector("dd");

  if (!value) {
    throw new Error(`Sin valor para ${label}`);
  }

  return value;
}

function closeButton() {
  return screen.getByRole("button", { name: "Cerrar caja" });
}

function confirmDialog() {
  return screen.getByRole("dialog", { name: "Cerrar caja con faltante" });
}

function queryConfirmDialog() {
  return screen.queryByRole("dialog", { name: "Cerrar caja con faltante" });
}

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue(undefined);
  mockCashCloseSettings.data = { cashCloseDiffAlertVes: 0 };
});

describe("CloseCashSessionModal · NumberInput (SHR-09)", () => {
  it("prellena con el teorico y lo envia sin tocar", async () => {
    const user = userEvent.setup();

    renderModal();

    const ves = vesInput();

    expect(ves).toHaveAttribute("type", "text");
    expect(ves).toHaveValue("1500.25");

    await user.click(closeButton());

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      closingRef: 25.5,
      closingVes: 1500.25,
      sessionId: "session-1",
    });
  });

  it("un monto con 3 decimales viaja redondeado a 2", async () => {
    const user = userEvent.setup();

    renderModal({ theoreticalRef: 25.44, theoreticalVes: 1500 });

    await count(user, vesInput(), "1499,995");
    await count(user, refInput(), "25.444");
    await user.click(closeButton());

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      closingRef: 25.44,
      closingVes: 1500,
      sessionId: "session-1",
    });
  });
});

describe("CloseCashSessionModal · fila Diferencia (CNF-10)", () => {
  it("cuadrada al abrir: diferencia 0 en Bs y REF, neutra", () => {
    renderModal();

    expect(differenceRow("Diferencia Bs.")).toHaveTextContent(formatVesBs(0));
    expect(differenceRow("Diferencia Bs.")).toHaveAttribute("data-difference", "even");
    expect(differenceRow("Diferencia Bs.")).not.toHaveClass("text-error");
    expect(differenceRow("Diferencia REF")).toHaveTextContent(formatRefUsd(0));
    expect(differenceRow("Diferencia REF")).toHaveAttribute("data-difference", "even");
  });

  it("se recalcula al teclear: en rojo con (falta) si es negativa y con (sobra) si es positiva", async () => {
    const user = userEvent.setup();

    renderModal();

    await count(user, vesInput(), "1400,25");

    expect(differenceRow("Diferencia Bs.")).toHaveTextContent(`−${formatVesBs(100)} (falta)`);
    expect(differenceRow("Diferencia Bs.")).toHaveClass("text-error");

    await count(user, vesInput(), "1600.25");

    expect(differenceRow("Diferencia Bs.")).toHaveTextContent(`+${formatVesBs(100)} (sobra)`);
    expect(differenceRow("Diferencia Bs.")).not.toHaveClass("text-error");

    await count(user, refInput(), "20");

    expect(differenceRow("Diferencia REF")).toHaveTextContent(`−${formatRefUsd(5.5)} (falta)`);
    expect(differenceRow("Diferencia REF")).toHaveClass("text-error");
  });

  it("no acumula coma flotante: un teórico 0,1 + 0,2 contra 0,30 contado es diferencia 0", async () => {
    const user = userEvent.setup();

    renderModal({ theoreticalRef: 0, theoreticalVes: 0.1 + 0.2 });

    await count(user, vesInput(), "0,30");

    expect(differenceRow("Diferencia Bs.")).toHaveTextContent(formatVesBs(0));
    expect(differenceRow("Diferencia Bs.")).toHaveAttribute("data-difference", "even");

    await user.click(closeButton());

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(queryConfirmDialog()).not.toBeInTheDocument();
  });
});

describe("CloseCashSessionModal · confirmación de faltante (CNF-10)", () => {
  it("con faltante no cierra: pide confirmación (peligro) con contado, teórico y diferencia", async () => {
    const user = userEvent.setup();

    renderModal();

    await count(user, vesInput(), "1400,25");
    await user.click(closeButton());

    const dialog = within(confirmDialog());

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      dialog.getByText(`Vas a cerrar con ${formatVesBs(100)} de faltante. ¿Continuar?`),
    ).toBeInTheDocument();

    const effects = dialog.getAllByRole("listitem").map((item) => item.textContent);

    expect(effects[0]).toContain(`Contado Bs.${formatVesBs(1400.25)}`);
    expect(effects[1]).toContain(`Teórico Bs.${formatVesBs(1500.25)}`);
    expect(effects[2]).toContain(`Diferencia Bs.−${formatVesBs(100)} (falta)`);
    expect(dialog.getAllByRole("listitem")[2]).toHaveAttribute("data-tone", "danger");
    expect(dialog.getByRole("button", { name: "Cerrar con faltante" })).toHaveClass("bg-red-600");
  });

  it("cancelar la confirmación no cierra la caja y conserva lo tecleado", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderModal();

    await count(user, vesInput(), "1400,25");
    await user.click(closeButton());
    await user.click(within(confirmDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(queryConfirmDialog()).not.toBeInTheDocument());
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(vesInput()).toHaveValue("1400.25");
  });

  it("confirmar cierra UNA vez aunque haya doble clic, con el mismo payload de siempre", async () => {
    const user = userEvent.setup();
    let resolveRequest: () => void = () => undefined;

    mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const { onOpenChange } = renderModal();

    await count(user, vesInput(), "1400,25");
    await user.click(closeButton());
    await user.dblClick(within(confirmDialog()).getByRole("button", { name: "Cerrar con faltante" }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      closingRef: 25.5,
      closingVes: 1400.25,
      sessionId: "session-1",
    });

    resolveRequest();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("sin faltante, doble clic en «Cerrar caja» = un solo cierre y sin paso extra", async () => {
    const user = userEvent.setup();
    let resolveRequest: () => void = () => undefined;

    mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const { onOpenChange } = renderModal();

    await user.dblClick(closeButton());

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(queryConfirmDialog()).not.toBeInTheDocument();

    resolveRequest();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("el error del servidor se muestra tal cual dentro de la confirmación, sin perder lo tecleado, y se puede reintentar", async () => {
    const user = userEvent.setup();
    const message = "La sesión de caja ya está cerrada.";

    mutateAsync.mockRejectedValueOnce(new Error(message));

    const { onOpenChange } = renderModal();

    await count(user, vesInput(), "1400,25");
    await user.click(closeButton());
    await user.click(within(confirmDialog()).getByRole("button", { name: "Cerrar con faltante" }));

    expect(await within(confirmDialog()).findByText(message)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(vesInput()).toHaveValue("1400.25");

    await user.click(within(confirmDialog()).getByRole("button", { name: "Cerrar con faltante" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("un sobrante cierra directo, sin confirmación", async () => {
    const user = userEvent.setup();

    renderModal();

    await count(user, vesInput(), "1600,25");
    await user.click(closeButton());

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(queryConfirmDialog()).not.toBeInTheDocument();
  });

  it("un faltante en REF confirma siempre: el umbral está en Bs", async () => {
    const user = userEvent.setup();

    mockCashCloseSettings.data = { cashCloseDiffAlertVes: 5000 };
    renderModal();

    await count(user, refInput(), "20");
    await user.click(closeButton());

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      within(confirmDialog()).getByText(
        `Vas a cerrar con ${formatRefUsd(5.5)} de faltante. ¿Continuar?`,
      ),
    ).toBeInTheDocument();
  });
});

describe("CloseCashSessionModal · umbral de la tienda (CNF-10)", () => {
  it.each([
    ["por debajo del umbral", "1400,25"],
    ["igual al umbral (no lo supera)", "1350,25"],
  ])("con umbral 150, un faltante %s cierra como hoy, sin confirmación", async (_case, counted) => {
    const user = userEvent.setup();

    mockCashCloseSettings.data = { cashCloseDiffAlertVes: 150 };
    renderModal();

    await count(user, vesInput(), counted);
    await user.click(closeButton());

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(queryConfirmDialog()).not.toBeInTheDocument();
  });

  it("con umbral 150, un faltante de 150,01 sí pide confirmación", async () => {
    const user = userEvent.setup();

    mockCashCloseSettings.data = { cashCloseDiffAlertVes: 150 };
    renderModal();

    await count(user, vesInput(), "1350,24");
    await user.click(closeButton());

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      within(confirmDialog()).getByText(
        `Vas a cerrar con ${formatVesBs(150.01)} de faltante. ¿Continuar?`,
      ),
    ).toBeInTheDocument();
  });

  it("si el umbral no se pudo leer se usa 0: cualquier faltante confirma", async () => {
    const user = userEvent.setup();

    mockCashCloseSettings.data = undefined;
    renderModal();

    await count(user, vesInput(), "1500,24");
    await user.click(closeButton());

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(confirmDialog()).toBeInTheDocument();
  });
});
