"use client";

import { Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

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
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { withReturnTo } from "@/shared/utils/returnTo";

import { useStoresList } from "../hooks/useStores";
import { usePlatformUsersList } from "../hooks/useUsers";
import type { PlatformUser } from "../types/users";
import {
  PLATFORM_USER_ROLE_FILTER_VALUES,
  platformUsersListSchema,
  toPlatformUsersFilters,
  type PlatformUsersListState,
} from "./usersListParams";

function roleLabel(role: string) {
  return isUserRole(role) ? roleLabels[role] : role;
}

const roleOptions: { label: string; value: PlatformUsersListState["role"] }[] = [
  { label: "Todos los roles", value: "all" },
  ...PLATFORM_USER_ROLE_FILTER_VALUES.map((role) => ({ label: roleLabels[role], value: role })),
];

/** Columnas con enlaces a detalle; `listHref` viaja en `returnTo` para que "Volver" regrese a la lista. */
function buildColumns(listHref: string): DataTableColumn<PlatformUser>[] {
  return [
    {
      header: "Usuario",
      key: "name",
      render: (user) => (
        <div className="min-w-0">
          <Link
            className="font-medium text-foreground hover:text-primary hover:underline"
            href={withReturnTo(`/platform/users/${user.id}`, listHref)}
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
            href={withReturnTo(`/platform/stores/${user.store.id}`, listHref)}
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
}

function PlatformUsersList() {
  // Búsqueda, tienda y rol viven en la URL: recarga, "atrás" y volver del detalle los conservan.
  const list = useUrlListState(platformUsersListSchema);
  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedSearch = useDebouncedValue(list.state.search, URL_LIST_DEBOUNCE_MS);
  const stores = useStoresList({ limit: 100 });
  const users = usePlatformUsersList(toPlatformUsersFilters(list.state, debouncedSearch));
  const items = getPaginatedItems(users.data);
  const { href: listHref } = list;
  const columns = useMemo(() => buildColumns(listHref), [listHref]);
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

  useScrollRestoration(listHref, { ready: !users.isLoading });

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            <Input
              aria-label="Buscar usuarios"
              className="sm:w-56"
              onChange={(event) => list.setField("search", event.target.value)}
              placeholder="Nombre, email o tienda"
              value={list.state.search}
            />
            <SelectField
              aria-label="Filtrar por tienda"
              className="sm:w-48"
              onChange={(event) => list.setState({ store: event.target.value })}
              options={storeOptions}
              value={list.state.store}
            />
            <SelectField
              aria-label="Filtrar por rol"
              className="sm:w-44"
              onChange={(event) =>
                // El schema valida el valor: uno que no conoce anula el cambio.
                list.setState({ role: event.target.value as PlatformUsersListState["role"] })
              }
              options={roleOptions}
              value={list.state.role}
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
            { href: withReturnTo(`/platform/users/${user.id}`, listHref), label: "Ver detalle" },
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

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const PlatformUsersListPage = withUrlListBoundary(PlatformUsersList);
