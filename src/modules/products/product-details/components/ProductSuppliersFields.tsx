"use client";

import { Trash2 } from "lucide-react";
import { type KeyboardEvent, useId } from "react";

import { Can } from "@/shared/auth/Can";
import type { Permission } from "@/shared/auth/permissions";
import { Button } from "@/shared/components/Button";
import {
  type ContactEntityFilters,
  EntityAutocomplete,
  type EntityFetcher,
} from "@/shared/components/EntityAutocomplete";
import { IconButton } from "@/shared/components/IconButton";
import { Input } from "@/shared/components/Input";
import { NumberInput, parseNumberInput } from "@/shared/components/NumberInput";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd } from "@/shared/utils/currency";

import type { ProductSupplierSaveInput } from "../../hooks/useProducts";
import {
  PRODUCT_SUPPLIER_MAX_COST_REF,
  PRODUCT_SUPPLIERS_MAX,
} from "../../services/productSuppliers";

/** Filtros con los que el formulario pide los proveedores del producto en edición. */
export const PRODUCT_SUPPLIERS_LOAD_FILTERS = {
  isActive: true,
  limit: 100,
} as const;

const SUPPLIER_SKU_MAX_LENGTH = 120;
const ALREADY_LISTED_REASON = "Ya está en la lista";
const INACTIVE_OPTION_REASON = "Proveedor inactivo";
const INACTIVE_PREFERRED_REASON = "Proveedor inactivo: no puede ser el habitual.";
const NO_PREFERRED_NOTICE = "Este producto queda sin proveedor habitual.";
const NO_CONTACTS_ACCESS_HELP =
  "Para añadir proveedores necesitas acceso a Contactos. Puedes cambiar el habitual, el costo y el SKU de los ya vinculados.";
/** El permiso que exige `GET /api/contacts`, de donde salen las opciones del buscador. */
const SUPPLIER_SEARCH_PERMISSION: Permission = "contacts.view";

// Solo proveedores (o contactos que son cliente y proveedor) activos.
const SUPPLIER_FILTERS: ContactEntityFilters = {
  active: true,
  type: ["proveedor", "ambos"],
};

/** Lo que el formulario lee de un vínculo de `GET /api/products/[id]/suppliers`. */
export type ProductSupplierLinkSource = {
  isActive?: boolean;
  isPreferred?: boolean;
  /** 0 (o ausente) = sin costo registrado. */
  lastCostRef?: number;
  supplier?: { isActive?: boolean; name: string };
  supplierId: string;
  supplierSku?: string;
};

/** Un proveedor del producto tal como se edita en el formulario. */
export type ProductSupplierFormRow = {
  /** Texto del campo "Costo REF"; vacío = sin costo (no se envía). */
  costRef: string;
  /** Costo guardado al cargar (solo vínculos que ya existían y tenían costo). */
  initialCostRef?: number;
  /** Código guardado al cargar: vaciarlo lo borra (`supplierSku: null`). */
  initialSupplierSku?: string;
  supplierId: string;
  /** Un proveedor inactivo se conserva en la lista, pero no puede ser el habitual. */
  supplierIsActive: boolean;
  supplierName: string;
  supplierSku: string;
};

export type ProductSuppliersFormState = {
  /** Aviso en línea tras quitar al habitual: a quién pasa, o que el producto queda sin él. */
  notice: string | null;
  /** El habitual marcado en el formulario; como mucho uno. */
  preferredSupplierId: string | null;
  rows: ProductSupplierFormRow[];
};

export const EMPTY_PRODUCT_SUPPLIERS_STATE: ProductSuppliersFormState = {
  notice: null,
  preferredSupplierId: null,
  rows: [],
};

export type ProductSuppliersErrors = {
  /** Aviso por proveedor (`supplierId`) con el costo que no vale. */
  costs: Record<string, string>;
  /** Aviso de la lista entera (demasiados proveedores). */
  list?: string;
};

/** Estado del formulario a partir de los vínculos ACTIVOS que devuelve el servidor. */
export function createProductSuppliersState(
  links: ProductSupplierLinkSource[],
): ProductSuppliersFormState {
  const rows: ProductSupplierFormRow[] = [];
  let preferredSupplierId: string | null = null;

  for (const link of links) {
    if (link.isActive === false || rows.some((row) => row.supplierId === link.supplierId)) {
      continue;
    }

    const supplierIsActive = link.supplier?.isActive !== false;
    const lastCostRef = link.lastCostRef ?? 0;

    rows.push({
      costRef: lastCostRef > 0 ? String(lastCostRef) : "",
      ...(lastCostRef > 0 ? { initialCostRef: lastCostRef } : {}),
      ...(link.supplierSku ? { initialSupplierSku: link.supplierSku } : {}),
      supplierId: link.supplierId,
      supplierIsActive,
      supplierName: link.supplier?.name ?? link.supplierId,
      supplierSku: link.supplierSku ?? "",
    });

    if (link.isPreferred && supplierIsActive) {
      preferredSupplierId = link.supplierId;
    }
  }

  return { notice: null, preferredSupplierId, rows };
}

