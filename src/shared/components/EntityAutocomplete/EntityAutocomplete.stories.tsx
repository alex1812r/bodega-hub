import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";

import { Button } from "../Button";
import { Modal } from "../Modal";
import {
  ENTITY_AUTOCOMPLETE_LIMIT,
  EntityAutocomplete,
  type EntityAutocompleteProps,
} from "./EntityAutocomplete";
import type {
  ContactEntityOption,
  EntityAutocompleteValue,
  EntityFetcher,
  EntityKind,
  ProductEntityOption,
} from "./entityAutocomplete.types";
import { getEntityRecentsStorageKey } from "./entityRecents";

/**
 * Buscador de productos o contactos con búsqueda en servidor (`limit=8`).
 *
 * - `entity="product"` busca por nombre, SKU y código de barras; `entity="contact"`
 *   por nombre y RIF. Sin `fetcher` usa el BFF (`/api/products`, `/api/contacts`).
 * - `filters`: `{ active, excludeIds }`, más `categoryId` en productos y `type`
 *   en contactos. `getOptionDisabled` devuelve el motivo de una opción bloqueada.
 * - Recientes al enfocar con el campo vacío (`recentsKey` separa contextos).
 * - Lector de barras: cada Enter captura su texto, deja el campo libre para el
 *   siguiente escaneo y busca de inmediato. Solo elige la coincidencia exacta de
 *   código de barras o SKU (RIF en contactos), en el orden de los escaneos. Sin
 *   coincidencia exacta el texto vuelve al campo con la lista abierta; sin
 *   resultados, o si el campo ya está en otro escaneo, llama a `onNotFound`.
 *   Repetir el mismo escaneo tampoco elige; elegir una opción o limpiar
 *   descarta los escaneos que aún no respondieron. Si el siguiente escaneo
 *   reemplaza un texto devuelto al campo sin que el usuario haya elegido,
 *   limpiado ni editado nada, ese código también llega a `onNotFound`.
 *
 * Estas historias usan fetchers falsos y no tocan la red; «Lector de barras» usa
 * el fetcher real contra un `/api/products` simulado con MSW.
 */
const meta = {
  component: EntityAutocomplete,
  tags: ["ai-generated"],
} satisfies Meta<typeof EntityAutocomplete>;

export default meta;
type Story = StoryObj;

const productNames = [
  "Harina PAN 1 kg",
  "Harina de trigo Robin Hood 1 kg",
  "Arroz Mary 1 kg",
  "Arroz Primor 1 kg",
  "Pasta Capri larga 500 g",
  "Pasta Primor corta 500 g",
  "Aceite Mazeite 1 L",
  "Azúcar Montalbán 1 kg",
  "Café Fama de América 500 g",
  "Refresco Cola 2 L",
  "Malta Polar 355 ml",
  "Atún Margarita 140 g",
  "Sardinas La Gaviota 170 g",
  "Mayonesa Mavesa 445 g",
  "Margarina Mavesa 500 g",
  "Leche en polvo La Campiña 900 g",
];

const products: ProductEntityOption[] = productNames.map((label, index) => ({
  barcode: `759100000${String(index).padStart(4, "0")}`,
  categoryId: "cat-viveres",
  currentCostRef: 1 + index * 0.1,
  currentStock: index === 3 ? 0 : 6 + index * 3,
  id: `product-${index}`,
  isActive: true,
  label,
  salePriceRef: 1.25 + index * 0.35,
  sku: `VIV-${String(index + 1).padStart(3, "0")}`,
}));

const contacts: ContactEntityOption[] = [
  { label: "Distribuidora Polar", phone: "0212-2021111", type: "proveedor" as const },
  { label: "Alimentos Mary C.A.", phone: "0241-8711122", type: "proveedor" as const },
  { label: "Mayorista El Trigal", phone: "0414-5550101", type: "ambos" as const },
  { label: "María Pérez", phone: "0412-5550102", type: "cliente" as const },
  { label: "Comercial Los Andes", phone: "", type: "proveedor" as const },
].map((contact, index) => ({
  ...contact,
  id: `contact-${index}`,
  isActive: true,
  taxId: `J-3012345${index}-1`,
}));

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);

    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

const fakeProductFetcher: EntityFetcher<"product"> = async ({ limit, query, signal }) => {
  await wait(250, signal);

  const term = query.toLowerCase();

  return products
    .filter((product) =>
      [product.label, product.sku, product.barcode ?? ""].some((field) =>
        field.toLowerCase().includes(term),
      ),
    )
    .slice(0, limit);
};

