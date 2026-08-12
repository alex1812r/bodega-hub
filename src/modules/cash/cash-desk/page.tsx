"use client";

import { useState } from "react";

import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { CloseCashSessionModal } from "@/modules/cash/components/CloseCashSessionModal";
import { OpenCashSessionModal } from "@/modules/cash/components/OpenCashSessionModal";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { DataTable } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import {
  useCashMovements,
  useCashRegisters,
  useMyCashSession,
} from "../hooks/useCash";
import type { CashMovement } from "../types";

const movementTypeLabels: Record<CashMovement["type"], string> = {
  account_in: "Cuenta (ingreso)",
  account_out: "Cuenta (egreso)",
  adjustment: "Ajuste",
  opening: "Apertura",
  refund_out: "Devolucion",
  sale_in: "Efectivo venta",
  transfer_out: "Transferencia baul",
};

export function CashDeskPage() {
  const registers = useCashRegisters();
  const session = useMyCashSession();
  const currentUser = useCurrentUser();
  const movements = useCashMovements(session.data?.id);
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);

  const userId = currentUser.data?.user.id;
  const register =
    session.data?.register ??
    registers.data?.find(
      (item) => item.isActive && item.assignedUserId != null && item.assignedUserId === userId,
    );
  const theoretical = movements.data?.theoretical;
  const accountVes = movements.data?.accountVes ?? 0;
  const hasOpenSession = Boolean(session.data);
  const theoreticalRef = theoretical?.ref ?? session.data?.openingRef ?? 0;
  const theoreticalVes = theoretical?.ves ?? session.data?.openingVes ?? 0;

  return (
    <>
      <EntityListPage
        actions={
          register && !hasOpenSession ? (
            <Button onClick={() => setOpenModal(true)} type="button">
              Abrir caja
            </Button>
          ) : register && hasOpenSession ? (
            <Button onClick={() => setCloseModal(true)} type="button" variant="outline">
              Cerrar caja
            </Button>
          ) : undefined
        }
        description="Abre, opera y cierra la caja asignada. Efectivo y cobros en cuenta se registran por separado."
        layout="sections"
        title="Mi caja"
      >
        <Card>
          <CardHeader>
            <CardTitle>
              {register ? `Caja: ${register.name}` : "No tienes una caja asignada"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!register ? (
              <p className="text-sm text-on-surface-variant">
                Un administrador debe asignarte una caja activa para poder operar.
              </p>
            ) : !hasOpenSession ? (
              <p className="text-sm text-on-surface-variant">
                La caja esta cerrada. Usa el boton <strong>Abrir caja</strong> para iniciar una
                sesion e indicar el fondo inicial.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
                    Efectivo teorico
                  </p>
                  <p className="font-semibold tabular-nums">
                    {formatRefUsd(theoreticalRef)}
                  </p>
                  <p className="text-sm text-on-surface-variant tabular-nums">
                    {formatVesBs(theoreticalVes)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
                    Cuenta Bs. (turno)
                  </p>
                  <p className="font-semibold tabular-nums text-emerald-700">
                    {formatVesBs(accountVes)}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    Pago movil, transferencia y punto
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <DataTable
          columns={[
            {
              header: "Tipo",
              key: "type",
              render: (item) => movementTypeLabels[item.type] ?? item.type,
            },
            {
              align: "right",
              header: "REF",
              key: "amountRef",
              render: (item) => <strong>{formatRefUsd(item.amountRef)}</strong>,
            },
            {
              align: "right",
              header: "Bs.",
              key: "amountVes",
              render: (item) => formatVesBs(item.amountVes),
            },
            {
              header: "Nota",
              key: "notes",
              render: (item) => item.notes ?? "—",
            },
          ]}
          data={movements.data?.items ?? []}
          emptyState={<p className="p-4 text-sm">No hay movimientos.</p>}
          getRowId={(item) => item.id}
          isLoading={movements.isLoading}
        />
      </EntityListPage>

      {register ? (
        <OpenCashSessionModal
          onOpenChange={setOpenModal}
          open={openModal}
          registerId={register.id}
          registerName={register.name}
        />
      ) : null}

      {session.data && register ? (
        <CloseCashSessionModal
          accountVes={accountVes}
          onOpenChange={setCloseModal}
          open={closeModal}
          registerName={register.name}
          sessionId={session.data.id}
          theoreticalRef={theoreticalRef}
          theoreticalVes={theoreticalVes}
        />
      ) : null}
    </>
  );
}
