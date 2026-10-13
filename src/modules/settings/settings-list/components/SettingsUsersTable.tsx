"use client";

import { useState } from "react";

import {
  roleLabels,
  storeUserRoles,
  type StoreUserRole,
} from "@/shared/auth/permissions";
import { usePermission } from "@/shared/auth/usePermission";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { SelectField } from "@/shared/components/SelectField";
import type { UserProfileMock } from "@/shared/mocks/erp-data";

import { isActiveAdmin, removesActiveAdmin } from "../../services/lastActiveAdmin";
import {
  getEffectiveUserChange,
  type PendingUserChange,
  type PendingUserChanges,
} from "../usePendingUserChanges";
import { UserChangeConfirmModal } from "./UserChangeConfirmModal";

const storeRoleOptions = storeUserRoles.map((role) => ({
  label: roleLabels[role],
  value: role,
}));

const statusOptions = [
  { label: "Activo", value: "true" },
  { label: "Inactivo", value: "false" },
];

const pendingSelectClassName = "border-secondary ring-1 ring-secondary";

function statusLabel(isActive: boolean) {
  return isActive ? "Activo" : "Inactivo";
}

type SettingsUserRowProps = {
  change: PendingUserChange | null;
  changes: PendingUserChanges;
  onSave: () => void;
  user: UserProfileMock;
};

function SettingsUserRow({ change, changes, onSave, user }: SettingsUserRowProps) {
  const savedRole = storeUserRoles.includes(user.role as StoreUserRole) ? user.role : "vendedor";
  const roleChanged = change?.role !== undefined;
  const statusChanged = change?.isActive !== undefined;

  return (
    <tr className="border-t border-slate-200 align-top dark:border-slate-800">
      <td className="px-3 py-2 text-sm">{user.name}</td>
      <td className="px-3 py-2 text-sm">{user.email}</td>
      <td className="px-3 py-2 text-sm">
        <SelectField
          className={roleChanged ? pendingSelectClassName : undefined}
          helperText={roleChanged ? `Sin guardar. Antes: ${roleLabels[user.role]}` : undefined}
          label="Rol"
          onChange={(event) => changes.setRole(user, event.target.value as StoreUserRole)}
          options={storeRoleOptions}
          value={change?.role ?? savedRole}
        />
      </td>
      <td className="px-3 py-2 text-sm">
        <SelectField
          className={statusChanged ? pendingSelectClassName : undefined}
          helperText={
            statusChanged ? `Sin guardar. Antes: ${statusLabel(user.isActive)}` : undefined
          }
          label="Estado"
          onChange={(event) => changes.setIsActive(user, event.target.value === "true")}
          options={statusOptions}
          value={String(change?.isActive ?? user.isActive)}
        />
      </td>
      <td className="px-3 py-2 text-sm">
        {change ? (
          <div className="flex min-w-36 flex-col items-start gap-2">
            <Badge variant="warning">Sin guardar</Badge>
            <div className="flex flex-wrap gap-2">
              <Button
                aria-label={`Guardar cambios de ${user.name}`}
                onClick={onSave}
                size="sm"
                type="button"
                variant="primary"
              >
                Guardar
              </Button>
              <Button
                aria-label={`Descartar cambios de ${user.name}`}
                onClick={() => changes.discard(user.id)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Descartar
              </Button>
            </div>
          </div>
        ) : (
          <span className="text-on-surface-variant">Sin cambios</span>
        )}
      </td>
    </tr>
  );
}

type SettingsUsersTableProps = {
  changes: PendingUserChanges;
  /**
   * Total de usuarios de la tienda. Solo si `users` los trae todos (una sola página)
   * se puede saber aquí que alguien es el último administrador activo.
   */
  totalUsers?: number;
  users: UserProfileMock[];
};

/**
 * Usuarios de la tienda (CNF-11): elegir otro rol u otro estado solo deja el
 * cambio pendiente en la fila; se guarda con «Guardar», tras confirmar lo que
 * gana y pierde ese usuario. Los cambios pendientes de otras páginas se
 * conservan y se avisan aquí.
 *
 * CAOS-03: la confirmación avisa si el cambio es sobre la propia cuenta y, con todos
 * los usuarios a la vista, se bloquea si dejaría la tienda sin administrador activo.
 */
export function SettingsUsersTable({ changes, totalUsers, users }: SettingsUsersTableProps) {
  const { user: currentUser } = usePermission();
  const [confirming, setConfirming] = useState<UserProfileMock | null>(null);
  const confirmingChange = confirming
    ? getEffectiveUserChange(confirming, changes.pending[confirming.id])
    : null;
  const seesEveryUser = totalUsers !== undefined && totalUsers <= users.length;
  const blocksLastActiveAdmin =
    confirming != null &&
    confirmingChange != null &&
    seesEveryUser &&
    removesActiveAdmin(confirming, confirmingChange) &&
    !users.some((user) => user.id !== confirming.id && isActiveAdmin(user));
  const visibleIds = new Set(users.map((user) => user.id));
  const pendingElsewhere = Object.keys(changes.pending).filter((id) => !visibleIds.has(id)).length;

  return (
    <>
      {pendingElsewhere > 0 ? (
        <p className="text-sm text-on-surface-variant" role="status">
          {pendingElsewhere === 1
            ? "Hay 1 usuario con cambios sin guardar en otra página. Se conservan hasta que los guardes o los descartes."
            : `Hay ${pendingElsewhere} usuarios con cambios sin guardar en otras páginas. Se conservan hasta que los guardes o los descartes.`}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="min-w-full">
          <thead className="bg-slate-50 text-left text-sm dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Correo</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Cambios</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <SettingsUserRow
                change={getEffectiveUserChange(user, changes.pending[user.id])}
                changes={changes}
                key={user.id}
                onSave={() => setConfirming(user)}
                user={user}
              />
            ))}
          </tbody>
        </table>
      </div>

      {confirming && confirmingChange ? (
        <UserChangeConfirmModal
          blocksLastActiveAdmin={blocksLastActiveAdmin}
          change={confirmingChange}
          isOwnAccount={currentUser?.id === confirming.id}
          onClose={() => setConfirming(null)}
          onSaved={() => {
            changes.discard(confirming.id);
            setConfirming(null);
          }}
          user={confirming}
        />
      ) : null}
    </>
  );
}
