"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/shared/components/Toast";

import {
  beginPosCartCharge,
  describePosCartRestoration,
  endPosCartCharge,
  findPosCartDraft,
  findSettledPosCart,
  posCartDraftStorageKey,
  posCartRestorationHasChanges,
  posCartSettledStorageKey,
  prunePosCartDrafts,
  readPosCartTabId,
  removePosCartDraft,
  restorePosCartDraft,
  rotatePosCartTabId,
  serializePosCartDraft,
  settlePosCart,
  writePosCartDraft,
  type PosCartChargeGate,
  type PosCartDraftScope,
  type PosCartRestoration,
  type PosCartSettledReason,
} from "../utils/posCartDraft";
import type { PosCartItem } from "./usePosCart";

/** Espera del guardado automático: una ráfaga de escaneos escribe una sola vez. */
export const POS_CART_DRAFT_SAVE_DELAY_MS = 500;

type CatalogProduct = Parameters<typeof restorePosCartDraft>[1]["products"][number];

export type UsePosCartDraftOptions = {
  /** Sesión de caja abierta. Sin ella, sin caja o sin usuario no se lee ni se escribe. */
  cashSessionId?: string | null;
  /**
   * Catálogo y clientes YA cargados, contra los que se revalida el carrito guardado.
   * `null` mientras cargan: la restauración espera.
   */
  catalog: {
    customers: ReadonlyArray<{ id: string }>;
    products: readonly CatalogProduct[];
  } | null;
  customerId: string;
  items: PosCartItem[];
  /** «Vaciar» del aviso «Carrito recuperado». */
  onDiscard: () => void;
  /** Pone en pantalla el carrito revalidado (y su cliente, si sigue existiendo). */
  onRestore: (restoration: PosCartRestoration) => void;
  registerId?: string | null;
  storeId?: string | null;
  userId?: string | null;
};

const SETTLED_ELSEWHERE_NOTICE: Record<PosCartSettledReason, { description: string; title: string }> = {
  cobrado: {
    description:
      "Lo que ves aquí es una copia de esa venta: ya no se guarda ni se puede cobrar. Vacíalo si es la misma venta.",
    title: "Este carrito ya se cobró en otra pestaña",
  },
  vaciado: {
    description: "Lo que ves aquí es una copia y ya no se guarda. Vacíalo si ya no hace falta.",
    title: "Este carrito se vació en otra pestaña",
  },
};

export type PosCartDraftController = {
  /**
   * Justo antes de enviar el cobro (CNF-F8). «libre»: se cobra, y si el carrito tiene
   * copias posibles queda marcado como «cobrando» para las demás pestañas. «cobrado»: es
   * copia de una venta ya registrada en otra pestaña (queda avisado y bloqueado).
   * «cobrando»: otra pestaña lo está cobrando ahora. Un carrito que nunca se guardó no lee
   * ni escribe; uno guardado, una lectura y una escritura. No vuelve a pintar si es «libre».
   */
  beginCharge: () => PosCartChargeGate;
  /**
   * El carrito en pantalla es copia de uno que otra pestaña YA COBRÓ: no se puede cobrar
   * hasta que el cajero lo vacíe o elija `startNewSale`.
   */
  chargedElsewhere: boolean;
  /**
   * El servidor confirmó que el cobro iniciado con `beginCharge` no dejó venta: retira la
   * marca «cobrando». Sin marca propia no hace nada. Un cobro sin confirmar NO la retira.
   */
  endCharge: () => void;
  /**
   * La venta de este carrito quedó registrada: al vaciarse, sus copias en otras pestañas
   * se cierran como «cobrado» y no como «vaciado». No lee ni escribe nada.
   */
  markCharged: () => void;
  /** `localStorage` no dejó escribir: lo que hay en el carrito no está guardado. */
  saveFailed: boolean;
  /** Guarda YA el carrito (salir, recargar), sin esperar al guardado automático. */
  saveNow: () => void;
  /**
   * El carrito en pantalla es copia de uno que otra pestaña ya cobró o vació: se avisó,
   * sigue en pantalla hasta que el cajero lo vacíe y ya no se guarda.
   */
  settledElsewhere: boolean;
  /**
   * «Es una venta nueva»: el carrito en pantalla deja de ser copia. Estrena identidad,
   * vuelve a guardarse y se puede cobrar.
   */
  startNewSale: () => void;
};