/**
 * Añade un proveedor. El mismo proveedor dos veces se funde en su fila (no se
 * duplica). Si el producto no tenía habitual, el añadido pasa a serlo: es la
 * regla del servidor para el primer vínculo activo.
 */
export function addProductSupplier(
  state: ProductSuppliersFormState,
  supplier: { id: string; isActive: boolean; label: string },
): ProductSuppliersFormState {
  if (state.rows.some((row) => row.supplierId === supplier.id)) {
    return state;
  }

  const becomesPreferred = state.preferredSupplierId === null && supplier.isActive;

  return {
    notice: becomesPreferred ? null : state.notice,
    preferredSupplierId: becomesPreferred ? supplier.id : state.preferredSupplierId,
    rows: [
      ...state.rows,
      {
        costRef: "",
        supplierId: supplier.id,
        supplierIsActive: supplier.isActive,
        supplierName: supplier.label,
        supplierSku: "",
      },
    ],
  };
}

/**
 * Quita un proveedor (al guardar, su vínculo se desactiva). Si era el habitual,
 * pasa al primero de la lista con proveedor activo y se avisa; si no queda
 * ninguno, el producto queda sin habitual y también se avisa.
 */
export function removeProductSupplier(
  state: ProductSuppliersFormState,
  supplierId: string,
): ProductSuppliersFormState {
  const rows = state.rows.filter((row) => row.supplierId !== supplierId);

  if (state.preferredSupplierId !== supplierId) {
    return { ...state, rows };
  }

  const next = rows.find((row) => row.supplierIsActive);

  return {
    notice: next ? `El habitual pasa a ${next.supplierName}.` : NO_PREFERRED_NOTICE,
    preferredSupplierId: next?.supplierId ?? null,
    rows,
  };
}

/** Marca al habitual. Un proveedor inactivo (o que no está en la lista) no se puede marcar. */
export function setPreferredProductSupplier(
  state: ProductSuppliersFormState,
  supplierId: string,
): ProductSuppliersFormState {
  const row = state.rows.find((candidate) => candidate.supplierId === supplierId);

  return row?.supplierIsActive
    ? { ...state, notice: null, preferredSupplierId: supplierId }
    : state;
}

/**
 * Cuerpo del `PUT /api/products/[id]/suppliers`: el estado deseado completo.
 * El costo solo viaja si está escrito (sin él, el del vínculo no se toca). El
 * código viaja si está escrito y, vaciado uno que existía, como `null` (lo
 * borra); si nunca lo hubo, no viaja.
 */
export function buildProductSuppliersPayload(
  state: ProductSuppliersFormState,
): ProductSupplierSaveInput[] {
  return state.rows.map((row) => {
    const costRef = row.costRef.trim() === "" ? null : parseNumberInput(row.costRef);
    const supplierSku = row.supplierSku.trim();

    return {
      ...(costRef === null ? {} : { costRef }),
      isPreferred: row.supplierId === state.preferredSupplierId,
      supplierId: row.supplierId,
      ...(supplierSku ? { supplierSku } : row.initialSupplierSku ? { supplierSku: null } : {}),
    };
  });
}

function getCostError(text: string) {
  if (text.trim() === "") {
    return undefined;
  }

  const cost = parseNumberInput(text);

  if (cost === null) {
    return "Escribe un costo válido.";
  }

  if (cost < 0) {
    return "El costo no puede ser negativo.";
  }

  return cost > PRODUCT_SUPPLIER_MAX_COST_REF ? "El costo está fuera de rango." : undefined;
}

function getListError(rows: ProductSupplierFormRow[]) {
  const extra = rows.length - PRODUCT_SUPPLIERS_MAX;

  return extra > 0
    ? `Un producto admite como máximo ${PRODUCT_SUPPLIERS_MAX} proveedores: quita ${extra}.`
    : undefined;
}

/** Lo que impide guardar los proveedores, o `undefined` si todo vale. */
export function getProductSuppliersErrors(
  state: ProductSuppliersFormState,
): ProductSuppliersErrors | undefined {
  const costs: Record<string, string> = {};

  for (const row of state.rows) {
    const error = getCostError(row.costRef);

    if (error) {
      costs[row.supplierId] = error;
    }
  }

  const list = getListError(state.rows);

  return list || Object.keys(costs).length > 0 ? { costs, ...(list ? { list } : {}) } : undefined;
}

