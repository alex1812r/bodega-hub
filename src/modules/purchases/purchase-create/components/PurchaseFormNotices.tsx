import { TriangleAlert } from "lucide-react";

import { Button } from "@/shared/components/Button";

type PurchaseFormNoticesProps = {
  messages: string[];
  /** Sin ella el aviso no se puede cerrar: desaparece cuando deja de aplicar. */
  onDismiss?: () => void;
};

/**
 * Avisos de lo que cambió al restaurar el borrador o duplicar una compra
 * (COM-09): tasa distinta, productos que se quitaron, proveedor inactivo.
 */
export function PurchaseFormNotices({ messages, onDismiss }: PurchaseFormNoticesProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 sm:flex-row sm:items-start sm:justify-between dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-3">
        <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <ul className="min-w-0 space-y-1 text-sm">
          {messages.map((message) => (
            <li className="break-words" key={message}>
              {message}
            </li>
          ))}
        </ul>
      </div>
      {onDismiss ? (
        <Button className="shrink-0" onClick={onDismiss} size="sm" type="button" variant="outline">
          Entendido
        </Button>
      ) : null}
    </div>
  );
}
