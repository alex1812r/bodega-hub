"use client";

import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { useToast } from "@/shared/components/Toast";
import { roleLabels } from "@/shared/auth/permissions";
import type { UserProfileMock } from "@/shared/mocks/erp-data";

import { useAdminCanSell, useUpdateUser } from "../../hooks/useSettings";
import type { PendingUserChange } from "../usePendingUserChanges";
import {
  computeRoleChangeEffect,
  type PermissionAreaGroup,
} from "../utils/rolePermissionDiff";

type UserChangeConfirmModalProps = {
  /**
   * Con la lista de usuarios completa a la vista, este cambio dejaría la tienda sin
   * ningún administrador activo: el diálogo se bloquea con el motivo. Es un atajo:
   * quien decide es el servidor (409), también cuando aquí no se pudo saber.
   */
  blocksLastActiveAdmin?: boolean;
  /** Cambio ya depurado: solo lo que difiere del usuario cargado. */
  change: PendingUserChange;
  /** El usuario afectado es quien tiene la sesión abierta. */
  isOwnAccount?: boolean;
  onClose: () => void;
  /** El servidor guardó el cambio: la fila deja de tener cambios pendientes. */
  onSaved: () => void;
  user: UserProfileMock;
};

const sectionTitleClassName = "text-sm font-semibold text-foreground";