/**
 * Carrito recuperable del POS (CNF-16) sobre `utils/posCartDraft.ts`.
 *
 * - Guarda el carrito `POS_CART_DRAFT_SAVE_DELAY_MS` después del último cambio, desde
 *   un temporizador: escanear, tocar una cantidad o cobrar no escriben en
 *   `localStorage`. Lo pendiente se escribe al desmontar la pantalla y con `saveNow`.
 * - Un carrito vacío (venta cobrada u orden limpiada) borra lo guardado en el acto.
 * - Al montar toma el carrito de esta pestaña o, si no tiene, el más reciente de la
 *   misma caja y sesión. Lo restaura cuando hay catálogo, revalidado contra él, y
 *   avisa con «Carrito recuperado». Hasta entonces no guarda, para no pisarlo.
 * - Si otra pestaña se lleva el carrito de esta, lo vuelve a escribir; si otra
 *   pestaña comparte su identificador (pestaña duplicada), estrena uno.
 * - Al cobrarse un carrito guardado, o al vaciarse en la pestaña que lo creó, se cierran
 *   TODAS sus copias (`settlePosCart`). La pestaña que tenga una en pantalla se entera
 *   (evento `storage`, al volver a verse, al ir a guardar o al ir a cobrar), deja de
 *   guardarla y avisa con «Vaciar»; no la borra de la pantalla. Si se cobró, además no
 *   deja cobrarla (`chargedElsewhere`) hasta «Vaciar» o «Es una venta nueva».
 * - Vaciar una COPIA (un carrito recogido de otra pestaña) solo borra la de esta pestaña:
 *   la pestaña que lo creó conserva su carrito guardado (CNF-F8).
 * - Sin `localStorage`, lleno, o con contenido ilegible, el POS funciona igual.
 */
