"use client";

import { useEffect, useRef, useState } from "react";

import {
  type PurchaseCodeResolution,
  resolvePurchaseProductByCode,
} from "../services/resolveSupplierCatalogProduct";

/** Un escaneo en espera: los códigos posibles (uno desde el buscador, varios desde una celda). */
export type PurchaseScanJob = {
  /** Códigos a consultar en este orden; el primero que sea de un producto es el escaneado. */
  codes: string[];
  /**
   * Se llama una vez, ANTES de `onSettled` (que puede agregar el producto y bloquear la
   * línea): el código que existía, o `null` si ninguno, falló la consulta o se descartó.
   */
  onResolved?: (code: string | null) => void;
  /** El escaneo vino de la cámara: al agregar se cierra su ventana. */
  closeScanOnSuccess?: boolean;
  /** Lo que había en el buscador al pulsar Enter; un código detectado en una celda no lo trae. */
  searchText?: string;
};

export type PurchaseScanOutcome = {
  job: PurchaseScanJob;
  /** Quedan escaneos detrás en la cola: el aviso de este lo va a pisar el siguiente. */
  hasMore: boolean;
  /** `failed` = la consulta no respondió; el resto es lo que dijo el servidor. */
  resolution: PurchaseCodeResolution | { status: "failed" };
};

type QueuedScan = { job: PurchaseScanJob; supplierId: string };

/**
 * Consulta los códigos uno tras otro, con la misma resolución exacta del buscador, y se
 * detiene en el primero que es de algún producto. `code` es ese código; `null` si ninguno.
 */
async function resolveFirstKnownCode(
  supplierId: string,
  codes: string[],
): Promise<{ code: string | null; resolution: PurchaseCodeResolution }> {
  for (const code of codes) {
    const resolution = await resolvePurchaseProductByCode(supplierId, code);

    if (resolution.status !== "not_found") {
      return { code, resolution };
    }
  }

  return { code: null, resolution: { status: "not_found" } };
}

/**
 * Cola de escaneos de la compra (COM-F8). El lector encadena códigos sin esperar la
 * respuesta del anterior: cada uno se encola al instante y se resuelven EN ORDEN, de uno
 * en uno, sin perder ninguno. El resultado de cada escaneo (producto, aviso o fallo) llega
 * por `onSettled` y no frena a los siguientes.
 *
 * Un escaneo es del proveedor con el que se encoló: si cambió antes de resolverse, se
 * descarta sin avisar (sus costos y vínculos eran de aquel).
 */
export function usePurchaseScanQueue(
  supplierId: string,
  onSettled: (outcome: PurchaseScanOutcome) => void,
) {
  const queue = useRef<QueuedScan[]>([]);
  const draining = useRef(false);
  const alive = useRef(true);
  // Lo último que pintó el componente: la cola sigue resolviendo entre un render y otro.
  const latest = useRef({ onSettled, supplierId });
  const [pending, setPending] = useState(0);

  useEffect(() => {
    latest.current = { onSettled, supplierId };
  });

  // Al desmontar, lo que quede en la cola se abandona.
  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  async function drain() {
    if (draining.current) {
      return;
    }

    draining.current = true;

    for (let next = queue.current[0]; next; next = queue.current[0]) {
      const { job, supplierId: jobSupplierId } = next;
      const result = await resolveFirstKnownCode(jobSupplierId, job.codes).catch(() => null);

      if (!alive.current) {
        break;
      }

      // Se saca al terminar: mientras se resuelve cuenta como pendiente.
      queue.current.shift();
      setPending(queue.current.length);

      if (latest.current.supplierId !== jobSupplierId) {
        job.onResolved?.(null);
        continue;
      }

      const found = result?.resolution.status === "found";

      job.onResolved?.(found ? (result?.code ?? null) : null);
      latest.current.onSettled({
        hasMore: queue.current.length > 0,
        job,
        resolution: result?.resolution ?? { status: "failed" },
      });
    }

    draining.current = false;
  }

  function enqueue(job: PurchaseScanJob) {
    queue.current.push({ job, supplierId });
    setPending(queue.current.length);
    void drain();
  }

  return { enqueue, pending };
}
