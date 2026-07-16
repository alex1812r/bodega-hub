"use client";

import { Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { isUserRole, roleLabels } from "@/shared/auth/permissions";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { Input } from "@/shared/components/Input";
import { LoadingState } from "@/shared/components/LoadingState";
import { PageHeader } from "@/shared/components/PageHeader";
import { SelectField } from "@/shared/components/SelectField";

import { useStoresList } from "../hooks/useStores";
import { usePlatformUsersList } from "../hooks/useUsers";
import type { PlatformUser } from "../types/users";

function roleLabel(role: string) {
  return isUserRole(role) ? roleLabels[role] : role;
}

const columns: DataTableColumn<PlatformUser>[] = [
  {
    header: "Usuario",
    key: "name",
    render: (user) => (
      <div className="min-w-0">
        <Link
          className="font-medium text-foreground hover:text-primary hover:underline"
          href={`/platform/users/${user.id}`}
        >
          {user.name}
        </Link>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
      </div>
    ),
  },
  {
    header: "Tienda",
    key: "store",
    render: (user) =>
      user.store ? (
        <Link
          className="hover:text-primary hover:underline"
          href={`/platform/stores/${user.store.id}`}
        >
          <span className="block font-medium">{user.store.name}</span>
          <span className="text-sm text-muted-foreground">/{user.store.slug}</span>
        </Link>
      ) : (
        <span className="text-muted-foreground">Sin tienda</span>
      ),
  },
  {
    header: "Rol",
    key: "role",
    render: (user) => <Badge variant="default">{roleLabel(user.role)}</Badge>,
  },
  {
    header: "Estado",
    key: "isActive",
    render: (user) => (
      <Badge variant={user.isActive ? "success" : "warning"}>
        {user.isActive ? "Activo" : "Inactivo"}
      </Badge>
    ),
  },
];

export function PlatformUsersListPage() {
  const [search, setSearch] = useState("");
  const [storeId, setStoreId] = useState("");
  const [role, setRole] = useState("");
  const stores = useStoresList({ limit: 100 });
  const users = usePlatformUsersList({
    role: role || undefined,
    search,
    storeId: storeId || undefined,
  });
  const items = getPaginatedItems(users.data);
  const storeOptions = useMemo(
    () => [
      { label: "Todas las tiendas", value: "" },
      ...getPaginatedItems(stores.data).map((store) => ({
        label: store.name,
        value: store.id,
      })),
    ],
    [stores.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            <Input
              aria-label="Buscar usuarios"
              className="sm:w-56"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, email o tienda"
              value={search}
            />
            <SelectField
              aria-label="Filtrar por tienda"
              className="sm:w-48"
              onChange={(event) => setStoreId(event.target.value)}
              options={storeOptions}
              value={storeId}
            />
            <SelectField
              aria-label="Filtrar por rol"
              className="sm:w-44"
              onChange={(event) => setRole(event.target.value)}
              options={[
                { label: "Todos los roles", value: "" },
                { label: roleLabels.admin, value: "admin" },
                { label: roleLabels.vendedor, value: "vendedor" },
                { label: roleLabels.almacen, value: "almacen" },
                { label: roleLabels.contador, value: "contador" },
              ]}
              value={role}
            />
            <Button asChild className="shrink-0">
              <Link href="/platform/users/new-admin">
                <Plus className="mr-2 size-4" />
                Nuevo admin
              </Link>
            </Button>
          </>
        }
        description="Directorio de usuarios de todas las tiendas. Solo puedes crear administradores."
        title="Usuarios"
      />

      {users.isLoading ? (
        <LoadingState
          description="Cargando el directorio de usuarios."
          title="Cargando usuarios..."
          variant="section"
        />
      ) : users.error ? (
        <EmptyState description={users.error.message} title="No pudimos cargar los usuarios" />
      ) : items.length === 0 ? (
        <EmptyState
          action={
            <Button asChild>
              <Link href="/platform/users/new-admin">
                <Plus className="mr-2 size-4" />
                Nuevo admin
              </Link>
            </Button>
          }
          description="Ajusta los filtros o crea un administrador para una tienda."
          icon={<UserRound className="size-5" />}
          title="No hay usuarios"
        />
      ) : (
        <DataTable
          actions={(user): ActionMenuItem[] => [
            { href: `/platform/users/${user.id}`, label: "Ver detalle" },
          ]}
          cardSubtitle={(user) => user.email}
          cardTitle={(user) => user.name}
          columns={columns}
          data={items}
          getRowId={(user) => user.id}
        />
      )}
    </div>
  );
}
