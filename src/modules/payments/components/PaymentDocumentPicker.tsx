"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { Input } from "@/shared/components/Input";
import { LoadingState } from "@/shared/components/LoadingState";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import {
  type OpenDocument,
  type OpenDocumentsList,
  type OpenDocumentType,
  useOpenDocuments,
} from "../hooks/useOpenDocuments";

export const PAYMENT_DOCUMENT_PICKER_DEBOUNCE_MS = 300;
export const PAYMENT_DOCUMENT_PICKER_PAGE_SIZE = 20;
/** Tope de `limit` de la API (`MAX_PAGE_LIMIT`): más allá hay que afinar la búsqueda. */
const MAX_VISIBLE_DOCUMENTS = 100;
/** El mismo tope que valida `GET /api/payments/open-documents`. */
const MAX_SEARCH_LENGTH = 120;

const TYPE_TEXTS = {
  purchase: { badge: "Compra", noContact: "Sin proveedor", option: "Compras por pagar" },
  sale: { badge: "Venta", noContact: "Sin cliente", option: "Ventas por cobrar" },
} as const satisfies Record<OpenDocumentType, { badge: string; noContact: string; option: string }>;

/**
 * Buscador de ventas por cobrar y compras por pagar: el paso previo a
 * `RegisterPaymentModal` cuando la pantalla no sabe todavía qué documento se paga.
 * Solo elige; no registra nada.
 *
 * Busca en servidor (`GET /api/payments/open-documents`) por número de documento o
 * por nombre/RIF del contacto, con rango de fechas opcional. Con el foco en el
 * buscador, las flechas recorren los resultados y Enter elige el resaltado.
 * Cada apertura empieza sin filtros.
 *
 * @example
 * const [pickerOpen, setPickerOpen] = useState(false);
 * const [document, setDocument] = useState<OpenDocument | null>(null);
 *
 * <PaymentDocumentPicker
 *   canPayPurchases={can("payments.manage") && canViewPurchasePayments(role)}
 *   onOpenChange={setPickerOpen}
 *   onSelect={(selected) => {
 *     setPickerOpen(false);
 *     setDocument(selected);
 *   }}
 *   open={pickerOpen}
 * />
 * <RegisterPaymentModal
 *   onOpenChange={(open) => {
 *     if (!open) setDocument(null);
 *   }}
 *   open={document !== null}
 *   purchaseId={document?.type === "purchase" ? document.id : undefined}
 *   saleId={document?.type === "sale" ? document.id : undefined}
 * />
 */
export type PaymentDocumentPickerProps = {
  /**
   * `true` si el usuario puede pagar compras (`payments.manage` y un rol que ve pagos
   * de compra, ver `canViewPurchasePayments`). Con `false` solo se listan ventas y no
   * se pinta el selector de tipo; el servidor aplica la misma regla.
   */
  canPayPurchases: boolean;
  /** Se llama con `false` cuando el usuario cierra el buscador (Esc, X, clic fuera, Cancelar). */
  onOpenChange: (open: boolean) => void;
  /**
   * Documento elegido, con su saldo (`pendingVes`, `pendingRef`). El buscador no se
   * cierra solo: quien lo usa decide qué abrir después.
   */
  onSelect: (document: OpenDocument) => void;
  open: boolean;
};