/** El campo que debe recibir el foco para corregir `errors`. */
export function findProductSuppliersInvalidField(
  form: HTMLFormElement,
  errors: ProductSuppliersErrors,
): HTMLElement | null {
  const costHolder = Array.from(
    form.querySelectorAll<HTMLElement>("[data-product-supplier-cost]"),
  ).find((holder) => (holder.dataset.productSupplierCost ?? "") in errors.costs);

  return (
    costHolder?.querySelector<HTMLElement>("input") ??
    form.querySelector<HTMLElement>("[data-product-supplier-remove]")
  );
}

const PREVIOUS_KEYS = ["ArrowUp", "ArrowLeft"];
const NEXT_KEYS = ["ArrowDown", "ArrowRight"];

type ProductSuppliersFieldsProps = {
  /** Mientras se cargan los proveedores del producto (edición). */
  isLoading?: boolean;
  /** No se pudieron cargar: la lista no se muestra ni se guarda. */
  loadError?: string;
  onChange: (state: ProductSuppliersFormState) => void;
  onRetryLoad?: () => void;
  /** Tras intentar enviar: muestra los avisos de costo. */
  showErrors?: boolean;
  state: ProductSuppliersFormState;
  /** Búsqueda de proveedores; por defecto `GET /api/contacts`. */
  supplierFetcher?: EntityFetcher<"contact">;
};

/**
 * Proveedores de un producto dentro de su formulario (sin título propio: lo
 * pone la sección que lo contiene): la lista de vínculos con
 * costo y código opcionales, quién es el habitual (uno por producto) y un
 * buscador para añadir. No guarda nada: el formulario envía el estado completo
 * con `buildProductSuppliersPayload` en un solo `PUT`.
 */
