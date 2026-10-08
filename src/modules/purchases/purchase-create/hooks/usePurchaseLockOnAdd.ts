"use client";

import { useCallback, useSyncExternalStore } from "react";

import { usePermission } from "@/shared/auth/usePermission";

const KEY_PREFIX = "bodegahub:compras:bloquear-al-agregar:v1";
const STORED_ON = "1";
const STORED_OFF = "0";
/** Por defecto, agregar una línea bloquea las anteriores. */
const DEFAULT_LOCK_ON_ADD = true;

type LockOnAddSession = { storeId: string | null; userId: string };

const listeners = new Set<() => void>();
// Respaldo en memoria, solo para cuando el navegador no deja usar `localStorage`:
// la preferencia sigue funcionando lo que dure la pestaña.
const memory = new Map<string, boolean>();

/** Clave por tienda y usuario: la preferencia de uno no la hereda otro en el mismo navegador. */
export function purchaseLockOnAddStorageKey(session: LockOnAddSession) {
  return [
    KEY_PREFIX,
    encodeURIComponent(session.storeId ?? ""),
    encodeURIComponent(session.userId),
  ].join(":");
}

function readLockOnAdd(key: string) {
  try {
    const stored = window.localStorage.getItem(key);

    if (stored === STORED_ON || stored === STORED_OFF) {
      return stored === STORED_ON;
    }
  } catch {
    // `localStorage` bloqueado: vale lo que haya en memoria.
  }

  return memory.get(key) ?? DEFAULT_LOCK_ON_ADD;
}

function writeLockOnAdd(key: string, lockOnAdd: boolean) {
  try {
    window.localStorage.setItem(key, lockOnAdd ? STORED_ON : STORED_OFF);
    memory.delete(key);
  } catch {
    memory.set(key, lockOnAdd);
  }

  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Preferencia "Bloquear al agregar" de la compra (COM-12): si está activa, al
 * agregar una línea las anteriores se bloquean. Activa por defecto y recordada
 * por tienda y usuario en `localStorage`.
 */
export function usePurchaseLockOnAdd(): [boolean, (lockOnAdd: boolean) => void] {
  const { profile } = usePermission();
  const userId = profile?.user?.id;
  const key = purchaseLockOnAddStorageKey({
    storeId: profile?.storeId ?? null,
    // Sin usuario cargado se usa una clave propia: no pisa la de nadie.
    userId: userId ?? "",
  });
  const lockOnAdd = useSyncExternalStore(
    subscribe,
    () => readLockOnAdd(key),
    () => DEFAULT_LOCK_ON_ADD,
  );
  const setLockOnAdd = useCallback((next: boolean) => writeLockOnAdd(key, next), [key]);

  return [lockOnAdd, setLockOnAdd];
}
