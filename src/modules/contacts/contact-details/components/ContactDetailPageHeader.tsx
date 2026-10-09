import { type ReactNode } from "react";

import { ContactsStatusBadge } from "@/modules/contacts/contacts-list/components/ContactsStatusBadge";
import { PageBackButton } from "@/shared/components/PageBackButton";

type ContactDetailPageHeaderProps = {
  /** Acciones junto a "Volver" (p. ej. "Editar"). */
  actions?: ReactNode;
  isActive: boolean;
  name: string;
  /** Resumen del contacto (totales y saldo pendiente), bajo el nombre. */
  summary?: ReactNode;
};

export function ContactDetailPageHeader({
  actions,
  isActive,
  name,
  summary,
}: ContactDetailPageHeaderProps) {
  return (
    <header className="space-y-4 border-b border-outline-variant pb-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-foreground">
            {name}
          </h1>
          <ContactsStatusBadge isActive={isActive} />
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
          {/* Encadenado: si se llegó desde otro detalle, vuelve a él tal como estaba. */}
          <PageBackButton chained fallbackHref="/contacts" size="sm" />
          {actions}
        </div>
      </div>
      {summary}
    </header>
  );
}