function PermissionGroups({
  groups,
  title,
}: {
  groups: PermissionAreaGroup[];
  title: string;
}) {
  return (
    <div className="space-y-1">
      <p className={sectionTitleClassName}>{title}</p>
      <ul aria-label={title} className="space-y-1 text-sm text-on-surface-variant">
        {groups.map((group) => (
          <li className="[overflow-wrap:anywhere]" key={group.area}>
            <span className="font-medium text-foreground">{group.areaLabel}:</span>{" "}
            {group.labels.join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function getConfirmLabel(change: PendingUserChange) {
  if (change.isActive === false) {
    return "Desactivar usuario";
  }

  if (change.role !== undefined && change.isActive === true) {
    return "Guardar cambios";
  }

  return change.role !== undefined ? "Cambiar rol" : "Reactivar usuario";
}

function getOwnAccountNotice(isDeactivating: boolean, losesAdministration: boolean) {
  if (isDeactivating) {
    return "Es tu propia cuenta: se cerrará tu acceso y no podrás volver a entrar hasta que otro administrador te reactive.";
  }

  if (losesAdministration) {
    return "Es tu propia cuenta: perderás la administración de la tienda en cuanto guardes y no podrás deshacerlo tú; tendrá que devolvértela otro administrador.";
  }

  return "Es tu propia cuenta: tus permisos cambian en cuanto guardes.";
}

/**
 * Confirmación de un cambio de rol y/o de estado de un usuario de la tienda
 * (CNF-11). Muestra los permisos efectivos que gana y pierde y lo que supone
 * desactivarlo o reactivarlo; no decide nada que le toque al servidor: si este
 * rechaza el cambio, su mensaje se muestra aquí tal cual.
 *
 * CAOS-03: si el cambio es sobre la propia cuenta lo dice, en peligro; y si se ve
 * que dejaría la tienda sin administrador activo, no deja confirmar.
 */
export function UserChangeConfirmModal({
  blocksLastActiveAdmin = false,
  change,
  isOwnAccount = false,
  onClose,
  onSaved,
  user,
}: UserChangeConfirmModalProps) {
  const { showToast } = useToast();
  const updateUser = useUpdateUser(user.id);
  const nextRole = change.role;
  // Solo con cambio de rol: quien pasa a administrador hereda «El administrador puede vender».
  const adminCanSell = useAdminCanSell(nextRole !== undefined);
  const otherAdmins = (adminCanSell.data?.admins ?? []).filter((admin) => admin.id !== user.id);
  const otherAdminsCanSell =
    otherAdmins.length > 0 && otherAdmins.every((admin) => admin.canSell);
  const roleEffect = nextRole
    ? computeRoleChangeEffect(user, nextRole, otherAdminsCanSell)
    : null;
  const isDeactivating = change.isActive === false;
  const isReactivating = change.isActive === true;
  const staysInactive = !user.isActive && !isReactivating;
  const finalRole = nextRole ?? user.role;

  async function handleConfirm() {
    try {
      await updateUser.mutateAsync(change);
    } catch {
      // El motivo queda en `updateUser.error` y se muestra en el diálogo.
      return;
    }

    showToast({ title: `Cambios guardados: ${user.name}`, tone: "success" });
    onSaved();
  }

  return (
    <ConfirmActionModal
      confirmLabel={getConfirmLabel(change)}
      description={`${user.name} · ${user.email}`}
      error={updateUser.error?.message}
      isPending={updateUser.isPending}
      onConfirm={handleConfirm}
      status={blocksLastActiveAdmin ? "blocked" : "ready"}
      statusHint="No se ha cambiado nada."
      statusMessage={`${user.name} es el único administrador activo de la tienda: nombra o reactiva a otro administrador antes de quitarle el rol o desactivarlo.`}
      onOpenChange={(open) => {
        if (!open) {
          updateUser.reset();
          onClose();
        }
      }}
      open
      renderEffects={() => (
        <div className="space-y-4 py-2">
          {nextRole && roleEffect ? (
            <div className="space-y-3">
              <p className={sectionTitleClassName}>
                Rol: {roleLabels[user.role]} → {roleLabels[nextRole]}
              </p>
              {roleEffect.gainedCount > 0 ? (
                <PermissionGroups
                  groups={roleEffect.gained}
                  title={`Gana acceso a (${roleEffect.gainedCount})`}
                />
              ) : null}
              {roleEffect.lostCount > 0 ? (
                <PermissionGroups
                  groups={roleEffect.lost}
                  title={`Pierde acceso a (${roleEffect.lostCount})`}
                />
              ) : null}
              {roleEffect.gainedCount === 0 && roleEffect.lostCount === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  Sus permisos efectivos no cambian con este rol.
                </p>
              ) : null}
              {roleEffect.losesAdministration ? (
                <p className="text-sm font-medium text-destructive">
                  Deja de administrar la tienda: no podrá gestionar usuarios ni guardar la
                  configuración.
                </p>
              ) : null}
              {staysInactive ? (
                <p className="text-sm text-on-surface-variant">
                  El usuario está inactivo: estos permisos aplicarán cuando se reactive.
                </p>
              ) : null}
            </div>
          ) : null}

          {isDeactivating ? (
            <div className="space-y-1">
              <p className={sectionTitleClassName}>Estado: Activo → Inactivo</p>
              <ul
                aria-label="Al desactivarlo"
                className="list-disc space-y-1 pl-5 text-sm text-on-surface-variant"
              >
                <li>No podrá iniciar sesión.</li>
                <li>
                  Si tiene una sesión abierta, deja de funcionar: el sistema rechazará su
                  siguiente acción.
                </li>
                <li>
                  Conserva su rol ({roleLabels[finalRole]}) y todo lo que registró; se puede
                  reactivar después.
                </li>
              </ul>
            </div>
          ) : null}

          {isReactivating ? (
            <div className="space-y-1">
              <p className={sectionTitleClassName}>Estado: Inactivo → Activo</p>
              <ul
                aria-label="Al reactivarlo"
                className="list-disc space-y-1 pl-5 text-sm text-on-surface-variant"
              >
                <li>Podrá volver a iniciar sesión en esta tienda.</li>
                <li>Recupera los permisos de su rol: {roleLabels[finalRole]}.</li>
              </ul>
            </div>
          ) : null}
        </div>
      )}
      title={`¿Guardar los cambios de ${user.name}?`}
      variant={
        isOwnAccount || isDeactivating || roleEffect?.losesAdministration ? "danger" : "default"
      }
    >
      {isOwnAccount ? (
        <p className="font-medium text-destructive">
          {getOwnAccountNotice(isDeactivating, roleEffect?.losesAdministration ?? false)}
        </p>
      ) : null}
    </ConfirmActionModal>
  );
}
