"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { readChainedReturnTo } from "@/modules/inventory/utils/chainedReturnTo";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { RETURN_TO_PARAM } from "@/shared/utils/returnTo";

const FALLBACK_HREF = "/sales";

/** Único punto que lee la URL: `useSearchParams` exige el límite de Suspense de `SaleDetailBackButton`. */
function ChainedBackButton() {
  // El `returnTo` entero, con el que lleve anidado: quien abrió la venta (el
  // kardex de un producto, un pago, una lista) recupera su propio "Volver".
  const returnTo = readChainedReturnTo(useSearchParams().get(RETURN_TO_PARAM));

  return returnTo ? (
    <PageBackButton href={returnTo} shortcuts size="sm" />
  ) : (
    <PageBackButton fallbackHref={FALLBACK_HREF} size="sm" />
  );
}

/**
 * "Volver" del detalle de venta. Regresa a la pantalla de origen que viaja en
 * `?returnTo=` tal como estaba, sin quitarle su `returnTo` anidado (cadena
 * lista → detalle → venta → Volver → detalle → Volver → lista con filtros).
 * Sin `returnTo` válido vuelve a `/sales`.
 */
export function SaleDetailBackButton() {
  return (
    <Suspense fallback={<PageBackButton fallbackHref={FALLBACK_HREF} size="sm" />}>
      <ChainedBackButton />
    </Suspense>
  );
}
