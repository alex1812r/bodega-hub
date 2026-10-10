"use client";

import { useState } from "react";

import { CloseCashSessionModal } from "@/modules/cash/components/CloseCashSessionModal";
import {
  useCashMovements,
  useMyCashSession,
  useOpenCashSessions,
} from "@/modules/cash/hooks/useCash";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";

import {
  type AdminCanSellState,
  useAdminCanSell,
  useSetAdminCanSell,
} from "../../hooks/useSettings";

export const ADMIN_CAN_SELL_LABEL = "El administrador puede vender";

const noticeClassName =
  "space-y-2 rounded-md border border-outline-variant bg-surface-container-low p-3 text-sm text-foreground";

function yesNo(value: boolean) {
  return value ? "Sí" : "No";
}

/** Lo que hay hoy: «Sí», «No» o «Solo algunos» si los administradores no coinciden. */
function currentLabel(state: AdminCanSellState) {
  if (state.enabled) {
    return "Sí";
  }

  return state.admins.some((admin) => admin.canSell) ? "Solo algunos" : "No";
}

/**
 * Al desactivar: administradores con una caja abierta a su nombre. Solo avisa;
 * el turno se podrá cerrar igual (caos 7.8).
 */
function OpenSessionsNotice({ state }: { state: AdminCanSellState }) {
  const openSessions = useOpenCashSessions();
  const adminNames = new Map(state.admins.map((admin) => [admin.id, admin.name]));
  const affected = (openSessions.data ?? []).filter((session) =>
    adminNames.has(session.register.assignedUserId ?? ""),
  );

  if (affected.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1" role="status">
      <p className="font-medium text-foreground">Hay cajas abiertas a nombre de un administrador:</p>
      <ul aria-label="Cajas abiertas de administradores" className="list-disc space-y-1 pl-5">
        {affected.map((session) => (
          <li className="[overflow-wrap:anywhere]" key={session.id}>
            {adminNames.get(session.register.assignedUserId ?? "")} · {session.register.name}
          </li>
        ))}
      </ul>
      <p>
        Podrán cerrar ese turno desde Configuración, pero no vender ni abrir uno nuevo.
      </p>
    </div>
  );
}

type AdminCanSellConfirmModalProps = {
  onClose: () => void;
  state: AdminCanSellState;
  /** Valor que se va a guardar. */
  target: boolean;
};

function AdminCanSellConfirmModal({ onClose, state, target }: AdminCanSellConfirmModalProps) {
  const { showToast } = useToast();
  const setAdminCanSell = useSetAdminCanSell();
  const before = currentLabel(state);
  const tone = target ? "positive" : "warning";
  const effects: ConfirmActionEffect[] = [
    { after: yesNo(target), before, label: "Vender en el POS", tone },
    { after: yesNo(target), before, label: "Operar caja", tone },
  ];

  async function handleConfirm() {
    try {
      await setAdminCanSell.mutateAsync(target);
    } catch {
      // El motivo queda en `setAdminCanSell.error` y se muestra en el diálogo.
      return;
    }

    showToast({
      title: target
        ? "Los administradores ya pueden vender y operar caja"
        : "Los administradores ya no pueden vender ni operar caja",
      tone: "success",
    });
    onClose();
  }

  return (
    <ConfirmActionModal
      confirmLabel={target ? "Permitir vender" : "Quitar la venta"}
      description={
        target
          ? "Los administradores de esta tienda verán «Ventas → POS» y «Mi caja», y podrán abrir caja y vender. Para abrir caja necesitan una caja asignada."
          : "Los administradores de esta tienda dejarán de vender en el POS y de abrir caja. Siguen viendo las ventas y administrando cajas y baúl."
      }
      effects={effects}
      error={setAdminCanSell.error?.message}
      isPending={setAdminCanSell.isPending}
      onConfirm={handleConfirm}
      onOpenChange={(open) => {
        if (!open) {
          setAdminCanSell.reset();
          onClose();
        }
      }}
      open
      title={target ? "¿Permitir que el administrador venda?" : "¿Quitar la venta al administrador?"}
      variant={target ? "default" : "danger"}
    >
      <div className="space-y-3 text-sm text-on-surface-variant">
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Afecta a {state.admins.length === 1 ? "1 administrador" : `${state.admins.length} administradores`}:
          </p>
          <ul aria-label="Administradores afectados" className="list-disc space-y-1 pl-5">
            {state.admins.map((admin) => (
              <li className="[overflow-wrap:anywhere]" key={admin.id}>
                {admin.name}
              </li>
            ))}
          </ul>
        </div>
        {target ? null : <OpenSessionsNotice state={state} />}
      </div>
    </ConfirmActionModal>
  );
}