const fakeContactFetcher: EntityFetcher<"contact"> = async ({ filters, limit, query, signal }) => {
  await wait(250, signal);

  const term = query.toLowerCase();

  return contacts
    .filter((contact) => !filters.type || filters.type.includes(contact.type))
    .filter((contact) =>
      [contact.label, contact.taxId].some((field) => field.toLowerCase().includes(term)),
    )
    .slice(0, limit);
};

const neverResolves: EntityFetcher<"product"> = () => new Promise(() => undefined);

const alwaysFails: EntityFetcher<"product"> = async ({ signal }) => {
  await wait(150, signal);
  throw new Error("No se pudo conectar con el servidor. Revisa tu conexión.");
};

type DemoProps<K extends EntityKind> = Omit<EntityAutocompleteProps<K>, "onChange" | "value"> & {
  initialValue?: EntityAutocompleteValue | null;
};

function Demo<K extends EntityKind>({ initialValue = null, ...props }: DemoProps<K>) {
  const [value, setValue] = useState<EntityAutocompleteValue | null>(initialValue);
  const [notFound, setNotFound] = useState<string | null>(null);

  return (
    <div className="max-w-md space-y-3">
      <EntityAutocomplete
        {...props}
        onChange={(option) => {
          setNotFound(null);
          setValue(option);
        }}
        onNotFound={setNotFound}
        value={value}
      />
      <p className="text-xs text-muted-foreground">
        {notFound
          ? `Enter sin resultados para «${notFound}» (aquí COM-03 ofrecerá "Nuevo producto").`
          : `Seleccionado: ${value ? value.label : "ninguno"}`}
      </p>
    </div>
  );
}

const SCAN_LATENCY_MS = 400;

/** `/api/products` simulado: `barcode` y `sku` exactos, `search` parcial. */
const scanHandlers = [
  http.get("/api/products", async ({ request }) => {
    const params = new URL(request.url).searchParams;
    const barcode = params.get("barcode");
    const sku = params.get("sku")?.toLowerCase();
    const term = params.get("search")?.toLowerCase();
    const limit = Number(params.get("limit") ?? ENTITY_AUTOCOMPLETE_LIMIT);

    await delay(SCAN_LATENCY_MS);

    const matches = products.filter(
      (product) =>
        (barcode === null || product.barcode === barcode) &&
        (sku === undefined || product.sku.toLowerCase() === sku) &&
        (term === undefined ||
          [product.label, product.sku, product.barcode ?? ""].some((field) =>
            field.toLowerCase().includes(term),
          )),
    );

    return HttpResponse.json({
      data: {
        items: matches.slice(0, limit).map(({ label, ...product }) => ({ ...product, name: label })),
        limit,
        skip: 0,
        total: matches.length,
      },
    });
  }),
];

/** Como el POS: cada escaneo agrega una línea y el campo queda libre. */
function ScanDemo() {
  const [lines, setLines] = useState<ProductEntityOption[]>([]);
  const [notFound, setNotFound] = useState<string[]>([]);

  return (
    <div className="max-w-md space-y-3">
      <EntityAutocomplete
        entity="product"
        helperText="Escanea varios códigos seguidos: la respuesta tarda más que la pausa entre ellos."
        label="Escanear producto"
        onChange={(option) => {
          if (option) {
            setLines((current) => [...current, option]);
          }
        }}
        onNotFound={(code) => setNotFound((current) => [...current, code])}
        recentsKey="storybook-scan"
        value={null}
      />
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Líneas agregadas: {lines.length}</p>
        <ol aria-label="Líneas agregadas" className="list-decimal pl-5">
          {lines.map((line, index) => (
            <li className="break-all" key={`${line.id}-${index}`}>{line.label}</li>
          ))}
        </ol>
        <p>Códigos no encontrados: {notFound.length}</p>
        <ul aria-label="Códigos no encontrados" className="list-disc pl-5">
          {notFound.map((code, index) => (
            <li className="break-all" key={`${code}-${index}`}>{code}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function seedRecents() {
  window.localStorage.setItem(
    getEntityRecentsStorageKey("product", "storybook"),
    JSON.stringify(products.slice(0, 3)),
  );

  return () => window.localStorage.removeItem(getEntityRecentsStorageKey("product", "storybook"));
}

export const Products: Story = {
  name: "Productos",
  render: () => (
    <Demo
      entity="product"
      fetcher={fakeProductFetcher}
      filters={{ active: true }}
      getOptionDisabled={(option) => (option.currentStock === 0 ? "Sin stock" : null)}
      label="Producto"
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox"), "arroz");

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("option", { name: /Arroz Mary/ })).toBeVisible();
  },
};

export const SupplierContacts: Story = {
  name: "Contactos proveedores",
  render: () => (
    <Demo
      entity="contact"
      fetcher={fakeContactFetcher}
      filters={{ type: ["proveedor", "ambos"] }}
      label="Proveedor"
      placeholder="Buscar proveedor por nombre o RIF"
      required
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox"), "ma");

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("option", { name: /Mayorista El Trigal/ })).toBeVisible();
    await expect(body.queryByRole("option", { name: /María Pérez/ })).toBeNull();
  },
};

export const BarcodeScanner: Story = {
  name: "Lector de barras",
  parameters: {
    msw: { handlers: scanHandlers },
  },
  render: () => <ScanDemo />,
};

export const BarcodeScannerBurst: Story = {
  name: "Lector de barras: ráfaga",
  parameters: {
    msw: { handlers: scanHandlers },
  },
  render: () => <ScanDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByRole("combobox");
    const body = within(canvasElement.ownerDocument.body);
    const lines = within(canvas.getByRole("list", { name: "Líneas agregadas" }));
    const notFound = within(canvas.getByRole("list", { name: "Códigos no encontrados" }));

    // Dos escaneos y un código desconocido antes de que responda el primero.
    await userEvent.type(
      input,
      `${products[2].barcode}{Enter}${products[4].barcode}{Enter}7599999999999{Enter}`,
    );
    await expect(input).toHaveValue("");

    await waitFor(
      async () => {
        await expect(lines.getAllByRole("listitem").map((line) => line.textContent)).toEqual([
          products[2].label,
          products[4].label,
        ]);
        await expect(notFound.getAllByRole("listitem").map((code) => code.textContent)).toEqual([
          "7599999999999",
        ]);
      },
      { timeout: 4000 },
    );

    // Coincide a medias con un único producto: no se elige, la lista queda abierta.
    await userEvent.type(input, "{Control>}a{/Control}000000007{Enter}");
    await expect(await body.findByRole("option", { name: /Azúcar Montalbán/ }, { timeout: 4000 })).toBeVisible();
    await expect(lines.getAllByRole("listitem")).toHaveLength(2);
  },
};

export const WithRecents: Story = {
  name: "Con recientes",
  beforeEach: seedRecents,
  render: () => (
    <Demo entity="product" fetcher={fakeProductFetcher} label="Producto" recentsKey="storybook" />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("combobox"));

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByText("Recientes")).toBeVisible();
  },
};

