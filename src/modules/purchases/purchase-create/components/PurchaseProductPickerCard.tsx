"use client";

import { Package, Plus } from "lucide-react";
import {
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { PosCatalogToolbar } from "@/modules/sales/sale-create/components/PosCatalogToolbar";
import { PosScanModal } from "@/modules/sales/sale-create/components/PosScanModal";
import type { ProductFormInitialValues } from "@/modules/products/product-details/components/ProductFormModal";
import { Badge } from "@/shared/components/Badge/Badge";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd } from "@/shared/utils/currency";

import type {
  PurchaseDraftItem,
  PurchaseLineFocusRequest,
  PurchaseLineLockControls,
  PurchaseTaxCatalog,
  PurchaseWebLine,
} from "../types";
import {
  type PurchaseScanJob,
  type PurchaseScanOutcome,
  usePurchaseScanQueue,
} from "../hooks/usePurchaseScanQueue";
import type { PurchaseLineScan } from "../utils/purchaseLineScan";
import { PurchaseLineItemsTable, type PurchaseLineItemMeta } from "./PurchaseLineItemsTable";
import { PurchaseToggleSwitch } from "./PurchaseToggleSwitch";

import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";

/** `preferred` = proveedor habitual del producto; `linked` = vinculado sin ser el habitual. */
export type PurchaseCatalogLink = "linked" | "none" | "preferred";

export type PurchaseCatalogProduct = {
  barcode?: string | null;
  /**
   * Costo por unidad CON IVA del que sale `unitCostRef`: último costo del
   * proveedor si hay vínculo, costo actual del producto si no.
   */
  costWithTaxRef: number;
  currentStock: number;
  defaultPackUnit?: SupplierProductPackUnit;
  /**
   * El buscador aún no sabe el último costo de compra de este producto (su consulta sigue
   * en vuelo o falló): al elegirlo, la línea espera a consultarlo antes de crearse.
   */
  lastCostPending?: boolean;
  /**
   * Costo unitario SIN IVA de la última línea de compra recibida del producto. Cuando
   * existe, `unitCostRef` es este valor y el costo por empaque sale de él.
   */
  lastPurchaseUnitCostRef?: number;
  link: PurchaseCatalogLink;
  name: string;
  packUnits: SupplierProductPackUnit[];
  productId: string;
  sku: string;
  taxRate: number;
  /**
   * Costo sugerido de la línea, por unidad y SIN IVA (la línea suma su alícuota): el de la
   * última compra recibida y, si el producto nunca se compró, `costWithTaxRef` sin el IVA
   * de su categoría.
   */
  unitCostRef: number;
};

export type PurchaseProductPickerHandle = {
  /** Un código leído en un campo numérico: se encola y el foco pasa al buscador. */
  scan: (scan: PurchaseLineScan) => void;
};

type PurchaseProductPickerCardProps = {
  catalog: PurchaseCatalogProduct[];
  /** Falta una alícuota activa del 0 % (o el catálogo aún no cargó): el toggle no se puede usar. */
  exemptDisabled?: boolean;
  /** "Compra exenta": todas las líneas, también las que se agreguen, van a Exento. */
  exemptPurchase: boolean;
  /** Línea que pide el foco en su cantidad (la recién agregada). */
  focusRequest?: PurchaseLineFocusRequest | null;
  getItemMeta: (productId: string) => PurchaseLineItemMeta;
  isSearching?: boolean;
  lines: PurchaseWebLine[];
  lockControls: PurchaseLineLockControls;
  /** Chip «Desarmar al recibir» de una línea (COM-14). */
  onLineDisassembleChange?: (itemId: string, disassemble: boolean) => void;
  /**
   * `scanned`: el producto entró por un escaneo (Enter en el buscador con un código, la
   * cámara o un código detectado en una celda). Su línea no pide el foco: se queda en el
   * buscador para encadenar el siguiente (D36).
   */
  onAddProduct: (product: PurchaseCatalogProduct, options?: { scanned?: boolean }) => void;
  onExemptPurchaseChange: (exempt: boolean) => void;
  onLineTaxChange: (itemId: string, code: string) => void;
  /**
   * "Nuevo producto" (COM-03): abre el alta rápida con esos valores. Sin él (el
   * rol no puede crear productos) no se ofrece. `opener` es a quién devolver el foco
   * si el alta se cierra sin crear: el botón fijo, o el buscador cuando se abrió desde
   * la lista sin resultados (ese botón desaparece con ella).
   */
  onNewProduct?: (initialValues: ProductFormInitialValues, opener: HTMLElement | null) => void;
  onRemoveItem: (itemId: string) => void;
  /**
   * Un escaneo no agregó nada y detrás hay más en la cola: su aviso junto al buscador
   * dura un instante, así que la página lo muestra aparte con el código que no entró
   * (o el nombre, si era un producto elegido en la lista cuyo último costo no se pudo leer).
   */
  onScanMissed?: (notice: { code: string; message: string } | { message: string; productName: string }) => void;
  onSearchChange: (value: string) => void;
  onSettleItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, input: Partial<PurchaseDraftItem>) => void;
  rateVes: number;
  /** Para lo que escanea fuera de la tarjeta (el Descuento del resumen): misma cola y mismo foco. */
  ref?: Ref<PurchaseProductPickerHandle>;
  search: string;
  /** Error de la búsqueda en servidor (`error.message` tal cual). */
  searchError?: string | null;
  supplierId: string;
  taxCatalog: PurchaseTaxCatalog;
};

