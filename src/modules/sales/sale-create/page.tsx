"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { useMyCashSession } from "@/modules/cash/hooks/useCash";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useProductBarcodeScan } from "@/modules/products/hooks/useProductBarcodeScan";
import { useAllProducts, useCategories } from "@/modules/products/hooks/useProducts";
import { matchesProductSearch } from "@/modules/products/services/productSearch";
import { sortPosCatalogProducts } from "@/modules/sales/sale-create/utils/sortPosCatalogProducts";
import { getSaleByClientRequestId } from "@/modules/sales/services/sales.client";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import { ClientApiError } from "@/shared/api/apiFetch";
import { ErrorState } from "@/shared/components/ErrorState";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { ProcessGuardModal, useProcessGuard } from "@/shared/components/ProcessGuard";
import type { PaymentMethod, SaleMock } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  isPaymentMethodEnabled,
} from "@/shared/payments/paymentMethods";
import { refToVes, roundMoney } from "@/shared/utils/currency";

import {
  invalidateAfterSaleRegistered,
  type SaleCreateInput,
  type SaleDetail,
  useCreateSale,
} from "../hooks/useSales";
import { PosCartPanel } from "./components/PosCartPanel";
import { PosCashSessionGate } from "./components/PosCashSessionGate";
import { PosCatalogToolbar } from "./components/PosCatalogToolbar";
import { PosCategorySlider } from "./components/PosCategorySlider";
import { PosProductGrid } from "./components/PosProductGrid";
import { PosSaleSuccessOverlay } from "./components/PosSaleSuccessOverlay";
import { PosScanModal } from "./components/PosScanModal";
import { PosSingleMethodDetailsModal } from "./components/PosSingleMethodDetailsModal";
import { PosWorkspace } from "./components/PosWorkspace";
import { posCatalogQueryOptions } from "./constants/posCatalogCache";
import { usePosCart } from "./hooks/usePosCart";
import { usePosCartDraft } from "./hooks/usePosCartDraft";
import { toDenominationsPayload } from "./utils/denominations";
import {
  getPaymentCurrency,
  methodRequiresPaymentDetails,
  validateCheckout,
  validateSinglePaymentDetails,
  type PosCheckout,
  type PosSinglePaymentDetails,
} from "./utils/mixedPayments";
import { describeSaleInProgress } from "./utils/posCartDraft";
import {
  clearSaleAttempt,
  isDefinitiveRejection,
  readSaleAttempt,
  type SaleAttempt,
  saleAttemptStorageKey,
  saleFingerprint,
  writeSaleAttempt,
} from "./utils/saleAttempt";

const UNRESOLVED_SALE_MESSAGE =
  "La venta pudo haberse registrado; verifica antes de volver a cobrar.";
const SALE_NOT_REGISTERED_MESSAGE =
  "El servidor confirmo que ese cobro no quedo guardado. Puedes volver a pulsar «Procesar venta».";
const CART_CHARGED_ELSEWHERE_MESSAGE =
  "Este carrito ya se cobró en otra pestaña y no se puede cobrar otra vez. Vacíalo si es la misma venta; si es otra venta con los mismos productos, pulsa «Es una venta nueva».";
const CART_CHARGING_ELSEWHERE_MESSAGE =
  "Este carrito se está cobrando en otra pestaña. Espera a que termine: si allí queda cobrado, aquí no hay que cobrarlo otra vez.";

type AttemptLookup =
  | { kind: "absent" }
  | { kind: "registered"; sale: SaleDetail }
  | { kind: "unknown" }
  | { kind: "voided"; sale: SaleDetail };

/** Que sabe el servidor de un intento de cobro, consultando por su clave. */
async function lookupSaleAttempt(clientRequestId: string): Promise<AttemptLookup> {
  let sale: SaleDetail | null;

  try {
    sale = await getSaleByClientRequestId(clientRequestId);
  } catch {
    // La consulta tampoco respondio: la venta puede existir o no.
    return { kind: "unknown" };
  }

  if (!sale) {
    return { kind: "absent" };
  }

  // Una venta anulada no es una venta registrada, y su clave ya no sirve.
  return sale.status === "cancelada" || sale.status === "devuelta"
    ? { kind: "voided", sale }
    : { kind: "registered", sale };
}

type PaymentSelectionSnapshot = {
  details: PosSinglePaymentDetails | null;
  method: PaymentMethod | null;
};