export const WithValue: Story = {
  name: "Con valor",
  render: () => (
    <Demo
      entity="product"
      fetcher={fakeProductFetcher}
      initialValue={{ id: products[0].id, label: products[0].label }}
      label="Producto"
    />
  ),
};

export const Loading: Story = {
  name: "Cargando",
  render: () => <Demo entity="product" fetcher={neverResolves} label="Producto" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox"), "harina");

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByText("Buscando...")).toBeVisible();
  },
};

export const NetworkError: Story = {
  name: "Error",
  render: () => <Demo entity="product" fetcher={alwaysFails} label="Producto" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox"), "harina");

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("button", { name: "Reintentar" })).toBeVisible();
  },
};

export const NoResults: Story = {
  name: "Sin resultados",
  render: () => <Demo entity="product" fetcher={fakeProductFetcher} label="Producto" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox"), "zzz");

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByText(/Sin resultados para/)).toBeVisible();
  },
};

export const Disabled: Story = {
  name: "Deshabilitado y con error",
  render: () => (
    <div className="max-w-md space-y-6">
      <Demo
        disabled
        entity="product"
        fetcher={fakeProductFetcher}
        initialValue={{ id: products[1].id, label: products[1].label }}
        label="Producto (deshabilitado)"
      />
      <Demo
        entity="contact"
        error="Elige un proveedor."
        fetcher={fakeContactFetcher}
        label="Proveedor"
        required
      />
    </div>
  ),
};

export const InsideModal: Story = {
  name: "Dentro de un Modal",
  render: () => (
    <Modal
      description="El desplegable se monta en un portal: no lo recorta el cuerpo del modal."
      footer={<Button>Guardar</Button>}
      open
      title="Vincular producto"
    >
      <Demo entity="product" fetcher={fakeProductFetcher} label="Producto" />
    </Modal>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.type(await body.findByRole("combobox"), "pasta");
    await expect(await body.findByRole("option", { name: /Pasta Capri/ })).toBeVisible();
  },
};

export const Mobile390: Story = {
  name: "390 px",
  globals: {
    viewport: { isRotated: false, value: "mobile390" },
  },
  parameters: {
    viewport: {
      options: {
        mobile390: {
          name: "Móvil 390 px",
          styles: { height: "844px", width: "390px" },
          type: "mobile",
        },
      },
    },
  },
  render: () => (
    <Demo
      entity="product"
      fetcher={fakeProductFetcher}
      label="Producto"
      placeholder="Nombre, SKU o código de barras"
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox"), "harina");

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("option", { name: /Harina de trigo/ })).toBeVisible();
  },
};
