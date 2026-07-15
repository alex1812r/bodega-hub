import { Badge, Mail, MapPin, Phone } from "lucide-react";

import { ContactsTypeBadge } from "@/modules/contacts/contacts-list/components/ContactsTypeBadge";
import type { ContactMock } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

type ContactProfileCardProps = {
  className?: string;
  contact: ContactMock;
};

function contactInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function ContactProfileCard({ className, contact }: ContactProfileCardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm",
        className,
      )}
    >
      <div className="mb-6 flex items-start gap-4">
        <div
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-lg font-bold text-primary"
        >
          {contactInitials(contact.name)}
        </div>
        <div className="min-w-0">
          <ContactsTypeBadge type={contact.type} />
          <h2 className="mt-2 text-lg font-semibold text-foreground">{contact.name}</h2>
          <p className="mt-1 flex items-center gap-1 text-sm text-on-surface-variant">
            <Badge aria-hidden className="size-4 shrink-0" />
            {contact.taxId || "Sin documento"}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <ContactProfileField
          href={contact.email ? `mailto:${contact.email}` : undefined}
          icon={Mail}
          label="Email"
          value={contact.email || "—"}
        />
        <ContactProfileField icon={Phone} label="Teléfono" value={contact.phone || "—"} />
        <ContactProfileField icon={MapPin} label="Dirección" value={contact.address || "—"} />
      </div>
    </section>
  );
}

type ContactProfileFieldProps = {
  href?: string;
  icon: typeof Mail;
  label: string;
  value: string;
};

function ContactProfileField({ href, icon: Icon, label, value }: ContactProfileFieldProps) {
  return (
    <div className="flex items-start gap-3">
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-outline" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-on-surface-variant">{label}</p>
        {href ? (
          <a className="text-sm text-primary hover:underline" href={href}>
            {value}
          </a>
        ) : (
          <p className="text-sm text-foreground">{value}</p>
        )}
      </div>
    </div>
  );
}
