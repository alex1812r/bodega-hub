"use client";

import { type ReactNode, useState } from "react";

import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { CashSessionCountdown } from "@/modules/cash/components/CashSessionCountdown";
import { CashSessionExpiredPanel } from "@/modules/cash/components/CashSessionExpiredPanel";
import { OpenCashSessionModal } from "@/modules/cash/components/OpenCashSessionModal";
import {
  useCashMovements,
  useCashRegisters,
  useMyCashSession,
} from "@/modules/cash/hooks/useCash";
import { useCashSessionClock } from "@/modules/cash/hooks/useCashSessionClock";
import { Button } from "@/shared/components/Button";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { PageBackButton } from "@/shared/components/PageBackButton";

type PosCashSessionGateProps = {
  children: ReactNode;
};

export function PosCashSessionGate({ children }: PosCashSessionGateProps) {
  const session = useMyCashSession();
  const registers = useCashRegisters();
  const currentUser = useCurrentUser();
  const [openModal, setOpenModal] = useState(false);
  const movements = useCashMovements(session.data?.id);
  const clock = useCashSessionClock(session.data?.openedAt);

  const userId = currentUser.data?.user.id;
  const register =
    session.data?.register ??
    registers.data?.find(
      (item) => item.isActive && item.assignedUserId != null && item.assignedUserId === userId,
    );

  if (session.isLoading || currentUser.isLoading) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <PosGateHeader />
        <div className="flex flex-1 items-center justify-center p-6">
          <LoadingState description="Verificando si tu caja esta abierta." title="Cargando caja..." />
        </div>
      </div>
    );
  }

  if (session.error) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <PosGateHeader />
        <div className="flex flex-1 items-center justify-center p-6">
          <ErrorState
            description={
              session.error instanceof Error
                ? session.error.message
                : "No pudimos verificar el estado de la caja."
            }
            onRetry={() => void session.refetch()}
            title="No pudimos verificar la caja"
          />
        </div>
      </div>
    );
  }

  if (session.data && clock.expired) {
    const registerName = session.data.register.name;
    const theoreticalRef = movements.data?.theoretical.ref ?? session.data.openingRef;
    const theoreticalVes = movements.data?.theoretical.ves ?? session.data.openingVes;

    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <PosGateHeader />
        <div className="flex flex-1 items-center justify-center p-6">
          <CashSessionExpiredPanel
            registerName={registerName}
            sessionId={session.data.id}
            theoreticalRef={theoreticalRef}
            theoreticalVes={theoreticalVes}
          />
        </div>
      </div>
    );
  }

  if (session.data) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-surface-container-lowest px-4 py-2">
          <CashSessionCountdown openedAt={session.data.openedAt} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    );
  }

  if (registers.isLoading) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <PosGateHeader />
        <div className="flex flex-1 items-center justify-center p-6">
          <LoadingState description="Buscando tu caja asignada." title="Cargando caja..." />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <PosGateHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          {!register ? (
            <>
              <h2 className="text-lg font-semibold text-foreground">Sin caja asignada</h2>
              <p className="max-w-md text-sm text-on-surface-variant">
                Un administrador debe asignarte una caja activa antes de usar el punto de venta.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground">Caja cerrada</h2>
              <p className="max-w-md text-sm text-on-surface-variant">
                Abre la caja <strong>{register.name}</strong> para cargar el catalogo y registrar
                ventas.
              </p>
              <Button onClick={() => setOpenModal(true)} size="lg" type="button">
                Abrir caja
              </Button>
            </>
          )}
        </div>
      </div>

      {register ? (
        <OpenCashSessionModal
          onOpenChange={setOpenModal}
          open={openModal}
          registerId={register.id}
          registerName={register.name}
        />
      ) : null}
    </>
  );
}

function PosGateHeader() {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-container-lowest px-4 py-3 dark:border-slate-800">
      <div>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">
          Punto de venta
        </p>
        <h1 className="text-xl font-semibold text-foreground">Realizar venta</h1>
      </div>
      <PageBackButton href="/sales" label="Volver a ventas" size="sm" />
    </header>
  );
}
