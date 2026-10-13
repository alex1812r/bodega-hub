/**
 * @jest-environment node
 */

import { ApiError } from "@/lib/api/apiError";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

type SupplierProductsMock = typeof import("./supplierProducts.mock-server");
type ContactsMock = typeof import("./contacts.mock-server");

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
/** Producto de la tienda por defecto sin ningún vínculo en los datos de ejemplo. */
const PRODUCT = "prod-paint";
const SUPPLIER = "cont-supplier";
const BOTH = "cont-both";
const TOOLS = "cont-supplier-tools";

/** Cada test parte de los datos de ejemplo recién cargados: el mock persiste en memoria. */
function load(): { contacts: ContactsMock; service: SupplierProductsMock } {
  let loaded: { contacts: ContactsMock; service: SupplierProductsMock } | undefined;

  jest.isolateModules(() => {
    loaded = {
      contacts: jest.requireActual<ContactsMock>("./contacts.mock-server"),
      service: jest.requireActual<SupplierProductsMock>("./supplierProducts.mock-server"),
    };
  });

  if (!loaded) throw new Error("No se pudo cargar el mock");

  return loaded;
}

function rejection(run: () => unknown): { message: string; status: number } {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      const apiError = error as ApiError;
      return { message: apiError.message, status: apiError.status };
    }
    throw error;
  }

  throw new Error("Se esperaba un rechazo");
}

/** Estado de los vínculos del producto: `proveedor*` = habitual, `(off)` = inactivo. */
function links(service: SupplierProductsMock, productId = PRODUCT) {
  return service
    .listProductSuppliers(productId, new URLSearchParams({ limit: "100" }), DEFAULT_STORE_ID)
    .items.map(
      (item) => `${item.supplierId}${item.isPreferred ? "*" : ""}${item.isActive ? "" : "(off)"}`,
    )
    .sort();
}

