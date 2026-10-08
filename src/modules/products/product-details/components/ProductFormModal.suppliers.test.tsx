import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";
import { mockProducts } from "@/shared/mocks/erp-data";

import {
  createQueryWrapper,
  jsonResponse,
} from "../../../inventory/utils/requestAttempt.testUtils";
import type { ProductWithCategory, SaveProductSuppliersResult } from "../../hooks/useProducts";
import { ProductFormModal, type ProductFormModalProps } from "./ProductFormModal";

/** PRO-14 · proveedores encadenados al guardado del producto. */

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => children,
}));

// Sin configuración de la tienda: el formulario usa los chips y el semáforo por defecto.
jest.mock("../../../settings/hooks/useSettings", () => ({
  usePricingSettings: () => ({ data: undefined }),
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

type UserSession = ReturnType<typeof userEvent.setup>;
type ApiCall = { body?: unknown; method: string; url: string };

const product: ProductWithCategory = {
  ...mockProducts[0],
  id: "prod-harina",
  name: "Harina PAN",
  packConversion: undefined,
  preferredSupplier: { id: "sup-polar", name: "Alimentos Polar" },
  sku: "harina-pan",
};

const createdProduct: ProductWithCategory = { ...product, id: "prod-new", name: "Arroz" };

function supplierLink(
  supplierId: string,
  name: string,
  extra: { isActive?: boolean; isPreferred?: boolean; lastCostRef?: number } = {},
) {
  return {
    id: `link-${supplierId}`,
    isActive: true,
    isPreferred: extra.isPreferred ?? false,
    lastCostRef: extra.lastCostRef ?? 0,
    productId: product.id,
    supplier: { id: supplierId, isActive: extra.isActive ?? true, name, type: "proveedor" },
    supplierId,
  };
}

const savedLinks = [
  supplierLink("sup-polar", "Alimentos Polar", { isPreferred: true, lastCostRef: 1.5 }),
  supplierLink("sup-mavesa", "Mavesa"),
];

const contacts = [
  { id: "sup-polar", isActive: true, name: "Alimentos Polar", type: "proveedor" },
  { id: "sup-mavesa", isActive: true, name: "Mavesa", type: "ambos" },
];

function saveResult(
  preferredSupplierId: string | null,
  overrides: Partial<SaveProductSuppliersResult> = {},
): SaveProductSuppliersResult {
  return {
    preferredAutoAssigned: false,
    preferredChanged: false,
    preferredSupplierId,
    previousPreferredSupplierId: null,
    suppliers: [
      {
        costRef: 0,
        id: "link-sup-mavesa",
        isPreferred: preferredSupplierId === "sup-mavesa",
        supplierId: "sup-mavesa",
        supplierIsActive: true,
        supplierName: "Mavesa",
      },
    ],
    ...overrides,
  };
}

/**
 * `fetch` de prueba: registra cada llamada. Los `GET` responden con los
 * vínculos o los contactos; cada `PUT` consume la siguiente respuesta encolada.
 */
function installApi(links: unknown[] = savedLinks) {
  const calls: ApiCall[] = [];
  const putQueue: Response[] = [];

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined, method, url });

    if (method === "PUT") {
      return Promise.resolve(putQueue.shift() ?? jsonResponse({ data: saveResult("sup-polar") }));
    }

    const items = url.includes("/suppliers")
      ? links
      : url.includes("/api/contacts")
        ? contacts
        : [];

    return Promise.resolve(
      jsonResponse({ data: { items, limit: 100, skip: 0, total: items.length } }),
    );
  }) as unknown as typeof fetch;

  return {
    calls,
    failNextPut(message: string) {
      putQueue.push(jsonResponse({ error: { code: "BAD_REQUEST", message } }, 400));
    },
    puts: () => calls.filter((call) => call.method === "PUT"),
    respondToNextPut(result: SaveProductSuppliersResult) {
      putQueue.push(jsonResponse({ data: result }));
    },
    supplierLoads: () =>
      calls.filter((call) => call.method === "GET" && call.url.includes("/suppliers")),
  };
}

function renderForm(props: Partial<ProductFormModalProps> = {}) {
  const onOpenChange = jest.fn();
  const onSubmit = jest.fn<Promise<ProductWithCategory | void>, unknown[]>(async () => undefined);
  const user = userEvent.setup({ delay: null });
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <ProductFormModal onOpenChange={onOpenChange} onSubmit={onSubmit} open {...props} />
      </ToastProvider>
    </QueryWrapper>,
  );

  return { onOpenChange, onSubmit, user };
}