type CompletedSaleSummary = {
  id: string;
  invoiceNumber: string;
  /** Se enviaron cobros pero el servidor dejo la venta en `pendiente_pago`. */
  pendingPayment: boolean;
};

export function SaleCreatePage() {
  return (
    <PosCashSessionGate>
      <SaleCreatePosWorkspace />
    </PosCashSessionGate>
  );
}

function SaleCreatePosWorkspace() {
  const contacts = useContacts({ limit: 100 }, posCatalogQueryOptions);
  const categories = useCategories({}, posCatalogQueryOptions);
  // Catálogo completo: con `limit: 100` el POS dejaba fuera todo producto que
  // cayera pasado el corte alfabético, y la búsqueda filtra en cliente.
  const products = useAllProducts({ isActive: true }, posCatalogQueryOptions);
  const currentRate = useCurrentExchangeRate();
  const cashSession = useMyCashSession();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const createSale = useCreateSale();
  const cart = usePosCart();
  // Candado sincrono contra el doble envio: `isPending` tarda un render en
  // reflejarse y en ese hueco un segundo clic ya habia disparado otra venta.
  const submitLockRef = useRef(false);
  // La clave de idempotencia vive en sessionStorage y, sin confirmar, tambien en
  // localStorage (ver utils/saleAttempt.ts): asi recargar, salir y volver, remontar
  // o abrir otra pestaña no estrenan clave para un cobro pendiente.
  const attemptStorageKey = saleAttemptStorageKey({
    registerId: cashSession.data?.registerId,
    storeId: currentUser.data?.storeId,
    userId: currentUser.data?.user.id,
  });
  // Ultimo cobro enviado desde ESTE carrito. Tras recargar o vaciar el carrito ya
  // no se puede afirmar que lo que hay en pantalla sea aquella venta.
  const lastAttemptRef = useRef<{ clientRequestId: string; fingerprint: string } | null>(null);
  // Generacion del carrito: cambia al cerrar la venta o limpiar la orden. Una respuesta
  // de escaneo que vuelve con otra generacion pertenece a un carrito que ya no existe.
  const cartGenerationRef = useRef(0);
  // Busquedas por codigo en vuelo. Es un ref (y no solo `isLookingUp`) porque el
  // estado tarda un render y en ese hueco «Cobrar» salia sin la linea escaneada.
  const scanInFlightRef = useRef(0);
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const enabledPaymentMethods =
    enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const barcodeScan = useProductBarcodeScan({ isActive: true });
  const paymentSelectionSnapshotRef = useRef<PaymentSelectionSnapshot>({
    details: null,
    method: null,
  });

  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [paymentDetails, setPaymentDetails] = useState<PosSinglePaymentDetails | null>(null);
  const [paymentDetailsModalOpen, setPaymentDetailsModalOpen] = useState(false);
  const [checkout, setCheckout] = useState<PosCheckout | null>(null);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  // Recarga o salir y volver con un cobro sin confirmar: se avisa nada mas entrar
  // (la caja y el usuario ya estan cargados: PosCashSessionGate espera por ambos).
  const [formError, setFormError] = useState<string | undefined>(() =>
    readSaleAttempt(attemptStorageKey)?.unresolved ? UNRESOLVED_SALE_MESSAGE : undefined,
  );
  // Hay un cobro de resultado desconocido: se ofrece «Verificar» junto al aviso.
  const [needsVerification, setNeedsVerification] = useState(
    () => readSaleAttempt(attemptStorageKey)?.unresolved ?? false,
  );
  // Consulta por clave en curso (antes o despues del POST): tambien bloquea «Cobrar».
  const [isResolvingAttempt, setIsResolvingAttempt] = useState(false);
  const [completedSale, setCompletedSale] = useState<CompletedSaleSummary | null>(null);

  useEffect(() => {
    // Recover interaction if a previous modal guard left the page blocked.
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  }, []);

  useEffect(() => {
    if (
      paymentMethod &&
      !isPaymentMethodEnabled(paymentMethod, enabledPaymentMethods)
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- si la tienda deshabilita el metodo elegido se descarta el pago en curso al llegar la configuracion; cobro del POS, no se reordena
      setPaymentMethod(null);
      setPaymentDetails(null);
      setPaymentDetailsModalOpen(false);
    }
  }, [enabledPaymentMethods, paymentMethod]);

  useEffect(() => {
    const hasDisabledMethod =
      checkout?.lines.some(
        (line) => !isPaymentMethodEnabled(line.method, enabledPaymentMethods),
      ) ||
      (checkout?.change != null &&
        !isPaymentMethodEnabled(checkout.change.method, enabledPaymentMethods));

    if (hasDisabledMethod) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- un cobro mixto con un metodo ya deshabilitado se descarta al llegar la configuracion; cobro del POS, no se reordena
      setCheckout(null);
    }
  }, [checkout, enabledPaymentMethods]);

  const customers = useMemo(() => {
    return getPaginatedItems(contacts.data)
      .filter((contact) => contact.type === "cliente" || contact.type === "ambos")
      .slice()
      .sort((left, right) => {
        const leftDefault = left.isPosDefault ? 1 : 0;
        const rightDefault = right.isPosDefault ? 1 : 0;
        if (leftDefault !== rightDefault) {
          return rightDefault - leftDefault;
        }
        return left.name.localeCompare(right.name, "es");
      });
  }, [contacts.data]);
  const defaultCustomerId = useMemo(
    () => customers.find((customer) => customer.isPosDefault)?.id ?? "",
    [customers],
  );
  const categoryOptions = getPaginatedItems(categories.data);
  const activeProducts = getPaginatedItems(products.data);
  const dependencyError = contacts.error ?? products.error ?? currentRate.error;
  const rateVes = currentRate.data?.rateVes ?? 0;
  const drawerVes = cashSession.data?.liveTotals?.cashVes ?? 0;
  const drawerRef = cashSession.data?.liveTotals?.cashRef ?? 0;
  const totalRef = cart.subtotalRef;
  const totalVes = rateVes ? roundMoney(refToVes(totalRef, rateVes)) : 0;
  const isSubmitting = createSale.isPending || isResolvingAttempt;

  useEffect(() => {
    if (!customerId && defaultCustomerId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- el cliente por defecto se asigna cuando carga la lista de contactos y cada vez que la venta queda sin cliente; depende de datos asincronos del POS
      setCustomerId(defaultCustomerId);
    }
  }, [customerId, defaultCustomerId]);

  // Carrito recuperable (CNF-16): se guarda solo, fuera del camino de escaneo y cobro, y
  // vuelve revalidado contra el catalogo al reentrar con la misma caja abierta.
  const draftCatalog = useMemo(
    () =>
      products.data && contacts.data
        ? { customers, products: getPaginatedItems(products.data) }
        : null,
    [contacts.data, customers, products.data],
  );
  const cartDraft = usePosCartDraft({
    cashSessionId: cashSession.data?.id,
    catalog: draftCatalog,
    customerId,
    items: cart.items,
    onDiscard: () => void handleClearOrder(),
    onRestore: (restoration) => {
      cart.restoreItems(restoration.items);
      if (restoration.customerId) {
        setCustomerId(restoration.customerId);
      }
    },
    registerId: cashSession.data?.registerId,
    storeId: currentUser.data?.storeId,
    userId: currentUser.data?.user.id,
  });
  // Guardia de salida (CNF-15): solo pregunta al SALIR del POS con lineas en el carrito.
  // Abrir el cobro, el cliente o el escaner no navega, y al cobrar el carrito queda vacio.
  const guard = useProcessGuard({
    active: cart.items.length > 0,
    description: cartDraft.saveFailed
      ? "Este navegador no dejó guardar el carrito (almacenamiento lleno o bloqueado): si sales, esta venta se pierde."
      : cartDraft.settledElsewhere
        ? "Este carrito es copia de uno que ya se cobró o se vació en otra pestaña: no se guarda y, si sales, se pierde."
        : undefined,
    label: describeSaleInProgress({
      customerName: customers.find((customer) => customer.id === customerId)?.name,
      lineCount: cart.items.length,
      totalRef,
    }),
    onLeave: cartDraft.saveFailed || cartDraft.settledElsewhere ? "discard" : "draft",
    onSaveDraft: cartDraft.saveNow,
  });

  const cartQuantitiesByProductId = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of cart.items) {
      quantities.set(item.productId, item.quantity);
    }
    return quantities;
  }, [cart.items]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = activeProducts.filter((product) => {
      const matchesCategory = !categoryId || product.categoryId === categoryId;
      const matchesSearch = !query || matchesProductSearch(product, query);

      return matchesCategory && matchesSearch;
    });

    return sortPosCatalogProducts(filtered);
  }, [activeProducts, categoryId, search]);

  function focusSearchInput() {
    // Defer until after React re-enables the input / clears the value.
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }

  function handleSearchChange(value: string) {
    barcodeScan.clearScanError();
    setSearch(value);
  }

  /**
   * Busca el codigo y agrega la linea SOLO si el carrito sigue siendo el mismo.
   * Con un cobro viajando no se escanea: la linea llegaria a una venta ya enviada.
   */
  async function scanIntoCart(code: string, onAdded?: () => void) {
    if (submitLockRef.current) {
      barcodeScan.setScanError("Espera a que termine el cobro antes de escanear.");
      return;
    }

    const generation = cartGenerationRef.current;
    scanInFlightRef.current += 1;

    try {
      await barcodeScan.handleScanSubmit(code, {
        onResolved: (product) => {
          if (generation !== cartGenerationRef.current) {
            // La venta se cerro (o la orden se limpio) mientras se buscaba: se descarta.
            return;
          }

          cart.addProduct(product);
          setSearch("");
          barcodeScan.clearScanError();
          onAdded?.();
        },
      });
    } finally {
      scanInFlightRef.current -= 1;
    }
  }

  function handleBarcodeScanSubmit(code: string) {
    void scanIntoCart(code).finally(() => {
      focusSearchInput();
    });
  }

  function resetPaymentSelection() {
    setPaymentMethod(null);
    setPaymentDetails(null);
    setPaymentDetailsModalOpen(false);
    paymentSelectionSnapshotRef.current = {
      details: null,
      method: null,
    };
  }

  function resetAfterSuccessfulSale() {
    cart.clearCart();
    setCustomerId(defaultCustomerId);
    setCheckout(null);
    resetPaymentSelection();
    lastAttemptRef.current = null;
    cartGenerationRef.current += 1;
  }

  useEffect(() => {
    // Un carrito vaciado ya no es el del ultimo cobro enviado. La clave guardada
    // NO se toca aqui: solo la renueva una respuesta del servidor.
    if (cart.items.length === 0) {
      lastAttemptRef.current = null;
    }
  }, [cart.items.length]);

  function buildPayments(): NonNullable<SaleCreateInput["payments"]> {
    // Venta y cobro viajan juntos: `create_sale_with_payments` los registra en
    // una sola transaccion, asi que si un cobro falla no queda venta ni descuento
    // de stock que anular. Antes eran dos peticiones y el hueco entre ambas
    // dejaba ventas huerfanas en `pendiente_pago` que el cajero volvia a crear.
    if (checkout) {
      return checkout.lines.map((line) => {
        // El vuelto viaja en la linea que genero el excedente: es la fila
        // `payments` que lleva las columnas `change_*`.
        const carriesChange =
          checkout.change != null && checkout.changeCarrierLineId === line.id;
        const changeMethod = checkout.change?.method;

        return {
          amount: line.amount,
          bankName: line.bankName?.trim() || undefined,
          change:
            carriesChange && checkout.change
              ? {
                  amount: checkout.change.amount,
                  method: checkout.change.method,
                }
              : undefined,
          changeDenominations:
            carriesChange && changeMethod
              ? toDenominationsPayload(
                  getPaymentCurrency(changeMethod),
                  checkout.change?.denominations,
                )
              : undefined,
          currency: getPaymentCurrency(line.method),
          method: line.method,
          phone: line.phone?.trim() || undefined,
          receivedDenominations: toDenominationsPayload(
            getPaymentCurrency(line.method),
            line.denominations,
          ),
          referenceCode: line.referenceCode?.trim() || undefined,
        };
      });
    }

    if (
      paymentMethod &&
      ((paymentMethod === "efectivo_usd" && totalRef > 0) ||
        (paymentMethod !== "efectivo_usd" && totalVes > 0))
    ) {
      return [
        {
          amount: paymentMethod === "efectivo_usd" ? totalRef : totalVes,
          bankName: paymentDetails?.bankName.trim() || undefined,
          currency: paymentMethod === "efectivo_usd" ? "USD" : "VES",
          method: paymentMethod,
          phone: paymentDetails?.phone.trim() || undefined,
          referenceCode: paymentDetails?.referenceCode.trim() || undefined,
        },
      ];
    }

    return [];
  }

  function buildSaleContent() {
    return {
      customerId,
      items: cart.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
      payments: buildPayments(),
    };
  }

  /** Cierra la venta con los datos que devolvio el SERVIDOR (respuesta o consulta por clave). */
  function completeSale(
    sale: Pick<SaleMock, "id" | "invoiceNumber" | "status">,
    paymentsSent: boolean,
  ) {
    clearSaleAttempt(attemptStorageKey);
    // Solo anota (sin leer ni escribir) que este carrito se vendió, para sus copias en otras pestañas.
    cartDraft.markCharged();
    resetAfterSuccessfulSale();
    setFormError(undefined);
    setNeedsVerification(false);
    setCompletedSale({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      // Un fallback sin cobro atomico puede devolver la venta sin pagar: no es "cobrada".
      pendingPayment: paymentsSent && sale.status === "pendiente_pago",
    });
    createSale.reset();
  }

  function showUnresolvedAttempt() {
    setFormError(UNRESOLVED_SALE_MESSAGE);
    setNeedsVerification(true);
  }

  /** El servidor confirmo que la clave tiene venta: decide si es la de este carrito. */
  function settleRegisteredAttempt(sale: SaleDetail, attempt: SaleAttempt) {
    const content = buildSaleContent();
    const fingerprint = saleFingerprint(content);
    const last = lastAttemptRef.current;
    const isThisCart =
      content.items.length > 0 &&
      last?.clientRequestId === attempt.clientRequestId &&
      last.fingerprint === fingerprint &&
      attempt.sent.every((sentFingerprint) => sentFingerprint === fingerprint);

    // La respuesta perdida no paso por `onSuccess` de la mutacion.
    invalidateAfterSaleRegistered(queryClient);

    if (isThisCart) {
      completeSale(sale, content.payments.length > 0);
      return;
    }

    // Tras recargar, o con el carrito cambiado, no se puede afirmar que lo que hay
    // en pantalla sea esa venta: se informa y la clave (ya usada) se suelta.
    clearSaleAttempt(attemptStorageKey);
    setNeedsVerification(false);
    setFormError(
      `El cobro anterior si quedo registrado como venta ${sale.invoiceNumber}${
        sale.status === "pendiente_pago" ? " (pendiente de pago)" : ""
      }. Si este carrito es esa misma venta, limpia la orden: no la cobres otra vez.`,
    );
  }

  /**
   * Resuelve un cobro de resultado desconocido consultando por su clave.
   * "stop": no se puede seguir (sigue sin saberse, o la venta ya existe).
   * "continue": el servidor confirmo que no hay venta viva con esa clave.
   */
  async function resolveUnresolvedAttempt(attempt: SaleAttempt): Promise<"continue" | "stop"> {
    const outcome = await lookupSaleAttempt(attempt.clientRequestId);

    switch (outcome.kind) {
      case "unknown":
        showUnresolvedAttempt();
        return "stop";
      case "registered":
        settleRegisteredAttempt(outcome.sale, attempt);
        return "stop";
      case "voided":
        clearSaleAttempt(attemptStorageKey);
        cartDraft.endCharge();
        setNeedsVerification(false);
        return "continue";
      case "absent":
        // Se conserva la clave: si aquel envio llegara tarde, el servidor la reconoce.
        writeSaleAttempt(attemptStorageKey, { ...attempt, unresolved: false });
        cartDraft.endCharge();
        setNeedsVerification(false);
        return "continue";
    }
  }

  async function handleVerifyAttempt() {
    if (submitLockRef.current) {
      return;
    }

    const attempt = readSaleAttempt(attemptStorageKey);
    if (!attempt?.unresolved) {
      setNeedsVerification(false);
      setFormError(undefined);
      return;
    }

    submitLockRef.current = true;
    setIsResolvingAttempt(true);
    try {
      if ((await resolveUnresolvedAttempt(attempt)) === "continue") {
        setFormError(SALE_NOT_REGISTERED_MESSAGE);
      }
    } finally {
      submitLockRef.current = false;
      setIsResolvingAttempt(false);
    }
  }

  async function handleClearOrder() {
    if (submitLockRef.current) {
      return;
    }

    // Limpiar con un cobro de resultado desconocido lo daria por no hecho: antes
    // se pregunta al servidor, y si no responde se avisa y no se limpia.
    const attempt = readSaleAttempt(attemptStorageKey);
    if (attempt?.unresolved) {
      submitLockRef.current = true;
      setIsResolvingAttempt(true);
      try {
        if ((await resolveUnresolvedAttempt(attempt)) === "stop") {
          return;
        }
        setFormError(undefined);
      } finally {
        submitLockRef.current = false;
        setIsResolvingAttempt(false);
      }
    }

    cart.clearCart();
    setCheckout(null);
    resetPaymentSelection();
    cartGenerationRef.current += 1;
  }

  function handleStartNewSale() {
    setCompletedSale(null);
    createSale.reset();
    focusSearchInput();
  }

  function handlePaymentMethodChange(nextMethod: PaymentMethod) {
    if (!isPaymentMethodEnabled(nextMethod, enabledPaymentMethods)) {
      return;
    }

    setCheckout(null);

    if (methodRequiresPaymentDetails(nextMethod)) {
      paymentSelectionSnapshotRef.current = {
        details: paymentDetails,
        method: paymentMethod,
      };

      if (nextMethod !== paymentMethod) {
        setPaymentDetails(null);
      }

      setPaymentMethod(nextMethod);
      setPaymentDetailsModalOpen(true);
      return;
    }

    setPaymentMethod(nextMethod);
    setPaymentDetails(null);
    setPaymentDetailsModalOpen(false);
  }

  function handlePaymentDetailsConfirm(details: PosSinglePaymentDetails) {
    setPaymentDetails(details);
  }

  function handlePaymentDetailsCancel() {
    const applied =
      paymentMethod != null &&
      validateSinglePaymentDetails(paymentMethod, paymentDetails).isValid;
    if (applied) {
      return;
    }

    const snapshot = paymentSelectionSnapshotRef.current;
    setPaymentMethod(snapshot.method);
    setPaymentDetails(snapshot.details);
  }

  function handleOpenPaymentDetailsModal() {
    if (!methodRequiresPaymentDetails(paymentMethod)) {
      return;
    }

    paymentSelectionSnapshotRef.current = {
      details: paymentDetails,
      method: paymentMethod,
    };
    setPaymentDetailsModalOpen(true);
  }

  async function handleProcessSale() {
    setFormError(undefined);
    setNeedsVerification(false);

    if (!customerId) {
      setFormError("Selecciona un cliente antes de procesar la venta.");
      return;
    }

    if (cart.items.length === 0) {
      setFormError("Agrega al menos un producto al carrito.");
      return;
    }

    if (checkout) {
      const validation = validateCheckout(totalRef, checkout, rateVes, enabledPaymentMethods, {
        ref: drawerRef,
        ves: drawerVes,
      });
      if (!validation.isValid) {
        setFormError(validation.errors[0] ?? "Revisa el cobro.");
        return;
      }
    } else if (!paymentMethod) {
      setFormError("Selecciona un metodo de pago antes de procesar la venta.");
      return;
    } else if (!isPaymentMethodEnabled(paymentMethod, enabledPaymentMethods)) {
      setFormError("El metodo de pago seleccionado ya no esta habilitado.");
      setPaymentMethod(null);
      setPaymentDetails(null);
      return;
    } else if (methodRequiresPaymentDetails(paymentMethod)) {
      const validation = validateSinglePaymentDetails(paymentMethod, paymentDetails);
      if (!validation.isValid) {
        setFormError(validation.errors[0] ?? "Completa los datos del metodo de pago.");
        setPaymentDetailsModalOpen(true);
        return;
      }
    }

    // Un escaneo en vuelo todavia puede agregar una linea: cobrar ahora venderia sin ella.
    if (scanInFlightRef.current > 0) {
      setFormError("Espera a que termine la busqueda del producto escaneado.");
      return;
    }

    // Doble clic o Enter repetido mientras la peticion viaja: sin este candado se
    // disparaban dos ventas del mismo carrito antes de que `isPending` se reflejara.
    if (submitLockRef.current) {
      return;
    }
    submitLockRef.current = true;
    setIsResolvingAttempt(true);

    try {
      const content = buildSaleContent();
      const fingerprint = saleFingerprint(content);

      let attempt = readSaleAttempt(attemptStorageKey);
      while (attempt?.unresolved) {
        // Hay un cobro anterior de resultado desconocido (de esta pestaña o de otra,
        // y pueden ser varios): se resuelven todos antes de enviar otro.
        if ((await resolveUnresolvedAttempt(attempt)) === "stop") {
          return;
        }
        attempt = readSaleAttempt(attemptStorageKey);
      }

      // Clave nueva solo si el carrito cambio tras un rechazo definitivo del servidor
      // y ningun envio anterior con esa clave quedo en duda.
      if (
        attempt?.rejected !== undefined &&
        attempt.rejected !== fingerprint &&
        attempt.sent.length === 0
      ) {
        attempt = null;
      }

      // Justo antes de enviar (CNF-F8): la copia de un carrito que otra pestaña ya cobró, o
      // que está cobrando ahora, no se cobra aquí. Un carrito sin copias posibles no lee nada.
      const chargeGate = cartDraft.beginCharge();
      if (chargeGate !== "libre") {
        if (chargeGate === "cobrando") {
          setFormError(CART_CHARGING_ELSEWHERE_MESSAGE);
        }
        return;
      }

      const clientRequestId = attempt?.clientRequestId ?? crypto.randomUUID();
      const sentBefore = attempt?.sent ?? [];
      const sent = sentBefore.includes(fingerprint) ? sentBefore : [...sentBefore, fingerprint];

      // Se guarda ANTES de enviar y como "sin resolver": si la pagina se recarga con
      // el cobro viajando, al volver se consulta por esta clave en vez de estrenar otra.
      writeSaleAttempt(attemptStorageKey, { clientRequestId, sent, unresolved: true });
      lastAttemptRef.current = { clientRequestId, fingerprint };

      let sale: SaleMock;
      try {
        sale = await createSale.mutateAsync({
          ...content,
          clientRequestId,
          refRateVes: rateVes || undefined,
        });
      } catch (error) {
        if (isDefinitiveRejection(error)) {
          // 4xx definitivo: el servidor dijo que NO registro la venta.
          writeSaleAttempt(attemptStorageKey, {
            clientRequestId,
            rejected: fingerprint,
            sent: sentBefore,
            unresolved: false,
          });
          cartDraft.endCharge();
          setFormError(error instanceof Error ? error.message : "No pudimos procesar la venta.");
          return;
        }

        // Red caida, respuesta perdida, 5xx o 409: el resultado no se conoce. Nada de
        // reintentar a ciegas; se pregunta al servidor por la clave enviada.
        const conflictMessage =
          error instanceof ClientApiError && error.status === 409 ? error.message : null;
        const outcome = await lookupSaleAttempt(clientRequestId);

        switch (outcome.kind) {
          case "unknown":
            showUnresolvedAttempt();
            return;
          case "registered":
            if (conflictMessage) {
              // 409 con venta en esa clave (C4): la venta existente NO es este cobro.
              // Se muestra como error, nunca como «Venta registrada».
              clearSaleAttempt(attemptStorageKey);
              cartDraft.endCharge();
              lastAttemptRef.current = null;
              setFormError(
                `${conflictMessage} Ya existe la venta ${outcome.sale.invoiceNumber} con ese intento de cobro: verificala en Ventas antes de volver a cobrar.`,
              );
              return;
            }
            settleRegisteredAttempt(outcome.sale, { clientRequestId, sent, unresolved: true });
            return;
          case "voided":
            clearSaleAttempt(attemptStorageKey);
            cartDraft.endCharge();
            setFormError(
              conflictMessage ??
                `El cobro no se completo y la venta ${outcome.sale.invoiceNumber} quedo anulada. Puedes volver a cobrar.`,
            );
            return;
          case "absent":
            writeSaleAttempt(attemptStorageKey, { clientRequestId, sent, unresolved: false });
            cartDraft.endCharge();
            setFormError(conflictMessage ?? SALE_NOT_REGISTERED_MESSAGE);
            return;
        }
      }

      completeSale(sale, content.payments.length > 0);
    } finally {
      submitLockRef.current = false;
      setIsResolvingAttempt(false);
    }
  }

  return (
    <div className="flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-container-lowest px-4 py-3 dark:border-slate-800">
        <div>
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">
            Punto de venta
          </p>
          <h1 className="text-xl font-semibold text-foreground">Realizar venta</h1>
        </div>
        <PageBackButton href="/sales" label="Volver a ventas" size="sm" />
      </header>

      {formError ? (
        <div className="shrink-0 px-4 pt-4">
          <ErrorState
            actionLabel="Verificar"
            description={formError}
            onRetry={
              needsVerification && !isSubmitting ? () => void handleVerifyAttempt() : undefined
            }
            title="Revisa la venta"
          />
        </div>
      ) : null}

      {dependencyError ? (
        <div className="shrink-0 px-4 pt-4">
          <ErrorState
            description={
              dependencyError instanceof Error
                ? dependencyError.message
                : "No pudimos cargar clientes, productos o tasa vigente."
            }
            onRetry={() => {
              void contacts.refetch();
              void products.refetch();
              void currentRate.refetch();
            }}
            title="No pudimos cargar datos base"
          />
        </div>
      ) : null}

      {completedSale ? (
        <PosSaleSuccessOverlay
          invoiceNumber={completedSale.invoiceNumber}
          onNewSale={handleStartNewSale}
          pendingPayment={completedSale.pendingPayment}
        />
      ) : (
        <PosWorkspace
          className="min-h-0 flex-1"
          cart={({ onRequestClose }) => (
            <PosCartPanel
              chargeBlock={
                cartDraft.chargedElsewhere
                  ? {
                      message: CART_CHARGED_ELSEWHERE_MESSAGE,
                      onStartNewSale: cartDraft.startNewSale,
                    }
                  : undefined
              }
              checkout={checkout}
              className="h-full border-t lg:border-t-0"
              customerId={customerId}
              customers={customers}
              drawerRef={drawerRef}
              drawerVes={drawerVes}
              enabledPaymentMethods={enabledPaymentMethods}
              error={formError}
              isScanPending={barcodeScan.isLookingUp}
              isSubmitting={isSubmitting}
              items={cart.items}
              itemsCount={cart.itemsCount}
              onCheckoutChange={(nextCheckout) => {
                setCheckout(nextCheckout);
                setPaymentDetails(null);
                setPaymentDetailsModalOpen(false);
              }}
              onClearCheckout={() => setCheckout(null)}
              onClearOrder={() => void handleClearOrder()}
              onCustomerChange={setCustomerId}
              onEditPaymentDetails={handleOpenPaymentDetailsModal}
              onPaymentMethodChange={handlePaymentMethodChange}
              onProcessSale={() => void handleProcessSale()}
              onQuantityChange={cart.setQuantity}
              onRemoveItem={(productId) => cart.setQuantity(productId, 0)}
              onRequestClose={onRequestClose}
              paymentDetails={paymentDetails}
              paymentMethod={paymentMethod}
              rateVes={rateVes}
              subtotalRef={cart.subtotalRef}
              totalRef={totalRef}
              totalVes={totalVes}
            />
          )}
          catalogScroll={
            <PosProductGrid
              isLoading={products.isLoading}
              onAddProduct={cart.addProduct}
              products={filteredProducts}
              rateVes={rateVes}
              selectedQuantities={cartQuantitiesByProductId}
            />
          }
          categorySlider={
            <PosCategorySlider
              categories={categoryOptions}
              onSelect={setCategoryId}
              selectedCategoryId={categoryId}
            />
          }
          itemsCount={cart.itemsCount}
          rateVes={rateVes}
          toolbar={
            <PosCatalogToolbar
              isLookingUp={barcodeScan.isLookingUp}
              onOpenScan={() => setScanOpen(true)}
              onScanSubmit={handleBarcodeScanSubmit}
              onSearchChange={handleSearchChange}
              ref={searchInputRef}
              scanError={barcodeScan.scanError}
              search={search}
            />
          }
          totalRef={totalRef}
          totalVes={totalVes}
        />
      )}

      <PosScanModal
        isLookingUp={barcodeScan.isLookingUp}
        onDetected={(code) => {
          // Keep modal open on errors so the user can retry immediately.
          void scanIntoCart(code, () => {
            setScanOpen(false);
            focusSearchInput();
          });
        }}
        onFocusSearch={() => {
          setScanOpen(false);
          searchInputRef.current?.focus();
        }}
        onOpenChange={(nextOpen) => {
          setScanOpen(nextOpen);
          if (!nextOpen) {
            barcodeScan.clearScanError();
          }
        }}
        open={scanOpen}
        scanError={barcodeScan.scanError}
      />

      <PosSingleMethodDetailsModal
        initialDetails={paymentDetails}
        method={
          paymentMethod && methodRequiresPaymentDetails(paymentMethod) ? paymentMethod : null
        }
        onCancel={handlePaymentDetailsCancel}
        onConfirm={handlePaymentDetailsConfirm}
        onOpenChange={setPaymentDetailsModalOpen}
        open={paymentDetailsModalOpen}
      />
      <ProcessGuardModal guard={guard} />
    </div>
  );
}
