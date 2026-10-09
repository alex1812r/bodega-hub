/**
 * CNF-11 · Usuarios de la tienda: rol y estado quedan pendientes en la fila y
 * solo se guardan con «Guardar», tras confirmar los permisos que cambian.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { UserProfileMock } from "@/shared/mocks/erp-data";

import { apiData, apiError, createSettingsWrapper, installApi } from "../settingsApi.testUtils";
import { usePendingUserChanges } from "../usePendingUserChanges";
import { SettingsUsersTable } from "./SettingsUsersTable";

const LAST_ADMIN_MESSAGE = "La tienda no puede quedarse sin un administrador activo.";

const ana: UserProfileMock = {
  email: "ana@demo.test",
  id: "user-ana",
  isActive: true,
  name: "Ana Pérez",
  role: "vendedor",
};
const luis: UserProfileMock = {
  email: "luis@demo.test",
  id: "user-luis",
  isActive: true,
  name: "Luis Admin",
  role: "admin",
};
const marta: UserProfileMock = {
  email: "marta@demo.test",
  id: "user-marta",
  isActive: false,
  name: "Marta Inactiva",
  role: "contador",
};
const otherPage: UserProfileMock = {
  email: "otro@demo.test",
  id: "user-otro",
  isActive: true,
  name: "Otro Usuario",
  role: "almacen",
};

/** Como la página: los cambios pendientes viven por encima de la tabla. */
function Harness({ users }: { users: UserProfileMock[] }) {
  const changes = usePendingUserChanges();

  return <SettingsUsersTable changes={changes} users={users} />;
}

function installServer({ reject = false } = {}) {
  return installApi(({ body, method, url }) => {
    if (url.startsWith("/api/users/") && method === "PATCH") {
      return reject ? apiError(LAST_ADMIN_MESSAGE, 409) : apiData({ ...ana, ...(body as object) });
    }

    return apiData({ items: [], limit: 10, skip: 0, total: 0 });
  });
}

function renderTable(users: UserProfileMock[] = [ana, luis, marta]) {
  const user = userEvent.setup({ delay: null });
  const view = render(<Harness users={users} />, { wrapper: createSettingsWrapper() });

  return { user, view };
}

function rowOf(name: string) {
  const row = screen.getByText(name).closest("tr");

  if (!row) {
    throw new Error(`Sin fila para ${name}`);
  }

  return within(row);
}

