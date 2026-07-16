"use client";

import { Building2, Users } from "lucide-react";
import Link from "next/link";

import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Badge } from "@/shared/components/Badge";
import { Card, CardContent } from "@/shared/components/Card";
import { Typography } from "@/shared/components/Typography";

import type { PlatformStore } from "../../types/stores";

type StoreCardProps = {
  onToggleStatus: (store: PlatformStore) => void;
  store: PlatformStore;
};

export function StoreCard({ onToggleStatus, store }: StoreCardProps) {
  const createdLabel = new Intl.DateTimeFormat("es-VE", {
    dateStyle: "medium",
  }).format(new Date(store.createdAt));

  const actions: ActionMenuItem[] = [
    { href: `/platform/stores/${store.id}`, label: "Ver detalle" },
    {
      label: store.status === "active" ? "Pausar tienda" : "Activar tienda",
      onSelect: () => onToggleStatus(store),
      variant: store.status === "active" ? "danger" : "default",
    },
  ];

  return (
    <Card className="relative h-full transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 aria-hidden className="size-5" />
            </div>
            <div className="min-w-0">
              <Link
                className="block truncate font-semibold text-foreground hover:text-primary hover:underline"
                href={`/platform/stores/${store.id}`}
              >
                {store.name}
              </Link>
              <Typography className="mt-0.5 truncate" variant="caption">
                /{store.slug}
              </Typography>
            </div>
          </div>
          <ActionsMenu actions={actions} label={`Acciones de ${store.name}`} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={store.status === "active" ? "success" : "warning"}>
            {store.status === "active" ? "Activa" : "Pausada"}
          </Badge>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users aria-hidden className="size-4" />
            {store.usersCount} {store.usersCount === 1 ? "usuario" : "usuarios"}
          </span>
          <span>{createdLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}
