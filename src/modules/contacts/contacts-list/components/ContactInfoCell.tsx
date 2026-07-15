import { Mail, Phone } from "lucide-react";

import { cn } from "@/shared/utils/cn";

type ContactInfoCellProps = {
  email?: string;
  phone?: string;
};

export function ContactInfoCell({ email, phone }: ContactInfoCellProps) {
  if (!phone && !email) {
    return <span className="text-sm text-outline">—</span>;
  }

  return (
    <div className="flex flex-col text-sm text-on-surface-variant">
      {phone ? (
        <div className="flex items-center gap-1.5">
          <Phone aria-hidden className="size-3.5 shrink-0" />
          <span>{phone}</span>
        </div>
      ) : null}
      {email ? (
        <div className={cn("flex items-center gap-1.5", phone && "mt-0.5")}>
          <Mail aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{email}</span>
        </div>
      ) : null}
    </div>
  );
}