/**
 * Caos 7.8: quien se quedó sin `cash.operate` con un turno abierto ya no ve «Mi
 * caja». Aquí se le avisa y puede cerrarlo (el cierre de la sesión propia sigue
 * permitido con `cash.manage`); vender o abrir otro turno, no.
 */
function OwnOpenCashSessionNotice() {
  const session = useMyCashSession();
  const movements = useCashMovements(session.data?.id);
  const [closing, setClosing] = useState(false);
  const open = session.data;

  if (!open) {
    return null;
  }

  return (
    <>
      <div className={noticeClassName} role="status">
        <p className="[overflow-wrap:anywhere]">
          Tienes abierta la caja <strong>{open.register.name}</strong> y ya no puedes operar caja.
          Ciérrala para entregar el efectivo; no podrás vender ni abrir otro turno.
        </p>
        <Button onClick={() => setClosing(true)} size="sm" type="button" variant="outline">
          Cerrar mi caja
        </Button>
      </div>
      <CloseCashSessionModal
        accountVes={movements.data?.accountVes ?? 0}
        onOpenChange={setClosing}
        open={closing}
        openingRef={open.openingRef}
        openingVes={open.openingVes}
        registerName={open.register.name}
        sessionId={open.id}
        theoreticalRef={movements.data?.theoretical.ref ?? open.openingRef}
        theoreticalVes={movements.data?.theoretical.ves ?? open.openingVes}
      />
    </>
  );
}

/**
 * Configuración → «El administrador puede vender» (POS-02). El interruptor no
 * guarda al pulsarlo: abre la confirmación con el antes → después y los
 * administradores afectados. Solo lo ve quien administra la tienda
 * (`users.manage`); el servidor lo vuelve a exigir.
 */
export function AdminCanSellCard() {
  const { can } = usePermission();
  const adminCanSell = useAdminCanSell();
  const [target, setTarget] = useState<boolean | null>(null);
  const state = adminCanSell.data;
  const isPartial = state != null && !state.enabled && state.admins.some((admin) => admin.canSell);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ventas del administrador</CardTitle>
        <CardDescription>
          Para bodegas donde el dueño también atiende la caja. Por defecto el administrador no
          vende ni opera caja.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {adminCanSell.isLoading ? (
          <p className="text-sm text-on-surface-variant">Cargando…</p>
        ) : adminCanSell.isError || !state ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive [overflow-wrap:anywhere]">
              {adminCanSell.error?.message ?? "No pudimos cargar este ajuste."}
            </p>
            <Button
              onClick={() => void adminCanSell.refetch()}
              size="sm"
              type="button"
              variant="secondary"
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <>
            <button
              aria-checked={state.enabled}
              className={cn(
                "inline-flex min-h-11 max-w-full cursor-pointer items-center gap-3 rounded-md text-left text-sm font-medium text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              onClick={() => setTarget(!state.enabled)}
              role="switch"
              type="button"
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors",
                  state.enabled
                    ? "border-primary bg-primary"
                    : "border-border bg-surface-container-low",
                )}
              >
                <span
                  className={cn(
                    "size-4.5 rounded-full transition-transform",
                    state.enabled
                      ? "translate-x-5 bg-primary-foreground"
                      : "bg-on-surface-variant",
                  )}
                />
              </span>
              {ADMIN_CAN_SELL_LABEL}
            </button>
            <p className="text-sm text-on-surface-variant">
              {state.enabled
                ? "Activado: los administradores ven «Ventas → POS» y «Mi caja», y pueden abrir caja y vender."
                : isPartial
                  ? "Solo algunos administradores pueden vender. Actívalo para igualarlos o confírmalo apagado para quitárselo a todos."
                  : "Desactivado: los administradores no venden en el POS ni operan caja."}
            </p>
            {isPartial ? (
              <Button onClick={() => setTarget(false)} size="sm" type="button" variant="secondary">
                Quitar la venta a todos
              </Button>
            ) : null}
          </>
        )}
        {can("cash.view") && !can("cash.operate") ? <OwnOpenCashSessionNotice /> : null}
      </CardContent>

      {target !== null && state ? (
        <AdminCanSellConfirmModal onClose={() => setTarget(null)} state={state} target={target} />
      ) : null}
    </Card>
  );
}