export function ProductSuppliersFields({
  isLoading = false,
  loadError,
  onChange,
  onRetryLoad,
  showErrors = false,
  state,
  supplierFetcher,
}: ProductSuppliersFieldsProps) {
  const radioName = useId();
  const reasonIdPrefix = useId();
  const errors = getProductSuppliersErrors(state);
  const listedIds = state.rows.map((row) => row.supplierId);

  function patchRow(supplierId: string, patch: Partial<ProductSupplierFormRow>) {
    onChange({
      ...state,
      rows: state.rows.map((row) => (row.supplierId === supplierId ? { ...row, ...patch } : row)),
    });
  }

  // Flechas: el habitual pasa al radio anterior o siguiente que se pueda marcar.
  function handleRadioKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    const step = NEXT_KEYS.includes(event.key) ? 1 : PREVIOUS_KEYS.includes(event.key) ? -1 : 0;

    if (step === 0 || !(target instanceof HTMLInputElement) || target.type !== "radio") {
      return;
    }

    const radios = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]:not(:disabled)'),
    );
    const next = radios[(radios.indexOf(target) + step + radios.length) % radios.length];

    event.preventDefault();

    if (next && next !== target) {
      onChange(setPreferredProductSupplier(state, next.value));
      next.focus();
    }
  }

  return (
    <div
      aria-label="Proveedores"
      className="grid min-w-0 gap-3"
      data-product-suppliers
      role="group"
    >
      <p className="text-sm text-on-surface-variant">
        A quién le compras este producto. El habitual es su proveedor principal.
      </p>
      {loadError ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          role="alert"
        >
          <span className="min-w-0 flex-1 break-words">
            No pudimos cargar los proveedores: {loadError}
          </span>
          {onRetryLoad ? (
            <Button onClick={onRetryLoad} size="sm" variant="outline">
              Reintentar
            </Button>
          ) : null}
        </div>
      ) : isLoading ? (
        <p className="text-sm text-on-surface-variant">Cargando proveedores...</p>
      ) : (
        <>
          {state.rows.length === 0 ? (
            <p className="text-sm text-on-surface-variant">
              Este producto no tiene proveedores vinculados.
            </p>
          ) : (
            <div
              aria-label="Proveedor habitual"
              className="grid gap-3"
              onKeyDown={handleRadioKeyDown}
              role="radiogroup"
            >
              {state.rows.map((row, index) => {
                const reasonId = `${reasonIdPrefix}-${index}`;
                const isPreferred = row.supplierId === state.preferredSupplierId;
                const wasCostCleared =
                  row.initialCostRef !== undefined && row.costRef.trim() === "";

                return (
                  // La fila vive en un diálogo estrecho (≈ 360–520 px) en cualquier
                  // pantalla: su reparto depende del ancho del contenedor, nunca
                  // del de la ventana (sin `sm:` / `md:`).
                  <div
                    className="grid min-w-0 gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2.5"
                    data-product-supplier-row={row.supplierId}
                    key={row.supplierId}
                  >
                    {/* Línea 1: nombre + Habitual + Quitar. Si el nombre no
                        dispone de 9rem, los controles bajan a su propia línea. */}
                    <div
                      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                      data-product-supplier-header
                    >
                      <p
                        className="min-w-0 flex-1 basis-36 break-words text-sm font-medium text-foreground"
                        data-product-supplier-name
                      >
                        {row.supplierName}
                        {row.supplierIsActive ? null : (
                          <span className="ml-2 inline-block rounded-full bg-surface-container-high px-2 py-0.5 align-middle text-xs font-semibold text-on-surface-variant">
                            Inactivo
                          </span>
                        )}
                      </p>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <label
                          className={cn(
                            "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2 text-sm text-foreground",
                            row.supplierIsActive
                              ? "cursor-pointer hover:bg-surface-container-high"
                              : "cursor-not-allowed",
                          )}
                        >
                          <input
                            aria-describedby={row.supplierIsActive ? undefined : reasonId}
                            aria-label={`Habitual: ${row.supplierName}`}
                            checked={isPreferred}
                            className="size-4 shrink-0 cursor-pointer rounded-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
                            disabled={!row.supplierIsActive}
                            name={radioName}
                            onChange={() =>
                              onChange(setPreferredProductSupplier(state, row.supplierId))
                            }
                            type="radio"
                            value={row.supplierId}
                          />
                          <span className={row.supplierIsActive ? undefined : "opacity-60"}>
                            Habitual
                          </span>
                        </label>
                        <IconButton
                          aria-label={`Quitar a ${row.supplierName}`}
                          className="h-9 w-9 shrink-0"
                          data-product-supplier-remove
                          icon={<Trash2 aria-hidden="true" className="size-4" />}
                          onClick={() => onChange(removeProductSupplier(state, row.supplierId))}
                          variant="outline"
                        />
                      </div>
                    </div>
                    {row.supplierIsActive ? null : (
                      <p className="text-xs text-on-surface-variant" id={reasonId}>
                        {INACTIVE_PREFERRED_REASON}
                      </p>
                    )}
                    {/* Línea 2: costo y SKU en dos columnas; en una si no caben
                        8rem para cada una. */}
                    <div
                      className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] items-start gap-x-3 gap-y-2"
                      data-product-supplier-fields
                    >
                      <div className="min-w-0" data-product-supplier-cost={row.supplierId}>
                        <NumberInput
                          aria-label={`Costo REF de ${row.supplierName}`}
                          decimals={2}
                          error={showErrors ? errors?.costs[row.supplierId] : undefined}
                          helperText={
                            wasCostCleared && row.initialCostRef !== undefined
                              ? `Vacío: se conserva ${formatRefUsd(row.initialCostRef)}.`
                              : undefined
                          }
                          label="Costo REF"
                          onChange={(event) =>
                            patchRow(row.supplierId, {
                              costRef: event.target.value,
                            })
                          }
                          placeholder="Opcional"
                          value={row.costRef}
                        />
                      </div>
                      <div className="min-w-0">
                        <Input
                          aria-label={`SKU del proveedor ${row.supplierName}`}
                          label="SKU del proveedor"
                          maxLength={SUPPLIER_SKU_MAX_LENGTH}
                          onChange={(event) =>
                            patchRow(row.supplierId, {
                              supplierSku: event.target.value,
                            })
                          }
                          placeholder="Opcional"
                          value={row.supplierSku}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {state.notice ? (
            <p
              className="rounded-md bg-surface-container-high px-3 py-2 text-sm text-foreground"
              role="status"
            >
              {state.notice}
            </p>
          ) : null}
          {errors?.list ? (
            <p
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              role="alert"
            >
              {errors.list}
            </p>
          ) : null}
          {/* El buscador lista contactos (`GET /api/contacts` exige
              `contacts.view`): quien puede guardar proveedores pero no listar
              contactos (almacén) no lo ve; el resto de la sección sí. */}
          <Can
            fallback={<p className="text-sm text-on-surface-variant">{NO_CONTACTS_ACCESS_HELP}</p>}
            permission={SUPPLIER_SEARCH_PERMISSION}
          >
            <EntityAutocomplete
              entity="contact"
              fetcher={supplierFetcher}
              filters={SUPPLIER_FILTERS}
              getOptionDisabled={(option) =>
                listedIds.includes(option.id)
                  ? ALREADY_LISTED_REASON
                  : !option.isActive && INACTIVE_OPTION_REASON
              }
              helperText="Solo proveedores activos. El primero que añadas queda como habitual."
              label="Añadir proveedor"
              onChange={(option) => {
                if (option) {
                  onChange(addProductSupplier(state, option));
                }
              }}
              // Un reciente guardado puede haberse desactivado: aquí no se ofrecen.
              recentsKey={null}
              value={null}
            />
          </Can>
        </>
      )}
    </div>
  );
}
