"use client";

import { useCallback, useMemo, useState } from "react";

import type { StoreUserRole } from "@/shared/auth/permissions";
import type { UserProfileMock } from "@/shared/mocks/erp-data";

/** Cambio de un usuario elegido en la fila y todavía sin guardar. */
export type PendingUserChange = {
  isActive?: boolean;
  role?: StoreUserRole;
};

type PendingByUserId = Record<string, PendingUserChange>;

function withoutEmpty(pending: PendingByUserId, userId: string, change: PendingUserChange) {
  const next = { ...pending };

  if (change.role === undefined && change.isActive === undefined) {
    delete next[userId];
  } else {
    next[userId] = change;
  }

  return next;
}

/**
 * Cambios de rol y de estado pendientes, por id de usuario. Viven fuera de la
 * tabla para que paginar o cambiar de pestaña no los pierda: nada se guarda
 * hasta confirmar. Elegir de nuevo el valor guardado quita el cambio.
 */
export function usePendingUserChanges() {
  const [pending, setPending] = useState<PendingByUserId>({});

  const setRole = useCallback((user: UserProfileMock, role: StoreUserRole) => {
    setPending((current) =>
      withoutEmpty(current, user.id, {
        ...current[user.id],
        role: role === user.role ? undefined : role,
      }),
    );
  }, []);

  const setIsActive = useCallback((user: UserProfileMock, isActive: boolean) => {
    setPending((current) =>
      withoutEmpty(current, user.id, {
        ...current[user.id],
        isActive: isActive === user.isActive ? undefined : isActive,
      }),
    );
  }, []);

  const discard = useCallback((userId: string) => {
    setPending((current) => withoutEmpty(current, userId, {}));
  }, []);

  return useMemo(
    () => ({ discard, pending, setIsActive, setRole }),
    [discard, pending, setIsActive, setRole],
  );
}

export type PendingUserChanges = ReturnType<typeof usePendingUserChanges>;

/**
 * Lo que de verdad cambiaría al guardar: descarta lo que ya coincide con el
 * usuario cargado (p. ej. si otra persona lo cambió mientras tanto).
 */
export function getEffectiveUserChange(
  user: UserProfileMock,
  change: PendingUserChange | undefined,
): PendingUserChange | null {
  const role = change?.role !== undefined && change.role !== user.role ? change.role : undefined;
  const isActive =
    change?.isActive !== undefined && change.isActive !== user.isActive
      ? change.isActive
      : undefined;

  if (role === undefined && isActive === undefined) {
    return null;
  }

  return {
    ...(role !== undefined ? { role } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
  };
}
