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
function Harness({ totalUsers, users }: { totalUsers?: number; users: UserProfileMock[] }) {
  const changes = usePendingUserChanges();

  return <SettingsUsersTable changes={changes} totalUsers={totalUsers} users={users} />;
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

describe("SettingsUsersTable · cuenta propia y último administrador (CAOS-03)", () => {
  const rosa: UserProfileMock = {
    email: "rosa@demo.test",
    id: "user-rosa",
    isActive: true,
    name: "Rosa Admin",
    role: "admin",
  };
  const SERVER_MESSAGE = "La tienda debe conservar al menos un administrador activo.";

  /** Sesión de `currentUserId`; `reject` hace que el servidor conteste su 409. */
  function installSession(currentUserId: string, { reject = false } = {}) {
    return installApi(({ body, method, url }) => {
      if (url === "/api/auth/me") {
        return apiData({ permissions: ["users.manage"], role: "admin", user: { id: currentUserId } });
      }

      if (url.startsWith("/api/users/") && method === "PATCH") {
        return reject
          ? { payload: { error: { code: "CONFLICT", message: SERVER_MESSAGE } }, status: 409 }
          : apiData({ ...luis, ...(body as object) });
      }

      return apiData({ items: [], limit: 10, skip: 0, total: 0 });
    });
  }

  function renderComplete(users: UserProfileMock[], totalUsers = users.length) {
    const user = userEvent.setup({ delay: null });

    render(<Harness totalUsers={totalUsers} users={users} />, { wrapper: createSettingsWrapper() });

    return user;
  }

  async function openConfirm(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    field: "Estado" | "Rol",
    value: string,
  ) {
    const row = rowOf(name);

    await user.selectOptions(row.getByLabelText(field), value);
    await user.click(row.getByRole("button", { name: `Guardar cambios de ${name}` }));

    return screen.findByRole("dialog");
  }

  it("quitarse a uno mismo el rol de administrador: dice que es TU cuenta, en peligro", async () => {
    const api = installSession(luis.id);
    const user = renderComplete([ana, luis, rosa]);
    const dialog = await openConfirm(user, "Luis Admin", "Rol", "vendedor");

    expect(
      await within(dialog).findByText(
        "Es tu propia cuenta: perderás la administración de la tienda en cuanto guardes y no podrás deshacerlo tú; tendrá que devolvértela otro administrador.",
      ),
    ).toHaveClass("text-destructive");

    const confirm = within(dialog).getByRole("button", { name: "Cambiar rol" });

    expect(confirm).toHaveClass("bg-red-600");
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();

    await user.dblClick(confirm);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: { role: "vendedor" },
      method: "PATCH",
      url: "/api/users/user-luis",
    });
  });

  it("desactivarse a uno mismo: dice que no podrás volver a entrar", async () => {
    installSession(luis.id);
    const user = renderComplete([ana, luis, rosa]);
    const dialog = await openConfirm(user, "Luis Admin", "Estado", "false");

    expect(
      await within(dialog).findByText(
        "Es tu propia cuenta: se cerrará tu acceso y no podrás volver a entrar hasta que otro administrador te reactive.",
      ),
    ).toHaveClass("text-destructive");
    expect(within(dialog).getByRole("button", { name: "Desactivar usuario" })).toHaveClass(
      "bg-red-600",
    );
  });

  it("cambiar el rol propio sin perder la administración también avisa y va en peligro", async () => {
    installSession(ana.id);
    const user = renderComplete([ana, luis, rosa]);
    const dialog = await openConfirm(user, "Ana Pérez", "Rol", "contador");

    expect(
      await within(dialog).findByText(
        "Es tu propia cuenta: tus permisos cambian en cuanto guardes.",
      ),
    ).toHaveClass("text-destructive");
    expect(within(dialog).getByRole("button", { name: "Cambiar rol" })).toHaveClass("bg-red-600");
  });

  it("el cambio de otro usuario no habla de cuenta propia", async () => {
    installSession(luis.id);
    const user = renderComplete([ana, luis, rosa]);
    const dialog = await openConfirm(user, "Rosa Admin", "Rol", "vendedor");

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cambiar rol" })).toBeInTheDocument(),
    );
    expect(dialog).not.toHaveTextContent("Es tu propia cuenta");
  });

  it.each([
    ["quitarle el rol", "Rol", "vendedor"],
    ["desactivarlo", "Estado", "false"],
  ] as const)(
    "último administrador activo con toda la lista a la vista: %s queda bloqueado con el motivo",
    async (_label, field, value) => {
      const api = installSession(luis.id);
      // Marta no cuenta (inactiva aunque fuera admin); Ana no es administradora.
      const user = renderComplete([ana, luis, { ...marta, role: "admin" }]);
      const dialog = await openConfirm(user, "Luis Admin", field, value);

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Luis Admin es el único administrador activo de la tienda: nombra o reactiva a otro administrador antes de quitarle el rol o desactivarlo.",
      );
      expect(dialog).toHaveTextContent("No se ha cambiado nada.");
      expect(await within(dialog).findByText(/^Es tu propia cuenta:/)).toBeInTheDocument();
      expect(within(dialog).queryByRole("button", { name: /Cambiar rol|Desactivar usuario/ })).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(api.writes()).toHaveLength(0);
      // El cambio sigue pendiente: se puede descartar o guardar cuando haya otro administrador.
      expect(rowOf("Luis Admin").getByRole("button", { name: /Descartar/ })).toBeInTheDocument();
    },
  );

  it("con más usuarios en otras páginas no se bloquea a ciegas: decide el servidor y su 409 se muestra tal cual", async () => {
    const api = installSession(luis.id, { reject: true });
    const user = renderComplete([ana, luis], 25);
    const dialog = await openConfirm(user, "Luis Admin", "Rol", "vendedor");

    await user.click(within(dialog).getByRole("button", { name: "Cambiar rol" }));

    expect(await within(dialog).findByText(SERVER_MESSAGE)).toHaveAttribute("role", "alert");
    expect(api.writes()).toHaveLength(1);
  });

  it("con otro administrador activo a la vista no se bloquea", async () => {
    installSession(ana.id);
    const user = renderComplete([ana, luis, rosa]);
    const dialog = await openConfirm(user, "Luis Admin", "Estado", "false");

    expect(within(dialog).getByRole("button", { name: "Desactivar usuario" })).toBeEnabled();
    expect(dialog).not.toHaveTextContent("único administrador activo");
  });
});
