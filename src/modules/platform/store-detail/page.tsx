"use client";

import Link from "next/link";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { LoadingState } from "@/shared/components/LoadingState";
import { Typography } from "@/shared/components/Typography";

import { useStoreDetail, useUpdateStore } from "../hooks/useStores";

export function StoreDetailPage({ id }: { id: string }) {
  const store = useStoreDetail(id);
  const updateStore = useUpdateStore(id);

  if (store.isLoading) {
    return <LoadingState title="Cargando tienda..." variant="page" />;
  }

  if (!store.data) {
    return (
      <Typography variant="muted">No se pudo cargar la tienda.</Typography>
    );
  }

  const item = store.data;
  const nextStatus = item.status === "active" ? "paused" : "active";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link className="text-sm text-primary hover:underline" href="/platform/stores">
            ← Tiendas
          </Link>
          <Typography as="h1" className="mt-2" variant="h1">
            {item.name}
          </Typography>
          <Typography variant="muted">/{item.slug}</Typography>
        </div>
        <Button
          disabled={updateStore.isPending}
          onClick={() => updateStore.mutate({ status: nextStatus })}
          variant={item.status === "active" ? "outline" : "primary"}
        >
          {item.status === "active" ? "Pausar tienda" : "Activar tienda"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informacion de la tienda</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <Typography variant="caption">Estado</Typography>
            <div className="mt-1">
              <Badge variant={item.status === "active" ? "success" : "warning"}>
                {item.status === "active" ? "Activa" : "Pausada"}
              </Badge>
            </div>
          </div>
          <div>
            <Typography variant="caption">Usuarios</Typography>
            <Typography className="mt-1" variant="body">
              {item.usersCount}
            </Typography>
          </div>
          <div>
            <Typography variant="caption">Notas</Typography>
            <Typography className="mt-1" variant="body">
              {item.notes || "Sin notas"}
            </Typography>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Usuarios de la tienda</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href={`/platform/users/new-admin?storeId=${item.id}`}>Nuevo admin</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {item.users.map((user) => (
              <div className="flex items-center justify-between gap-3 py-3" key={user.id}>
                <div className="min-w-0">
                  <Link
                    className="font-medium text-foreground hover:text-primary hover:underline"
                    href={`/platform/users/${user.id}`}
                  >
                    {user.name}
                  </Link>
                  <Typography variant="muted">{user.email}</Typography>
                </div>
                <Badge variant={user.isActive ? "success" : "default"}>{user.role}</Badge>
              </div>
            ))}
            {item.users.length === 0 ? (
              <Typography className="py-3" variant="muted">
                Esta tienda no tiene usuarios.
              </Typography>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