export function PaymentDocumentPicker({
  canPayPurchases,
  onOpenChange,
  onSelect,
  open,
}: PaymentDocumentPickerProps) {
  return (
    <Modal
      contentClassName="sm:max-w-2xl"
      description="Elige la venta o la compra con saldo pendiente."
      footer={({ close }) => (
        <Button onClick={close} type="button" variant="outline">
          Cancelar
        </Button>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Registrar pago"
    >
      {/* El contenido solo existe con el modal abierto: cada apertura estrena estado. */}
      <DocumentSearch canPayPurchases={canPayPurchases} onSelect={onSelect} />
    </Modal>
  );
}

type DocumentSearchProps = Pick<PaymentDocumentPickerProps, "canPayPurchases" | "onSelect">;

function DocumentSearch({ canPayPurchases, onSelect }: DocumentSearchProps) {
  const listId = useId();
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<OpenDocumentType>("sale");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pages, setPages] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeOptionRef = useRef<HTMLLIElement | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), PAYMENT_DOCUMENT_PICKER_DEBOUNCE_MS);
  const type: OpenDocumentType = canPayPurchases ? selectedType : "sale";
  const limit = Math.min(pages * PAYMENT_DOCUMENT_PICKER_PAGE_SIZE, MAX_VISIBLE_DOCUMENTS);
  const filterKey = JSON.stringify([type, debouncedSearch, from, to]);
  const documents = useOpenDocuments({
    from: from || undefined,
    limit,
    search: debouncedSearch || undefined,
    skip: 0,
    to: to || undefined,
    type,
  });
  // "Ver más" pide la misma búsqueda con más filas: mientras llega, se sigue viendo
  // lo ya cargado de ESA búsqueda (nunca resultados de otros filtros).
  const [loaded, setLoaded] = useState<{ filterKey: string; list: OpenDocumentsList }>();

  if (documents.data && (loaded?.list !== documents.data || loaded?.filterKey !== filterKey)) {
    setLoaded({ filterKey, list: documents.data });
  }

  const list = documents.data ?? (loaded?.filterKey === filterKey ? loaded.list : undefined);
  const items = list?.items ?? [];
  const total = list?.total ?? 0;
  const currentIndex = Math.min(activeIndex, items.length - 1);
  const activeOptionId = currentIndex >= 0 ? `${listId}-option-${currentIndex}` : undefined;
  const isLoadingMore = documents.isFetching && list !== undefined && !documents.data;
  const canLoadMore = items.length < total && limit < MAX_VISIBLE_DOCUMENTS;
  const hiddenByLimit = items.length < total && limit >= MAX_VISIBLE_DOCUMENTS;

  useEffect(() => {
    // jsdom no implementa `scrollIntoView`.
    activeOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [currentIndex]);

  function restartList() {
    setPages(1);
    setActiveIndex(0);
  }

  // Un rango invertido no se puede elegir: el otro extremo acompaña al que se mueve.
  function handleFromChange(nextFrom: string) {
    setFrom(nextFrom);

    if (nextFrom && to && nextFrom > to) {
      setTo(nextFrom);
    }

    restartList();
  }

  function handleToChange(nextTo: string) {
    setTo(nextTo);

    if (nextTo && from && nextTo < from) {
      setFrom(nextTo);
    }

    restartList();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (items.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(currentIndex + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(currentIndex - 1, 0));
    } else if (event.key === "Enter" && search.trim() === debouncedSearch) {
      // Con la búsqueda aún sin aplicar, la lista a la vista es de otro texto.
      event.preventDefault();
      onSelect(items[currentIndex]);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={cn(!canPayPurchases && "sm:col-span-2")}>
          <Input
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={items.length > 0}
            autoComplete="off"
            label="Buscar documento"
            maxLength={MAX_SEARCH_LENGTH}
            onChange={(event) => {
              setSearch(event.target.value);
              restartList();
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={
              canPayPurchases ? "Número, cliente o proveedor" : "Número o cliente"
            }
            role="combobox"
            value={search}
          />
        </div>
        {canPayPurchases ? (
          <SelectField
            label="Tipo de documento"
            onChange={(event) => {
              setSelectedType(event.target.value as OpenDocumentType);
              restartList();
            }}
            options={[
              { label: TYPE_TEXTS.sale.option, value: "sale" },
              { label: TYPE_TEXTS.purchase.option, value: "purchase" },
            ]}
            value={selectedType}
          />
        ) : null}
        <Input
          label="Desde"
          max={to || undefined}
          onChange={(event) => handleFromChange(event.target.value)}
          type="date"
          value={from}
        />
        <Input
          label="Hasta"
          min={from || undefined}
          onChange={(event) => handleToChange(event.target.value)}
          type="date"
          value={to}
        />
      </div>

      {documents.error && !list ? (
        <ErrorState
          description={documents.error.message}
          onRetry={() => void documents.refetch()}
          title="No pudimos cargar los documentos"
        />
      ) : !list ? (
        <LoadingState className="min-h-32" title="Buscando documentos..." variant="inline" />
      ) : items.length === 0 ? (
        <EmptyState
          description="Prueba con otro número, otro contacto u otro rango de fechas."
          title="No hay documentos con saldo"
        />
      ) : (
        <div className="grid gap-3">
          <ul
            aria-label={TYPE_TEXTS[type].option}
            className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-container-lowest"
            id={listId}
            role="listbox"
          >
            {items.map((document, index) => {
              const isActive = index === currentIndex;
              const texts = TYPE_TEXTS[document.type];

              return (
                <li
                  aria-selected={isActive}
                  className={cn(
                    "flex cursor-pointer flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm",
                    isActive ? "bg-surface-container" : "hover:bg-surface-container",
                  )}
                  id={`${listId}-option-${index}`}
                  key={`${document.type}-${document.id}`}
                  onClick={() => onSelect(document)}
                  onMouseMove={() => setActiveIndex(index)}
                  ref={isActive ? activeOptionRef : undefined}
                  role="option"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground [overflow-wrap:anywhere]">
                        {document.number}
                      </span>
                      <Badge variant={document.type === "sale" ? "success" : "warning"}>
                        {texts.badge}
                      </Badge>
                    </p>
                    <p className="text-on-surface-variant [overflow-wrap:anywhere]">
                      {document.contact?.name ?? texts.noContact}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(document.createdAt)}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-xs text-muted-foreground">Saldo pendiente</p>
                    {document.pendingRef !== undefined ? (
                      <p className="font-semibold text-foreground">
                        {formatRefUsd(document.pendingRef)}
                      </p>
                    ) : null}
                    <p className="text-on-surface-variant">{formatVesBs(document.pendingVes)}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" role="status">
              {`Mostrando ${items.length} de ${total}`}
              {hiddenByLimit ? ". Afina la búsqueda para ver el resto." : null}
            </p>
            {documents.error ? (
              <p
                className="w-full text-sm text-red-700 [overflow-wrap:anywhere] dark:text-red-300"
                role="alert"
              >
                {documents.error.message}
              </p>
            ) : null}
            {canLoadMore ? (
              <Button
                disabled={isLoadingMore}
                onClick={() => setPages((current) => current + 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                {isLoadingMore ? "Cargando..." : "Ver más"}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