function renderEdit(props: Partial<ProductFormModalProps> = {}) {
  return renderForm({ mode: "edit", product, ...props });
}

function renderCreate(props: Partial<ProductFormModalProps> = {}) {
  return renderForm({ suppliersOnCreate: true, ...props });
}

/** Los avisos del formulario; los toasts viven fuera del diálogo. */
function dialog() {
  return screen.getByRole("dialog");
}

function moreOptionsToggle() {
  return screen.getByRole("button", { name: /^Más opciones/ });
}

function suppliersToggle() {
  return screen.getByRole("button", { name: /^Proveedores/ });
}

async function openSuppliers(user: UserSession) {
  await user.click(moreOptionsToggle());
  await user.click(suppliersToggle());
}

function preferredRadio(name: string) {
  return screen.getByRole("radio", { name: `Habitual: ${name}` });
}

async function paste(user: UserSession, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

async function fillRequired(user: UserSession) {
  await paste(user, "Nombre", "Arroz");
  await paste(user, "Precio REF", "2");
}

async function addSupplier(user: UserSession, text: string, name: string) {
  await user.type(screen.getByRole("combobox", { name: "Añadir proveedor" }), text);
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

describe("ProductFormModal · proveedores (PRO-14)", () => {
  it("compact no tiene la sección, y el alta completa tampoco si el consumidor no la pide", async () => {
    installApi();
    const { user } = renderForm({ compact: true });

    expect(screen.queryByRole("button", { name: /Más opciones/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Proveedores/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Proveedores" })).not.toBeInTheDocument();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("alta completa sin suppliersOnCreate: Más opciones no ofrece Proveedores", async () => {
    installApi();
    const { user } = renderForm();

    await user.click(moreOptionsToggle());

    expect(screen.queryByRole("button", { name: /^Proveedores/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Proveedores" })).not.toBeInTheDocument();
  });

  it("edición: no pide los proveedores hasta desplegar la sección; entonces pide los activos y los muestra", async () => {
    const api = installApi();
    const { user } = renderEdit();

    // Antes de cargar, el resumen nombra al habitual que ya trae el producto.
    expect(moreOptionsToggle()).toHaveTextContent("Habitual: Alimentos Polar");

    await user.click(moreOptionsToggle());

    expect(api.supplierLoads()).toHaveLength(0);

    await user.click(suppliersToggle());

    expect(await screen.findByRole("radio", { name: "Habitual: Alimentos Polar" })).toBeChecked();
    expect(preferredRadio("Mavesa")).not.toBeChecked();
    expect(screen.getByLabelText("Costo REF de Alimentos Polar")).toHaveValue("1.5");
    expect(api.supplierLoads()).toHaveLength(1);
    expect(api.supplierLoads()[0].url).toContain("/api/products/prod-harina/suppliers?");
    expect(api.supplierLoads()[0].url).toContain("isActive=true");
    expect(api.supplierLoads()[0].url).toContain("limit=100");

    // Cerrada "Más opciones", el resumen dice cuántos proveedores tiene.
    await user.click(moreOptionsToggle());
    expect(moreOptionsToggle()).toHaveTextContent("· 2 proveedores");
  });

  it("edición sin tocar los proveedores: guarda el producto y no llama al PUT", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderEdit();

    await openSuppliers(user);
    await screen.findByRole("radio", { name: "Habitual: Alimentos Polar" });
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(api.puts()).toHaveLength(0);
  });

  it("edición sin desplegar la sección: guarda el producto sin pedir ni guardar proveedores", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderEdit();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(api.calls).toHaveLength(0);
  });

  it("edición: cambiar el habitual guarda el estado completo en UN PUT, después del producto", async () => {
    const api = installApi();
    const order: string[] = [];
    const { onOpenChange, onSubmit, user } = renderEdit();

    onSubmit.mockImplementation(async () => {
      order.push(`producto (PUT previos: ${api.puts().length})`);
    });
    api.respondToNextPut(saveResult("sup-mavesa", { preferredChanged: true }));

    await openSuppliers(user);
    await user.click(await screen.findByRole("radio", { name: "Habitual: Mavesa" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(order).toEqual(["producto (PUT previos: 0)"]);
    expect(api.puts()).toHaveLength(1);
    expect(api.puts()[0].url).toBe("/api/products/prod-harina/suppliers");
    expect(api.puts()[0].body).toEqual({
      suppliers: [
        { costRef: 1.5, isPreferred: false, supplierId: "sup-polar" },
        { isPreferred: true, supplierId: "sup-mavesa" },
      ],
    });
    // El usuario eligió el habitual: no hay nada que avisar.
    expect(screen.queryByText(/El habitual pasó a/)).not.toBeInTheDocument();
  });

  it("edición: quitar al habitual lo pasa al siguiente con aviso y el PUT desactiva el vínculo quitado", async () => {
    const api = installApi();
    const { onOpenChange, user } = renderEdit();

    api.respondToNextPut(saveResult("sup-mavesa", { preferredChanged: true }));

    await openSuppliers(user);
    await user.click(await screen.findByRole("button", { name: "Quitar a Alimentos Polar" }));

    expect(within(dialog()).getByRole("status")).toHaveTextContent("El habitual pasa a Mavesa.");
    expect(preferredRadio("Mavesa")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.puts()[0].body).toEqual({
      suppliers: [{ isPreferred: true, supplierId: "sup-mavesa" }],
    });
  });

  it("edición: quitar a todos envía la lista vacía y avisa de que queda sin habitual", async () => {
    const api = installApi();
    const { onOpenChange, user } = renderEdit();

    api.respondToNextPut(saveResult(null, { preferredChanged: true, suppliers: [] }));

    await openSuppliers(user);
    await user.click(await screen.findByRole("button", { name: "Quitar a Alimentos Polar" }));
    await user.click(screen.getByRole("button", { name: "Quitar a Mavesa" }));

    expect(within(dialog()).getByRole("status")).toHaveTextContent(
      "Este producto queda sin proveedor habitual.",
    );

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.puts()[0].body).toEqual({ suppliers: [] });
  });

  it("si el servidor deja un habitual distinto del que mostraba el formulario, avisa con un toast", async () => {
    const api = installApi();
    const { onOpenChange, user } = renderEdit();

    api.respondToNextPut(
      saveResult("sup-mavesa", { preferredAutoAssigned: true, preferredChanged: true }),
    );

    await openSuppliers(user);
    await user.type(await screen.findByLabelText("Costo REF de Mavesa"), "3");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(await screen.findByText("El habitual pasó a Mavesa")).toBeVisible();
  });

  it("edición: si el PUT falla, el modal sigue abierto con el motivo del servidor y lo editado", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderEdit();

    api.failNextPut("El proveedor Mavesa está inactivo: no puede ser el habitual del producto.");

    await openSuppliers(user);
    await user.click(await screen.findByRole("radio", { name: "Habitual: Mavesa" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "El producto se guardó, pero los proveedores no: El proveedor Mavesa está inactivo: no puede ser el habitual del producto.",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(preferredRadio("Mavesa")).toBeChecked();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
  });

  it("alta: crea el producto y después guarda sus proveedores con el id devuelto", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderCreate();

    onSubmit.mockImplementation(async () => {
      expect(api.puts()).toHaveLength(0);

      return createdProduct;
    });

    expect(moreOptionsToggle()).toHaveTextContent("SKU, descripción, stock, empaque y proveedores");

    await fillRequired(user);
    await openSuppliers(user);

    expect(api.supplierLoads()).toHaveLength(0);

    await addSupplier(user, "pol", "Alimentos Polar");
    await addSupplier(user, "mav", "Mavesa");

    expect(preferredRadio("Alimentos Polar")).toBeChecked();

    await user.type(screen.getByLabelText("Costo REF de Mavesa"), "2.5");
    await user.type(screen.getByLabelText("SKU del proveedor Mavesa"), "mav-01");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(api.puts()).toHaveLength(1);
    expect(api.puts()[0].url).toBe("/api/products/prod-new/suppliers");
    expect(api.puts()[0].body).toEqual({
      suppliers: [
        { isPreferred: true, supplierId: "sup-polar" },
        { costRef: 2.5, isPreferred: false, supplierId: "sup-mavesa", supplierSku: "mav-01" },
      ],
    });
    // El buscador pide solo proveedores activos.
    const search = api.calls.find((call) => call.url.includes("/api/contacts"));

    expect(search?.url).toContain("type=proveedor");
    expect(search?.url).toContain("isActive=true");
  });

  it("alta sin proveedores: crea el producto y no llama al PUT", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderCreate();

    onSubmit.mockResolvedValue(createdProduct);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.calls).toHaveLength(0);
  });

  it("alta: si el PUT falla no cierra, y al reintentar guarda solo los proveedores sin crear otro producto", async () => {
    const api = installApi();
    const onCreated = jest.fn();
    const { onOpenChange, onSubmit, user } = renderCreate({ onCreated });

    onSubmit.mockResolvedValue(createdProduct);
    api.failNextPut("Proveedor no encontrado.");

    await fillRequired(user);
    await openSuppliers(user);
    await addSupplier(user, "pol", "Alimentos Polar");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "El producto se guardó, pero los proveedores no: Proveedor no encontrado. Corrige los proveedores y vuelve a guardar: el producto ya está creado y no se creará otra vez.",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Producto creado: Arroz")).toBeVisible();
    // Lo ya guardado queda inerte: solo se corrigen los proveedores.
    expect(screen.getByLabelText("Nombre").closest("[inert]")).not.toBeNull();
    expect(preferredRadio("Alimentos Polar").closest("[inert]")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Guardar proveedores" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(api.puts()).toHaveLength(2);
    expect(api.puts().map((call) => call.url)).toEqual([
      "/api/products/prod-new/suppliers",
      "/api/products/prod-new/suppliers",
    ]);
    expect(api.puts()[1].body).toEqual({
      suppliers: [{ isPreferred: true, supplierId: "sup-polar" }],
    });
  });

  it("alta: un doble envío mientras se guardan los proveedores no repite ni el producto ni el PUT", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderCreate();

    onSubmit.mockResolvedValue(createdProduct);

    await fillRequired(user);
    await openSuppliers(user);
    await addSupplier(user, "pol", "Alimentos Polar");

    const form = screen.getByLabelText("Nombre").closest("form")!;

    form.requestSubmit();
    form.requestSubmit();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(api.puts()).toHaveLength(1);
  });

  it("Guardar y crear otro: guarda los proveedores y deja la sección vacía para el siguiente", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderCreate();

    onSubmit.mockResolvedValue(createdProduct);

    await fillRequired(user);
    await openSuppliers(user);
    await addSupplier(user, "pol", "Alimentos Polar");
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(api.puts()).toHaveLength(1));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "false");

    await openSuppliers(user);

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Proveedores" })).getByText(
        "Este producto no tiene proveedores vinculados.",
      ),
    ).toBeVisible();

    // El siguiente producto, sin proveedores, no vuelve a llamar al PUT.
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(api.puts()).toHaveLength(1);
  });

  it("alta: si onSubmit no devuelve el producto, cierra y avisa de que los proveedores no se guardaron", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderCreate();

    await fillRequired(user);
    await openSuppliers(user);
    await addSupplier(user, "pol", "Alimentos Polar");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(api.puts()).toHaveLength(0);
    expect(
      screen.getByText("Los proveedores no se guardaron: añádelos desde el detalle del producto."),
    ).toBeVisible();
  });

  it("si el producto no se guarda, no se intenta guardar los proveedores", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderEdit();

    onSubmit.mockRejectedValue(new Error("SKU duplicado"));

    await openSuppliers(user);
    await user.click(await screen.findByRole("radio", { name: "Habitual: Mavesa" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(api.puts()).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("más de 50 proveedores: no envía nada, abre las secciones, avisa y enfoca un botón de quitar", async () => {
    const links = Array.from({ length: 51 }, (_, index) =>
      supplierLink(`sup-${index}`, `Proveedor ${index}`, { isPreferred: index === 0 }),
    );
    const api = installApi(links);
    const { onSubmit, user } = renderEdit();

    await openSuppliers(user);
    await screen.findByRole("radio", { name: "Habitual: Proveedor 0" });
    await user.click(moreOptionsToggle());
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(api.puts()).toHaveLength(0);
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(
      "Un producto admite como máximo 50 proveedores: quita 1.",
    );
    expect(screen.getByRole("button", { name: "Quitar a Proveedor 0" })).toHaveFocus();
  });
});
