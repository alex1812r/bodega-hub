"use client";

import { type ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { useLogout } from "@/modules/auth/hooks/useLogout";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { ClientApiError } from "@/shared/api/apiFetch";
import {
  hasEffectivePermission,
  roleLabels,
  type Permission,
} from "@/shared/auth/permissions";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";

import { AppShell } from "./AppShell";

type AuthenticatedAppShellProps = {
  children: ReactNode;
  currentPath: string;
  requiredPermission?: Permission;
};

export function AuthenticatedAppShell({
  children,
  currentPath,
  requiredPermission,
}: AuthenticatedAppShellProps) {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const logout = useLogout();
  const exchangeRate = useCurrentExchangeRate();
  const refRateVes = exchangeRate.data?.rateVes;
  const refRateError = exchangeRate.isError && refRateVes == null;

  useEffect(() => {
    if (!currentUser.isError) {
      return;
    }

    const error = currentUser.error;

    if (error instanceof ClientApiError && error.status === 401) {
      router.replace("/login");
    }
  }, [currentUser.error, currentUser.isError, router]);

  if (currentUser.isLoading) {
    return (
      <LoadingState
        description="Estamos validando tu sesion y permisos."
        title="Cargando sesion..."
        variant="page"
      />
    );
  }

  if (currentUser.isError) {
    const error = currentUser.error;

    if (error instanceof ClientApiError && error.status === 401) {
      return null;
    }

    const isMissingApiRoute =
      error instanceof ClientApiError &&
      error.status === 404 &&
      error.code === "NOT_FOUND";

    const message =
      error instanceof Error ? error.message : "No se pudo cargar tu sesion.";

    return (
      <ErrorState
        actionLabel={isMissingApiRoute ? "Reiniciar sesion" : undefined}
        description={message}
        onRetry={
          isMissingApiRoute
            ? () => router.replace("/login")
            : () => void currentUser.refetch()
        }
        title={
          isMissingApiRoute
            ? "Servicio de autenticacion no disponible"
            : "No pudimos cargar tu sesion"
        }
      />
    );
  }

  const profile = currentUser.data;

  if (!profile) {
    return null;
  }

  if (!profile.user.isActive) {
    return (
      <ErrorState
        description="Tu usuario esta inactivo. Solicita acceso a un administrador."
        title="Cuenta inactiva"
      />
    );
  }

  const permissionProfile = {
    deniedPermissions: profile.deniedPermissions,
    grantedPermissions: profile.grantedPermissions,
    role: profile.role,
  };

  if (
    requiredPermission &&
    !hasEffectivePermission(permissionProfile, requiredPermission)
  ) {
    return (
      <AppShell
        currentPath={currentPath}
        onSignOut={() => logout.mutate()}
        permissions={profile.permissions}
        refRateError={refRateError}
        refRateVes={refRateVes}
        role={profile.role}
        userName={profile.user.name}
        userRole={roleLabels[profile.role]}
      >
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>No tienes permiso para acceder</CardTitle>
              <CardDescription>
                Tu rol actual no permite entrar a este modulo. Solicita acceso a
                un administrador si lo necesitas para tu trabajo.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      currentPath={currentPath}
      onSignOut={() => logout.mutate()}
      permissions={profile.permissions}
      refRateError={refRateError}
      refRateVes={refRateVes}
      role={profile.role}
      userName={profile.user.name}
      userRole={roleLabels[profile.role]}
    >
      {children}
    </AppShell>
  );
}