describe("supplierProducts.mock-server · proveedor habitual", () => {
  it("los datos de ejemplo nacen con un habitual por producto con vínculos activos y ninguno en los inactivos", () => {
    const { service } = load();

    expect({
      cable: links(service, "prod-cable"),
      drill: links(service, "prod-drill"),
      pipe: links(service, "prod-pipe"),
    }).toEqual({
      cable: [`${SUPPLIER}*`],
      drill: [`${BOTH}*`],
      pipe: [`${BOTH}(off)`],
    });
  });

  it("el primer vínculo creado por el camino de contactos queda habitual y el segundo no", () => {
    const { service } = load();

    const first = service.createSupplierProduct(
      { productId: PRODUCT, supplierId: SUPPLIER, supplierSku: undefined },
      DEFAULT_STORE_ID,
    );
    const second = service.createSupplierProduct(
      { productId: PRODUCT, supplierId: BOTH, supplierSku: undefined },
      DEFAULT_STORE_ID,
    );

    expect({ first: first.isPreferred, second: second.isPreferred, links: links(service) }).toEqual({
      first: true,
      links: [`${BOTH}`, `${SUPPLIER}*`],
      second: false,
    });
  });

  it("reactivar por el camino de contactos el único vínculo de un producto lo deja habitual", () => {
    const { service } = load();

    const reactivated = service.createSupplierProduct(
      { productId: "prod-pipe", supplierId: BOTH, supplierSku: undefined },
      DEFAULT_STORE_ID,
    );

    expect(reactivated.isPreferred).toBe(true);
  });

  it("dos proveedores: guarda costo y código, marca el habitual pedido y registra el historial de cada costo", () => {
    const { service } = load();

    const saved = service.saveProductSuppliers(
      PRODUCT,
      [
        { costRef: 4.5, isPreferred: false, supplierId: SUPPLIER, supplierSku: "sup-pin-01" },
        { costRef: 4.2, isPreferred: true, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    expect({
      autoAssigned: saved.preferredAutoAssigned,
      changed: saved.preferredChanged,
      preferred: saved.preferredSupplierId,
      previous: saved.previousPreferredSupplierId,
      suppliers: saved.suppliers.map((link) => ({
        costRef: link.costRef,
        isPreferred: link.isPreferred,
        supplierId: link.supplierId,
        supplierIsActive: link.supplierIsActive,
        supplierName: link.supplierName,
        supplierSku: link.supplierSku,
      })),
    }).toEqual({
      autoAssigned: false,
      changed: true,
      preferred: BOTH,
      previous: null,
      suppliers: [
        {
          costRef: 4.2,
          isPreferred: true,
          supplierId: BOTH,
          supplierIsActive: true,
          supplierName: "Comercial Doble Via",
          supplierSku: undefined,
        },
        {
          costRef: 4.5,
          isPreferred: false,
          supplierId: SUPPLIER,
          supplierIsActive: true,
          supplierName: "Suministros Industriales CA",
          supplierSku: "sup-pin-01",
        },
      ],
    });

    const history = saved.suppliers.map((link) =>
      service
        .listSupplierProductPriceHistory(link.id, new URLSearchParams(), DEFAULT_STORE_ID)
        .items.map((entry) => `${entry.origin}:${entry.newCostRef}`),
    );

    expect(history).toEqual([["vinculacion:4.2"], ["vinculacion:4.5"]]);
  });

  it("cambiar el habitual: el anterior deja de serlo en la misma llamada y nunca hay dos", () => {
    const { service } = load();
    service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: true, supplierId: SUPPLIER },
        { isPreferred: false, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    const saved = service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: false, supplierId: SUPPLIER },
        { isPreferred: true, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    expect({
      autoAssigned: saved.preferredAutoAssigned,
      changed: saved.preferredChanged,
      links: links(service),
      preferred: saved.preferredSupplierId,
      previous: saved.previousPreferredSupplierId,
    }).toEqual({
      autoAssigned: false,
      changed: true,
      links: [`${BOTH}*`, `${SUPPLIER}`],
      preferred: BOTH,
      previous: SUPPLIER,
    });
  });

  it("sin marcar ninguno se conserva el habitual actual si sigue en la lista, y un costo igual no añade historial", () => {
    const { service } = load();
    const first = service.saveProductSuppliers(
      PRODUCT,
      [
        { costRef: 3, isPreferred: false, supplierId: SUPPLIER },
        { costRef: 5, isPreferred: true, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    const saved = service.saveProductSuppliers(
      PRODUCT,
      [
        { costRef: 3.4, isPreferred: false, supplierId: SUPPLIER },
        { costRef: 5, isPreferred: false, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );
    const historyOf = (supplierId: string) =>
      service
        .listSupplierProductPriceHistory(
          first.suppliers.find((link) => link.supplierId === supplierId)?.id ?? "",
          new URLSearchParams(),
          DEFAULT_STORE_ID,
        )
        .items.map((entry) => `${entry.origin}:${entry.newCostRef}`)
        .sort();

    expect({
      autoAssigned: saved.preferredAutoAssigned,
      changed: saved.preferredChanged,
      preferred: saved.preferredSupplierId,
      sameCost: historyOf(BOTH),
      newCost: historyOf(SUPPLIER),
    }).toEqual({
      autoAssigned: false,
      changed: false,
      newCost: ["ajuste:3.4", "vinculacion:3"],
      preferred: BOTH,
      sameCost: ["vinculacion:5"],
    });
  });

  it("quitar el habitual sin marcar otro: el vínculo se desactiva (no se borra) y el habitual pasa al primero de la lista", () => {
    const { service } = load();
    service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: true, supplierId: SUPPLIER },
        { isPreferred: false, supplierId: BOTH },
        { isPreferred: false, supplierId: TOOLS },
      ],
      DEFAULT_STORE_ID,
    );

    const saved = service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: false, supplierId: TOOLS },
        { isPreferred: false, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    expect({
      autoAssigned: saved.preferredAutoAssigned,
      changed: saved.preferredChanged,
      links: links(service),
      preferred: saved.preferredSupplierId,
      previous: saved.previousPreferredSupplierId,
      returned: saved.suppliers.map((link) => link.supplierId),
    }).toEqual({
      autoAssigned: true,
      changed: true,
      links: [`${BOTH}`, `${SUPPLIER}(off)`, `${TOOLS}*`],
      preferred: TOOLS,
      previous: SUPPLIER,
      returned: [TOOLS, BOTH],
    });
  });

  it("quitar todos: lista vacía desactiva todos los vínculos y el producto queda sin habitual", () => {
    const { service } = load();
    service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: true, supplierId: SUPPLIER },
        { isPreferred: false, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    const saved = service.saveProductSuppliers(PRODUCT, [], DEFAULT_STORE_ID);

    expect({
      autoAssigned: saved.preferredAutoAssigned,
      changed: saved.preferredChanged,
      links: links(service),
      preferred: saved.preferredSupplierId,
      suppliers: saved.suppliers,
    }).toEqual({
      autoAssigned: true,
      changed: true,
      links: [`${BOTH}(off)`, `${SUPPLIER}(off)`],
      preferred: null,
      suppliers: [],
    });
  });

  it("volver a añadir un proveedor quitado reactiva su vínculo (mismo id) en vez de crear otro", () => {
    const { service } = load();
    const first = service.saveProductSuppliers(
      PRODUCT,
      [{ isPreferred: false, supplierId: SUPPLIER }],
      DEFAULT_STORE_ID,
    );
    service.saveProductSuppliers(PRODUCT, [], DEFAULT_STORE_ID);

    const again = service.saveProductSuppliers(
      PRODUCT,
      [{ isPreferred: false, supplierId: SUPPLIER }],
      DEFAULT_STORE_ID,
    );

    expect({
      autoAssigned: again.preferredAutoAssigned,
      links: links(service),
      sameId: again.suppliers[0]?.id === first.suppliers[0]?.id,
    }).toEqual({ autoAssigned: true, links: [`${SUPPLIER}*`], sameId: true });
  });

  it("el mismo proveedor dos veces se funde en una fila: gana la última aparición y es habitual si alguna lo marca", () => {
    const { service } = load();

    const saved = service.saveProductSuppliers(
      PRODUCT,
      [
        { costRef: 1, isPreferred: true, supplierId: SUPPLIER, supplierSku: "viejo" },
        { isPreferred: false, supplierId: BOTH },
        { costRef: 9, isPreferred: false, supplierId: SUPPLIER, supplierSku: "nuevo" },
      ],
      DEFAULT_STORE_ID,
    );

    expect(
      saved.suppliers.map((link) => ({
        costRef: link.costRef,
        isPreferred: link.isPreferred,
        supplierId: link.supplierId,
        supplierSku: link.supplierSku,
      })),
    ).toEqual([
      { costRef: 9, isPreferred: true, supplierId: SUPPLIER, supplierSku: "nuevo" },
      { costRef: 0, isPreferred: false, supplierId: BOTH, supplierSku: undefined },
    ]);
  });

  it("un proveedor inactivo no entra en un vínculo nuevo ni puede marcarse habitual: 400 y nada cambia", () => {
    const { contacts, service } = load();
    service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: true, supplierId: SUPPLIER },
        { isPreferred: false, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );
    contacts.updateContact(TOOLS, { isActive: false }, DEFAULT_STORE_ID);

    const asNewLink = rejection(() =>
      service.saveProductSuppliers(
        PRODUCT,
        [
          { isPreferred: true, supplierId: SUPPLIER },
          { isPreferred: false, supplierId: TOOLS },
        ],
        DEFAULT_STORE_ID,
      ),
    );

    contacts.updateContact(BOTH, { isActive: false }, DEFAULT_STORE_ID);
    const asPreferred = rejection(() =>
      service.saveProductSuppliers(
        PRODUCT,
        [
          { isPreferred: false, supplierId: SUPPLIER },
          { isPreferred: true, supplierId: BOTH },
        ],
        DEFAULT_STORE_ID,
      ),
    );
    const keptUnmarked = service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: false, supplierId: SUPPLIER },
        { isPreferred: false, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    expect({ asNewLink, asPreferred, kept: keptUnmarked.preferredSupplierId, links: links(service) }).toEqual({
      asNewLink: {
        message: "El proveedor Herramientas del Lago está inactivo: no se puede vincular al producto.",
        status: 400,
      },
      asPreferred: {
        message: "El proveedor Comercial Doble Via está inactivo: no puede ser el habitual del producto.",
        status: 400,
      },
      kept: SUPPLIER,
      links: [`${BOTH}`, `${SUPPLIER}*`],
    });
  });

  it("desactivar al proveedor habitual lo suelta: el habitual pasa al siguiente vínculo activo o el producto queda sin habitual", () => {
    const { contacts, service } = load();
    service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: true, supplierId: SUPPLIER },
        { isPreferred: false, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    contacts.updateContact(SUPPLIER, { isActive: false }, DEFAULT_STORE_ID);
    const afterFirst = links(service);
    contacts.updateContact(BOTH, { isActive: false }, DEFAULT_STORE_ID);

    expect({ afterFirst, afterBoth: links(service) }).toEqual({
      afterBoth: [`${BOTH}`, `${SUPPLIER}`],
      afterFirst: [`${BOTH}*`, `${SUPPLIER}`],
    });
  });

  it("desactivar el vínculo habitual por el camino de contactos pasa el habitual al siguiente; sin más vínculos, queda sin habitual", () => {
    const { service } = load();
    const saved = service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: true, supplierId: SUPPLIER },
        { isPreferred: false, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );
    const idOf = (supplierId: string) =>
      saved.suppliers.find((link) => link.supplierId === supplierId)?.id ?? "";

    service.deactivateSupplierProduct(idOf(SUPPLIER), DEFAULT_STORE_ID);
    const afterFirst = links(service);
    service.updateSupplierProduct(idOf(BOTH), { isActive: false, supplierSku: undefined }, DEFAULT_STORE_ID);

    expect({ afterFirst, afterBoth: links(service) }).toEqual({
      afterBoth: [`${BOTH}(off)`, `${SUPPLIER}(off)`],
      afterFirst: [`${BOTH}*`, `${SUPPLIER}(off)`],
    });
  });

  it("rechaza con 400 más de un habitual, más de 50 proveedores y un contacto que no es proveedor de la tienda", () => {
    const { service } = load();

    const rejections = [
      rejection(() =>
        service.saveProductSuppliers(
          PRODUCT,
          [
            { isPreferred: true, supplierId: SUPPLIER },
            { isPreferred: true, supplierId: BOTH },
          ],
          DEFAULT_STORE_ID,
        ),
      ),
      rejection(() =>
        service.saveProductSuppliers(
          PRODUCT,
          Array.from({ length: 51 }, () => ({ isPreferred: false, supplierId: SUPPLIER })),
          DEFAULT_STORE_ID,
        ),
      ),
      rejection(() =>
        service.saveProductSuppliers(
          PRODUCT,
          [{ isPreferred: false, supplierId: "cont-customer" }],
          DEFAULT_STORE_ID,
        ),
      ),
      rejection(() =>
        service.saveProductSuppliers(
          PRODUCT,
          [{ isPreferred: false, supplierId: "no-existe" }],
          DEFAULT_STORE_ID,
        ),
      ),
    ];

    expect({ links: links(service), rejections }).toEqual({
      links: [],
      rejections: [
        { message: "Solo un proveedor puede ser el habitual del producto.", status: 400 },
        { message: "Un producto admite como máximo 50 proveedores.", status: 400 },
        { message: "Proveedor no encontrado.", status: 400 },
        { message: "Proveedor no encontrado.", status: 400 },
      ],
    });
  });

  it("producto inexistente responde 404 y el de otra tienda 403; un proveedor de otra tienda no se puede vincular", () => {
    const { service } = load();

    expect([
      rejection(() => service.saveProductSuppliers("no-existe", [], DEFAULT_STORE_ID)).status,
      rejection(() => service.saveProductSuppliers("prod-sur-arroz", [], DEFAULT_STORE_ID)).status,
      rejection(() =>
        service.saveProductSuppliers(
          "prod-sur-arroz",
          [{ isPreferred: false, supplierId: SUPPLIER }],
          OTHER_STORE_ID,
        ),
      ).status,
    ]).toEqual([404, 403, 400]);
  });

  it("listPreferredSuppliersByProduct devuelve el habitual de cada producto pedido de la tienda, y nada de otra tienda", () => {
    const { service } = load();
    service.saveProductSuppliers(
      PRODUCT,
      [
        { isPreferred: false, supplierId: SUPPLIER },
        { isPreferred: true, supplierId: BOTH },
      ],
      DEFAULT_STORE_ID,
    );

    const own = service.listPreferredSuppliersByProduct(
      [PRODUCT, "prod-cable", "prod-pipe", "prod-latex"],
      DEFAULT_STORE_ID,
    );
    const foreign = service.listPreferredSuppliersByProduct([PRODUCT, "prod-cable"], OTHER_STORE_ID);

    expect({ foreign: [...foreign], own: [...own].sort() }).toEqual({
      foreign: [],
      own: [
        ["prod-cable", { id: SUPPLIER, name: "Suministros Industriales CA" }],
        [PRODUCT, { id: BOTH, name: "Comercial Doble Via" }],
      ],
    });
  });
});