export function usePosCartDraft(options: UsePosCartDraftOptions): PosCartDraftController {
  const { cashSessionId, catalog, customerId, items, registerId, storeId, userId } = options;
  const { dismiss, showToast } = useToast();
  const scope = useMemo<PosCartDraftScope | null>(
    () =>
      cashSessionId && registerId && userId
        ? { cashSessionId, registerId, storeId: storeId ?? null, userId }
        : null,
    [cashSessionId, registerId, storeId, userId],
  );
  const [tabId, setTabId] = useState(readPosCartTabId);
  const key = scope ? posCartDraftStorageKey(scope, tabId) : null;
  // Lo guardado al entrar: PosCashSessionGate ya esperó por la caja y el usuario.
  const [found] = useState(() => (scope ? findPosCartDraft(scope, tabId) : null));
  const [saveFailed, setSaveFailed] = useState(false);
  const [settledElsewhere, setSettledElsewhere] = useState<PosCartSettledReason | null>(null);
  const saveFailedRef = useRef(false);
  /** Identidad del carrito en pantalla; `null` mientras no se haya guardado nunca. */
  const cartIdRef = useRef<string | null>(null);
  /** El carrito en pantalla se vendió: lo anota `markCharged` justo antes de vaciarse. */
  const chargedRef = useRef(false);
  /** El carrito en pantalla, si otra pestaña ya lo cerró, y cómo. */
  const settledElsewhereRef = useRef<{ cartId: string; reason: PosCartSettledReason } | null>(null);
  /** El carrito en pantalla se recogió de otra pestaña, que puede seguir teniéndolo. */
  const copyRef = useRef(false);
  /** `cartId` para el que esta pestaña dejó la marca «cobrando». */
  const chargingRef = useRef<string | null>(null);
  const awaitingRestoreRef = useRef(found !== null);
  const latestRef = useRef({ key, options, scope, tabId });
  const timerRef = useRef<number | null>(null);
  /** Clave en la que esta pestaña tiene algo escrito. */
  const savedKeyRef = useRef<string | null>(null);
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    latestRef.current = { key, options, scope, tabId };
  });

  const cancelScheduled = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Otra pestaña cerró el carrito en pantalla: deja de guardarse y se avisa, sin tocar la pantalla. */
  const noteSettledElsewhere = useCallback(
    (cartId: string, reason: PosCartSettledReason) => {
      settledElsewhereRef.current = { cartId, reason };
      cancelScheduled();
      setSettledElsewhere(reason);

      if (toastIdRef.current) {
        dismiss(toastIdRef.current);
      }

      toastIdRef.current = showToast({
        action: { label: "Vaciar", onClick: () => latestRef.current.options.onDiscard() },
        ...SETTLED_ELSEWHERE_NOTICE[reason],
        durationMs: 0,
        tone: "error",
      });
    },
    [cancelScheduled, dismiss, showToast],
  );

  /**
   * `true` si el carrito en pantalla ya se cobró o vació en otra pestaña. La primera vez
   * que lo ve (o si de «vaciado» pasó a «cobrado»), avisa.
   */
  const checkSettledElsewhere = useCallback(() => {
    const { scope: currentScope } = latestRef.current;
    const cartId = cartIdRef.current;

    if (!currentScope || !cartId) {
      return false;
    }

    const known =
      settledElsewhereRef.current?.cartId === cartId ? settledElsewhereRef.current.reason : null;

    if (known === "cobrado") {
      return true;
    }

    const reason = findSettledPosCart(currentScope, cartId);

    if (!reason || reason === known) {
      // Una marca caducada no devuelve la copia al guardado.
      return known !== null;
    }

    noteSettledElsewhere(cartId, reason);

    return true;
  }, [noteSettledElsewhere]);

  const markCharged = useCallback(() => {
    chargedRef.current = true;
  }, []);

  const beginCharge = useCallback((): PosCartChargeGate => {
    const { scope: currentScope, tabId: currentTabId } = latestRef.current;
    const cartId = cartIdRef.current;

    // Sin identidad el carrito nunca se guardó: ninguna otra pestaña tiene una copia.
    if (!currentScope || !cartId) {
      return "libre";
    }

    const known = settledElsewhereRef.current;

    if (known?.cartId === cartId && known.reason === "cobrado") {
      return "cobrado";
    }

    const gate = beginPosCartCharge(currentScope, cartId, currentTabId);

    if (gate === "cobrado") {
      noteSettledElsewhere(cartId, "cobrado");
    } else if (gate === "libre") {
      chargingRef.current = cartId;
    }

    return gate;
  }, [noteSettledElsewhere]);

  const endCharge = useCallback(() => {
    const { scope: currentScope, tabId: currentTabId } = latestRef.current;
    const cartId = chargingRef.current;

    chargingRef.current = null;

    if (currentScope && cartId) {
      endPosCartCharge(currentScope, cartId, currentTabId);
    }
  }, []);

  const saveNow = useCallback(() => {
    cancelScheduled();

    const current = latestRef.current;

    // Con un carrito guardado aún sin restaurar no se escribe: se pisaría.
    if (!current.key || !current.scope || awaitingRestoreRef.current) {
      return;
    }

    if (current.options.items.length === 0) {
      if (savedKeyRef.current === current.key) {
        removePosCartDraft(current.key);
        savedKeyRef.current = null;
      }

      return;
    }

    // Copia de un carrito que otra pestaña ya cobró o vació: no se vuelve a guardar.
    if (checkSettledElsewhere()) {
      return;
    }

    cartIdRef.current ??= crypto.randomUUID();

    const saved = writePosCartDraft(
      current.key,
      serializePosCartDraft(
        {
          cartId: cartIdRef.current,
          customerId: current.options.customerId,
          items: current.options.items,
        },
        current.scope,
        new Date(),
      ),
    );

    if (saved) {
      savedKeyRef.current = current.key;
    }

    // Solo si cambia: un guardado normal no vuelve a pintar el POS.
    if (saveFailedRef.current === saved) {
      saveFailedRef.current = !saved;
      setSaveFailed(!saved);
    }
  }, [cancelScheduled, checkSettledElsewhere]);

  useEffect(() => {
    if (scope) {
      prunePosCartDrafts(scope);
    }
  }, [scope]);

  // Va ANTES de la restauración: en el render en que llega el catálogo todavía no guarda.
  useEffect(() => {
    if (!key || awaitingRestoreRef.current) {
      return;
    }

    if (items.length === 0) {
      // Venta cobrada u orden limpiada: lo guardado se borra ya, y «Vaciar» deja de ofrecerse.
      saveNow();

      const cartId = cartIdRef.current;

      if (cartId && scope) {
        if (chargedRef.current) {
          // Vendido: se cierran todas sus copias, en todas las pestañas.
          settlePosCart(scope, cartId, "cobrado");
        } else if (!copyRef.current && settledElsewhereRef.current?.cartId !== cartId) {
          // Vaciado en la pestaña que lo creó: sus copias ya no valen. Vaciar una COPIA no
          // cierra nada: la pestaña de origen conserva su carrito.
          settlePosCart(scope, cartId, "vaciado");
        }
      }

      cartIdRef.current = null;
      chargedRef.current = false;
      settledElsewhereRef.current = null;
      copyRef.current = false;
      chargingRef.current = null;

      if (toastIdRef.current) {
        dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }

      return;
    }

    cancelScheduled();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      saveNow();
    }, POS_CART_DRAFT_SAVE_DELAY_MS);
  }, [cancelScheduled, customerId, dismiss, items, key, saveNow, scope]);

  useEffect(() => {
    if (!found || !catalog || !awaitingRestoreRef.current) {
      return;
    }

    awaitingRestoreRef.current = false;

    const current = latestRef.current;
    const foundCartId = found.draft.cartId;

    // Entre leerlo y tener catálogo, otra pestaña lo cobró o lo vació: no hay nada que recuperar.
    if (current.scope && foundCartId && findSettledPosCart(current.scope, foundCartId)) {
      removePosCartDraft(found.key);
      return;
    }

    const restoration = restorePosCartDraft(found.draft, {
      customerIds: new Set(catalog.customers.map((customer) => customer.id)),
      products: catalog.products,
    });

    // El carrito pasa a la clave de esta pestaña ANTES de borrar la de origen, con su
    // misma identidad: si la pestaña de origen sigue abierta, las dos tienen una copia.
    if (current.key && current.scope && restoration.items.length > 0) {
      cartIdRef.current = foundCartId ?? crypto.randomUUID();
      copyRef.current = foundCartId !== undefined && found.key !== current.key;

      const saved = writePosCartDraft(
        current.key,
        serializePosCartDraft(
          {
            cartId: cartIdRef.current,
            customerId: restoration.customerId ?? current.options.customerId,
            items: restoration.items,
          },
          current.scope,
          new Date(),
        ),
      );

      if (saved) {
        savedKeyRef.current = current.key;
      }

      if (saved && found.key !== current.key) {
        removePosCartDraft(found.key);
      }
    } else {
      removePosCartDraft(found.key);
    }

    current.options.onRestore(restoration);

    const hasItems = restoration.items.length > 0;

    const toastId = showToast({
      action: hasItems
        ? { label: "Vaciar", onClick: () => latestRef.current.options.onDiscard() }
        : undefined,
      description: describePosCartRestoration(restoration),
      // Un producto quitado o un precio distinto no se cierran solos.
      durationMs: posCartRestorationHasChanges(restoration) ? 0 : undefined,
      title: hasItems ? "Carrito recuperado" : "El carrito guardado ya no se puede recuperar",
      tone: "info",
    });

    // Solo el aviso con «Vaciar» se retira al vaciarse el carrito.
    toastIdRef.current = hasItems ? toastId : null;
  }, [catalog, found, showToast]);

  useEffect(() => {
    if (!key) {
      return;
    }

    const settledKey = scope ? posCartSettledStorageKey(scope) : null;

    function handleStorage(event: StorageEvent) {
      if (event.key === settledKey) {
        // Otra pestaña cobró o vació un carrito: puede ser el que esta tiene en pantalla.
        checkSettledElsewhere();
        return;
      }

      if (event.key !== key || awaitingRestoreRef.current) {
        return;
      }

      if (event.newValue === null) {
        // Otra pestaña se llevó (o borró) el carrito de esta: se vuelve a guardar.
        if (latestRef.current.options.items.length > 0) {
          saveNow();
        }

        return;
      }

      // Otra pestaña escribe en esta clave: comparte identificador (pestaña duplicada).
      savedKeyRef.current = null;
      setTabId(rotatePosCartTabId());
    }

    // Una pestaña en segundo plano puede no recibir `storage`: al volver a verse, mira.
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        checkSettledElsewhere();
      }
    }

    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [checkSettledElsewhere, key, saveNow, scope]);

  // Salir de la pantalla dentro de la espera: lo pendiente se escribe.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        saveNow();
      }
    },
    [saveNow],
  );

  const startNewSale = useCallback(() => {
    // Sin identidad, el guardado le da una nueva: ya no comparte nada con la venta cobrada.
    cartIdRef.current = null;
    settledElsewhereRef.current = null;
    copyRef.current = false;
    chargingRef.current = null;
    setSettledElsewhere(null);

    if (toastIdRef.current) {
      dismiss(toastIdRef.current);
      toastIdRef.current = null;
    }

    saveNow();
  }, [dismiss, saveNow]);

  // Con el carrito vacío ya no hay copia en pantalla de la que avisar.
  if (settledElsewhere !== null && items.length === 0) {
    setSettledElsewhere(null);
  }

  return useMemo(
    () => ({
      beginCharge,
      chargedElsewhere: settledElsewhere === "cobrado",
      endCharge,
      markCharged,
      saveFailed,
      saveNow,
      settledElsewhere: settledElsewhere !== null,
      startNewSale,
    }),
    [beginCharge, endCharge, markCharged, saveFailed, saveNow, settledElsewhere, startNewSale],
  );
}