type PurchaseExemptToggleProps = {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * Interruptor "Compra exenta" de la cabecera: un clic pasa toda la compra a
 * Exento. Cada línea sigue pudiendo cambiar su alícuota con sus chips, y eso no
 * apaga el interruptor.
 */
export function PurchaseExemptToggle({
  checked,
  disabled = false,
  onChange,
}: PurchaseExemptToggleProps) {
  return (
    <PurchaseToggleSwitch
      checked={checked}
      disabled={disabled}
      label="Compra exenta"
      onChange={onChange}
    />
  );
}

const SCAN_NO_SUPPLIER_MESSAGE = "Selecciona un proveedor antes de buscar productos.";
const SCAN_MISS_MESSAGES = {
  ambiguous: "Hay más de un producto activo con ese código.",
  failed: "No se pudo buscar el producto.",
  not_found: "No hay un producto activo con ese código de barras o SKU.",
};
const PICK_FAILED_MESSAGE = "No se pudo consultar el último costo del producto. Vuelve a elegirlo.";
const popupSurfaceClassName =
  "z-20 mt-1 rounded-lg border border-border bg-surface-container-lowest shadow-lg";
/** Lista de resultados: flota bajo el campo, sin empujar la tabla mientras se escribe. */
const popupClassName = `absolute left-0 right-0 top-full ${popupSurfaceClassName}`;
/**
 * Avisos del buscador (buscando, error, sin resultados): en móvil «Nuevo producto» queda
 * justo bajo el campo y un aviso flotante lo taparía, así que ocupan su sitio y lo
 * desplazan; desde `sm` el botón va al lado y flotan como la lista.
 */
const popupNoticeClassName = `sm:absolute sm:left-0 sm:right-0 sm:top-full ${popupSurfaceClassName}`;
const popupMessageClassName = "px-4 py-2.5 text-sm";

/**
 * Lo buscado sin resultado, como punto de partida del producto nuevo: solo
 * dígitos es un código de barras; cualquier otra cosa, el nombre.
 */
export function buildNewProductPrefill(search: string): ProductFormInitialValues {
  const text = search.trim();

  if (!text) {
    return {};
  }

  return /^\d+$/.test(text) ? { barcode: text } : { name: text };
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** Primer elemento al que Tab puede llegar después de `container`, sin contar lo que hay dentro. */
function findFirstFocusableAfter(container: Element) {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(
    (element) =>
      Boolean(container.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      !container.contains(element) &&
      element.tabIndex >= 0 &&
      !element.closest("[hidden], [inert]") &&
      // jsdom no la implementa: allí todo cuenta como visible.
      (typeof element.checkVisibility !== "function" || element.checkVisibility()),
  );
}

function getLinkChipLabel(product: PurchaseCatalogProduct) {
  const prefix = product.link === "preferred" ? "Habitual" : "Vinculado";

  return product.costWithTaxRef > 0
    ? `${prefix} · último costo ${formatRefUsd(product.costWithTaxRef)}`
    : `${prefix} · sin costo registrado`;
}

export function PurchaseProductPickerCard({
  catalog,
  exemptDisabled = false,
  exemptPurchase,
  focusRequest = null,
  getItemMeta,
  isSearching = false,
  lines,
  lockControls,
  onLineDisassembleChange,
  onAddProduct,
  onExemptPurchaseChange,
  onLineTaxChange,
  onNewProduct,
  onRemoveItem,
  onScanMissed,
  onSearchChange,
  onSettleItem,
  onUpdateItem,
  rateVes,
  ref,
  search,
  searchError = null,
  supplierId,
  taxCatalog,
}: PurchaseProductPickerCardProps) {
  const [scanOpen, setScanOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanQueue = usePurchaseScanQueue(supplierId, handleScanSettled);
  const isLookingUp = scanQueue.pending > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  // El foco llegó al buscador por el salto desde el último candado y aún no se tecleó nada.
  const cameFromLastLock = useRef(false);
  const hasSupplier = Boolean(supplierId);
  const trimmedSearch = search.trim();
  const showResults = pickerOpen && hasSupplier && trimmedSearch.length > 0;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function handleTabPastLastLock() {
    searchInputRef.current?.focus();
    cameFromLastLock.current = true;
  }

  // El salto desde el último candado deja el foco en el buscador para seguir escaneando.
  // Otro Tab sin haber escrito sale de la tarjeta: seguir el orden natural volvería a los
  // candados y nunca se llegaría con Tab al resto del formulario.
  function handleSearchKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "Tab" ||
      event.shiftKey ||
      !cameFromLastLock.current ||
      event.target !== searchInputRef.current ||
      !cardRef.current
    ) {
      return;
    }

    const next = findFirstFocusableAfter(cardRef.current);

    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  function handleSearchChange(value: string) {
    cameFromLastLock.current = false;
    setScanError(null);
    onSearchChange(value);
    setPickerOpen(true);
  }

  // Sin su último costo todavía, la línea no nace con uno provisional: espera en la cola
  // (en orden con los escaneos) a consultarlo. La lista ya se cerró: no se retrasa.
  function handleAdd(product: PurchaseCatalogProduct) {
    if (product.lastCostPending) {
      setScanError(null);
      scanQueue.enqueue({ codes: [], picked: product });
    } else {
      onAddProduct(product);
    }

    onSearchChange("");
    setPickerOpen(false);
  }

  function handleNewProduct(initialValues: ProductFormInitialValues, opener: HTMLElement | null) {
    setPickerOpen(false);
    onNewProduct?.(initialValues, opener);
  }

  function enqueueScan(job: PurchaseScanJob) {
    if (!hasSupplier) {
      job.onResolved?.(null);
      setScanError(SCAN_NO_SUPPLIER_MESSAGE);
      return false;
    }

    scanQueue.enqueue(job);
    return true;
  }

  // Lector o Enter: el código exacto se resuelve en servidor, sin esperar al debounce de la
  // lista. Se encola y el buscador queda vacío en el mismo Enter: el lector puede teclear el
  // siguiente código sin esperar la respuesta de este.
  function handleCodeSubmit(code: string, options?: { closeScanOnSuccess?: boolean }) {
    const queued = enqueueScan({
      closeScanOnSuccess: options?.closeScanOnSuccess,
      codes: [code],
      searchText: code,
    });

    if (queued) {
      onSearchChange("");
      setPickerOpen(false);
    }
  }

  // Lector sobre una celda de línea: el código es uno de los sufijos de lo tecleado. La
  // celda fija su valor al saber cuál, antes de que agregar el producto la bloquee.
  // El foco pasa ya al buscador: el siguiente escaneo no debe caer en la celda (D36).
  function handleLineScan(scan: PurchaseLineScan) {
    searchInputRef.current?.focus();
    enqueueScan({ codes: scan.candidates, onResolved: scan.onResolved });
  }

  useImperativeHandle(ref, () => ({ scan: handleLineScan }));

  // Resultado de un escaneo de la cola. Agregue o no, el foco es del buscador: para
  // reintentar o para el siguiente escaneo (D36).
  function handleScanSettled({ hasMore, job, resolution }: PurchaseScanOutcome) {
    if (resolution.status === "found") {
      setScanError(null);
      // Elegido en la lista: su línea sí pide el foco en Cantidad, como al elegirlo sin espera.
      onAddProduct(resolution.product, job.picked ? undefined : { scanned: true });

      if (job.closeScanOnSuccess) {
        setScanOpen(false);
      }
    } else {
      const message = job.picked ? PICK_FAILED_MESSAGE : SCAN_MISS_MESSAGES[resolution.status];

      setScanError(message);

      if (hasMore) {
        // El aviso junto al buscador lo pisará el siguiente escaneo: este queda aparte.
        onScanMissed?.(
          job.picked
            ? { message, productName: job.picked.name }
            : { code: job.codes[0], message },
        );
      } else if (job.searchText && searchInputRef.current?.value === "") {
        // Nada detrás y el buscador sigue vacío: vuelve lo buscado, para corregirlo o crear
        // el producto. Queda seleccionado: el siguiente escaneo lo sustituye, no se le pega.
        const text = job.searchText;

        // Pintado ya: si se seleccionara un instante después, el lector podría adelantarse.
        flushSync(() => {
          onSearchChange(text);
          setPickerOpen(true);
        });

        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.select();
        }
      }
    }

    // Bloquear al agregar puede dejar sin foco a quien lo tenía (su fila ya no tiene campos).
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        searchInputRef.current?.focus();
      }
    });
  }

  return (
    <section
      className="flex min-h-[31.25rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800"
      ref={cardRef}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-3 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Package aria-hidden className="size-[1.125rem] text-primary" />
          Productos de la compra
        </h3>
        <PurchaseExemptToggle
          checked={exemptPurchase}
          disabled={exemptDisabled}
          onChange={onExemptPurchaseChange}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-start dark:border-slate-800">
        <div
          className="relative min-w-0 flex-1"
          onBlur={(event) => {
            if (event.target === searchInputRef.current) {
              cameFromLastLock.current = false;
            }
          }}
          onKeyDown={handleSearchKeyDown}
          ref={containerRef}
          role="presentation"
        >
          <PosCatalogToolbar
            autoFocus={false}
            embedded
            // Nunca «buscando»: ese estado deja el campo de solo lectura y, con la cola, el
            // lector debe poder teclear el siguiente código mientras se resuelve el anterior.
            isLookingUp={false}
            onOpenScan={() => setScanOpen(true)}
            onScanSubmit={handleCodeSubmit}
            onSearchChange={handleSearchChange}
            placeholder="Buscar por nombre, SKU o código de barras..."
            ref={searchInputRef}
            scanError={scanError}
            search={search}
          />
          {isLookingUp ? (
            <p className="sr-only" role="status">
              {scanQueue.pending === 1
                ? "Buscando 1 código escaneado..."
                : `Buscando ${scanQueue.pending} códigos escaneados...`}
            </p>
          ) : null}
          {showResults && isSearching ? (
            <p
              className={cn(popupNoticeClassName, popupMessageClassName, "text-muted-foreground")}
              role="status"
            >
              Buscando...
            </p>
          ) : null}
          {showResults && !isSearching && searchError ? (
            <p
              className={cn(popupNoticeClassName, popupMessageClassName, "text-destructive")}
              role="alert"
            >
              {searchError}
            </p>
          ) : null}
          {showResults && !isSearching && !searchError && catalog.length > 0 ? (
            <ul
              aria-label="Productos encontrados"
              className={cn(popupClassName, "max-h-72 overflow-y-auto py-1")}
            >
              {catalog.map((product) => (
                <li key={product.productId}>
                  <button
                    className="flex w-full cursor-pointer flex-col gap-1 px-4 py-2.5 text-left transition-colors hover:bg-surface-container-low"
                    onClick={() => handleAdd(product)}
                    type="button"
                  >
                    <span className="text-sm font-medium text-foreground">{product.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-on-surface-variant">
                      {product.link === "none" ? null : (
                        <Badge variant={product.link === "preferred" ? "info" : "default"}>
                          {getLinkChipLabel(product)}
                        </Badge>
                      )}
                      <span>
                        {product.sku} · Stock {product.currentStock}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {showResults && !isSearching && !searchError && catalog.length === 0 ? (
            <div
              className={cn(
                popupNoticeClassName,
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5",
              )}
            >
              <p className="text-sm text-muted-foreground" role="status">
                No hay productos activos que coincidan
              </p>
              {onNewProduct ? (
                <Button
                  className="gap-1"
                  onClick={() =>
                    handleNewProduct(buildNewProductPrefill(search), searchInputRef.current)
                  }
                  size="sm"
                >
                  <Plus aria-hidden className="size-4" />
                  Crear producto nuevo
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {hasSupplier && onNewProduct ? (
          <Button
            className="h-12 shrink-0 gap-1"
            onClick={(event) => handleNewProduct({}, event.currentTarget)}
            variant="outline"
          >
            <Plus aria-hidden className="size-5" />
            Nuevo producto
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <PurchaseLineItemsTable
          focusRequest={focusRequest}
          getItemMeta={getItemMeta}
          lines={lines}
          lockControls={lockControls}
          onLineDisassembleChange={onLineDisassembleChange}
          onLineTaxChange={onLineTaxChange}
          onRemoveItem={onRemoveItem}
          onScanCode={handleLineScan}
          onSettleItem={onSettleItem}
          onTabPastLastLock={handleTabPastLastLock}
          onUpdateItem={onUpdateItem}
          rateVes={rateVes}
          taxCatalog={taxCatalog}
        />
      </div>

      <PosScanModal
        isLookingUp={isLookingUp}
        onDetected={(code) => {
          handleCodeSubmit(code, { closeScanOnSuccess: true });
        }}
        onFocusSearch={() => {
          setScanOpen(false);
          searchInputRef.current?.focus();
        }}
        onOpenChange={(nextOpen) => {
          setScanOpen(nextOpen);
          if (!nextOpen) {
            setScanError(null);
          }
        }}
        open={scanOpen}
        scanError={scanError}
      />
    </section>
  );
}
