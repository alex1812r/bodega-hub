"use client";

import Link from "next/link";

import { isUserRole, roleLabels } from "@/shared/auth/permissions";
import { Badge } from "@/shared/components/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { LoadingState } from "@/shared/components/LoadingState";
import { Typography } from "@/shared/components/Typography";

import { usePlatformUserDetail } from "../hooks/useUsers";

function roleLabel(role: string) {
  return isUserRole(role) ? roleLabels[role] : role;
}

export function PlatformUserDetailPage({ id }: { id: string }) {
  const user = usePlatformUserDetail(id);

  if (user.isLoading) {
    return <LoadingState title="Cargando usuario..." variant="page" />;
  }

  if (!user.data) {
    return <Typography variant="muted">No se pudo cargar el usuario.</Typography>;
  }

  const item = user.data;

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm text-primary hover:underline" href="/platform/users">
          ← Usuarios
        </Link>
        <Typography as="h1" className="mt-2" variant="h1">
          {item.name}
        </Typography>
        <Typography variant="muted">{item.email}</Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informacion del usuario</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Typography variant="caption">Rol</Typography>
            <div className="mt-1">
              <Badge variant="default">{roleLabel(item.role)}</Badge>
            </div>
          </div>
          <div>
            <Typography variant="caption">Estado</Typography>
            <div className="mt-1">
              <Badge variant={item.isActive ? "success" : "warning"}>
                {item.isActive ? "Activo" : "Inactivo"}
              </Badge>
            </div>
          </div>
          <div className="sm:col-span-2">
            <Typography variant="caption">Tienda</Typography>
            {item.store ? (
              <div className="mt-1">
                <Link
                  className="font-medium text-primary hover:underline"
                  href={`/platform/stores/${item.store.id}`}
                >
                  {item.store.name}
                </Link>
                <Typography variant="muted">/{item.store.slug}</Typography>
              </div>
            ) : (
              <Typography className="mt-1" variant="body">
                Sin tienda
              </Typography>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permisos efectivos (overrides)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Typography variant="caption">Otorgados</Typography>
            <Typography className="mt-1" variant="body">
              {item.grantedPermissions.length > 0
                ? item.grantedPermissions.join(", ")
                : "Ninguno"}
            </Typography>
          </div>
          <div>
            <Typography variant="caption">Denegados</Typography>
            <Typography className="mt-1" variant="body">
              {item.deniedPermissions.length > 0
                ? item.deniedPermissions.join(", ")
                : "Ninguno"}
            </Typography>
          </div>
        </CardContent>
      </Card>

      {item.role !== "admin" ? (
        <Typography variant="muted">
          Los usuarios con rol distinto de administrador los gestiona el admin de cada tienda.
        </Typography>
      ) : null}
    </div>
  );
}