describe("SettingsUsersTable · rol y estado con confirmación (CNF-11)", () => {
  it("cambiar el rol no guarda: queda pendiente en la fila con Guardar y Descartar", async () => {
    const api = installServer();
    const { user } = renderTable();
    const row = rowOf("Ana Pérez");

    expect(row.queryByRole("button", { name: /Guardar/ })).not.toBeInTheDocument();

    await user.selectOptions(row.getByLabelText("Rol"), "admin");

    expect(row.getByLabelText("Rol")).toHaveValue("admin");
    expect(row.getByText("Sin guardar. Antes: Vendedor")).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Guardar cambios de Ana Pérez" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Descartar cambios de Ana Pérez" })).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cambiar el estado tampoco guarda hasta pulsar Guardar", async () => {
    const api = installServer();
    const { user } = renderTable();
    const row = rowOf("Ana Pérez");

    await user.selectOptions(row.getByLabelText("Estado"), "false");

    expect(row.getByText("Sin guardar. Antes: Activo")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("volver a elegir el valor guardado quita el cambio pendiente", async () => {
    installServer();
    const { user } = renderTable();
    const row = rowOf("Ana Pérez");

    await user.selectOptions(row.getByLabelText("Rol"), "admin");
    await user.selectOptions(row.getByLabelText("Rol"), "vendedor");

    expect(row.queryByRole("button", { name: /Guardar/ })).not.toBeInTheDocument();
    expect(row.getByText("Sin cambios")).toBeInTheDocument();
  });

  it("Guardar muestra «Rol vendedor → admin» con los permisos que gana y pierde, por área", async () => {
    const api = installServer();
    const { user } = renderTable();
    const row = rowOf("Ana Pérez");

    await user.selectOptions(row.getByLabelText("Rol"), "admin");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Ana Pérez" }));

    const dialog = await screen.findByRole("dialog", {
      name: "¿Guardar los cambios de Ana Pérez?",
    });

    expect(dialog).toHaveTextContent("Rol: Vendedor → Administrador");

    const gained = within(dialog).getByRole("list", { name: /^Gana acceso a \(\d+\)$/ });
    const lost = within(dialog).getByRole("list", { name: "Pierde acceso a (3)" });

    expect(gained).toHaveTextContent("Compras: Ver compras, Registrar y recibir compras");
    expect(gained).toHaveTextContent("Baúl: Ver el baúl, Mover dinero del baúl");
    expect(gained).toHaveTextContent("Ver reportes");
    expect(gained).toHaveTextContent("Administrar usuarios y guardar la configuración");
    expect(lost).toHaveTextContent("Ventas: Vender en el POS");
    expect(lost).toHaveTextContent("Caja: Operar su caja (abrir, cobrar y cerrar)");
    expect(lost).toHaveTextContent("Nómina: Ver sus recibos de nómina");
    // Ganar permisos no es la variante de peligro.
    expect(within(dialog).getByRole("button", { name: "Cambiar rol" })).not.toHaveClass("bg-red-600");
    expect(api.writes()).toHaveLength(0);
  });

  it("cancelar el diálogo no guarda y conserva el cambio pendiente", async () => {
    const api = installServer();
    const { user } = renderTable();
    const row = rowOf("Ana Pérez");

    await user.selectOptions(row.getByLabelText("Rol"), "admin");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Ana Pérez" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toHaveLength(0);
    expect(row.getByLabelText("Rol")).toHaveValue("admin");
    expect(row.getByRole("button", { name: "Guardar cambios de Ana Pérez" })).toBeInTheDocument();
  });

  it("Descartar revierte el cambio sin escribir", async () => {
    const api = installServer();
    const { user } = renderTable();
    const row = rowOf("Ana Pérez");

    await user.selectOptions(row.getByLabelText("Rol"), "admin");
    await user.click(row.getByRole("button", { name: "Descartar cambios de Ana Pérez" }));

    expect(row.getByLabelText("Rol")).toHaveValue("vendedor");
    expect(row.queryByRole("button", { name: /Guardar/ })).not.toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("confirmar guarda UNA vez aunque haya doble clic y la fila deja de estar pendiente", async () => {
    const api = installServer();
    const { user } = renderTable();
    const row = rowOf("Ana Pérez");

    await user.selectOptions(row.getByLabelText("Rol"), "admin");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Ana Pérez" }));
    await user.dblClick(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cambiar rol" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      { body: { role: "admin" }, method: "PATCH", url: "/api/users/user-ana" },
    ]);
    expect(row.queryByRole("button", { name: /Guardar/ })).not.toBeInTheDocument();
    expect(await screen.findByText("Cambios guardados: Ana Pérez")).toBeInTheDocument();
  });

  it("desactivar: variante de peligro y lo que pierde de verdad (login y sesión)", async () => {
    const api = installServer();
    const { user } = renderTable();
    const row = rowOf("Ana Pérez");

    await user.selectOptions(row.getByLabelText("Estado"), "false");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Ana Pérez" }));

    const dialog = await screen.findByRole("dialog");
    const effects = within(dialog).getByRole("list", { name: "Al desactivarlo" });

    expect(dialog).toHaveTextContent("Estado: Activo → Inactivo");
    expect(effects).toHaveTextContent("No podrá iniciar sesión.");
    expect(effects).toHaveTextContent("el sistema rechazará su siguiente acción");
    expect(effects).toHaveTextContent("Conserva su rol (Vendedor)");

    const confirm = within(dialog).getByRole("button", { name: "Desactivar usuario" });

    expect(confirm).toHaveClass("bg-red-600");
    // En peligro el foco inicial va a Cancelar.
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();

    await user.click(confirm);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: { isActive: false },
      method: "PATCH",
      url: "/api/users/user-ana",
    });
  });

  it("reactivar: muestra lo simétrico, sin variante de peligro", async () => {
    installServer();
    const { user } = renderTable();
    const row = rowOf("Marta Inactiva");

    await user.selectOptions(row.getByLabelText("Estado"), "true");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Marta Inactiva" }));

    const dialog = await screen.findByRole("dialog");
    const effects = within(dialog).getByRole("list", { name: "Al reactivarlo" });

    expect(dialog).toHaveTextContent("Estado: Inactivo → Activo");
    expect(effects).toHaveTextContent("Podrá volver a iniciar sesión en esta tienda.");
    expect(effects).toHaveTextContent("Recupera los permisos de su rol: Contador.");
    expect(within(dialog).getByRole("button", { name: "Reactivar usuario" })).not.toHaveClass(
      "bg-red-600",
    );
  });

  it("quitar el rol de administrador es variante de peligro y lo dice", async () => {
    installServer();
    const { user } = renderTable();
    const row = rowOf("Luis Admin");

    await user.selectOptions(row.getByLabelText("Rol"), "vendedor");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Luis Admin" }));

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent("Rol: Administrador → Vendedor");
    expect(dialog).toHaveTextContent("Deja de administrar la tienda");
    expect(within(dialog).getByRole("list", { name: /^Pierde acceso a/ })).toHaveTextContent(
      "Administrar usuarios y guardar la configuración",
    );
    expect(within(dialog).getByRole("button", { name: "Cambiar rol" })).toHaveClass("bg-red-600");
  });

  it("rol y estado pendientes a la vez se guardan en una sola petición", async () => {
    const api = installServer();
    const { user } = renderTable();
    const row = rowOf("Marta Inactiva");

    await user.selectOptions(row.getByLabelText("Rol"), "almacen");
    await user.selectOptions(row.getByLabelText("Estado"), "true");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Marta Inactiva" }));

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent("Rol: Contador → Almacén");
    expect(dialog).toHaveTextContent("Recupera los permisos de su rol: Almacén.");

    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({ isActive: true, role: "almacen" });
  });

  it("cambiar el rol de un usuario inactivo avisa de que aplicará al reactivarlo", async () => {
    installServer();
    const { user } = renderTable();
    const row = rowOf("Marta Inactiva");

    await user.selectOptions(row.getByLabelText("Rol"), "almacen");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Marta Inactiva" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "El usuario está inactivo: estos permisos aplicarán cuando se reactive.",
    );
  });

  it("si el servidor rechaza el cambio, muestra su mensaje en el diálogo y no pierde el pendiente", async () => {
    const api = installServer({ reject: true });
    const { user } = renderTable();
    const row = rowOf("Luis Admin");

    await user.selectOptions(row.getByLabelText("Rol"), "vendedor");
    await user.click(row.getByRole("button", { name: "Guardar cambios de Luis Admin" }));

    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Cambiar rol" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(LAST_ADMIN_MESSAGE);
    expect(api.writes()).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row.getByLabelText("Rol")).toHaveValue("vendedor");
    expect(row.getByRole("button", { name: "Guardar cambios de Luis Admin" })).toBeInTheDocument();
  });

  it("paginar no pierde los cambios pendientes: se avisan y siguen ahí al volver", async () => {
    const api = installServer();
    const { user, view } = renderTable();

    await user.selectOptions(rowOf("Ana Pérez").getByLabelText("Rol"), "contador");

    view.rerender(<Harness users={[otherPage]} />);

    expect(
      screen.getByText(/^Hay 1 usuario con cambios sin guardar en otra página./),
    ).toBeInTheDocument();

    view.rerender(<Harness users={[ana, luis, marta]} />);

    expect(screen.queryByText(/cambios sin guardar en otra/)).not.toBeInTheDocument();
    expect(rowOf("Ana Pérez").getByLabelText("Rol")).toHaveValue("contador");
    expect(api.writes()).toHaveLength(0);
  });
});
