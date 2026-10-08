import { type ReactNode } from "react";

import { ContactsStatusBadge } from "@/modules/contacts/contacts-list/components/ContactsStatusBadge";
import { PageBackButton } from "@/shared/components/PageBackButton";

type ContactDetailPageHeaderProps = {
  actions?: ReactNode;
  isActive: boolean;
  name: string;
};

export function ContactDetailPageHeader({
  actions,
  isActive,
  name,
}: ContactDetailPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-outline-variant pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{name}</h1>
        <ContactsStatusBadge isActive={isActive} />
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
        {actions ?? <PageBackButton href="/contacts" size="sm" />}
      </div>
    </div>
  );
}
