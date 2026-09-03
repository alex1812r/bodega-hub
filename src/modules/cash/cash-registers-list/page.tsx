"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Banknote, CircleDollarSign, Landmark } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DashboardKpiCard } from "@/modules/dashboard/components/DashboardKpiCard";
import { apiFetch } from "@/shared/api/apiFetch";
import { ActionsMenu } from "@/shared/components/ActionsMenu";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import {
  useCashRegisters,
  useCreateCashRegister,
  useOpenCashSessions,
  useUntransferredCashClosures,
  useUpdateCashRegister,
} from "../hooks/useCash";
import { useCashSessionClock } from "../hooks/useCashSessionClock";
import type { CashRegister, CashSession } from "../types";

type User = { id: string; name: string; role: string };

function openedAtLabel(openedAt: string) {
  return new Date(openedAt).toLocaleTimeString("es-VE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CashRegistersListPage() {
  const registers = useCashRegisters();
  const openSessions = useOpenCashSessions();
  const [createOpen, setCreateOpen] = useState(false);
  const users = useQuery({
    queryKey: ["users", "vendors"],
    queryFn: () => apiFetch<{ items: User[] }>("/api/users", { query: { limit: 100 } }),
  });
  const vendors = useMemo(
    () => (users.data?.items ?? []).filter((user) => user.role === "vendedor"),
    [users.data],
  );

  const untransferred = useUntransferredCashClosures();
  const sessions = useMemo(() => openSessions.data ?? [], [openSessions.data]);
  const pendingByRegister = useMemo(() => {
    const map = new Map<string, { ref: number; ves: number; count: number }>();
    for (const closure of untransferred.data ?? []) {
      const entry = map.get(closure.registerId) ?? { count: 0, ref: 0, ves: 0 };
      entry.count += 1;
      entry.ref += closure.closingRef ?? 0;
      entry.ves += closure.closingVes ?? 0;
      map.set(closure.registerId, entry);
    }
    return map;
  }, [untransferred.data]);
  const pendingTotals = useMemo(
    () =>
      (untransferred.data ?? []).reduce(
        (accumulator, closure) => {
          accumulator.ref += closure.closingRef ?? 0;
          accumulator.ves += closure.closingVes ?? 0;
          return accumulator;
        },
        { ref: 0, ves: 0 },
      ),
    [untransferred.data],
  );
  const sessionByRegister = useMemo(
    () => new Map(sessions.map((session) => [session.registerId, session])),
    [sessions],
  );

  const totals = useMemo(
    () =>
      sessions.reduce(
        (accumulator, session) => {
          accumulator.accountVes += session.liveTotals?.accountVes ?? 0;
          accumulator.cashRef += session.liveTotals?.cashRef ?? session.openingRef;
          accumulator.cashVes += session.liveTotals?.cashVes ?? session.openingVes;
          return accumulator;
        },
        { accountVes: 0, cashRef: 0, cashVes: 0 },
      ),
    [sessions],
  );

  const isLoadingTotals = openSessions.isLoading;
  const activeCount = (registers.data ?? []).filter((item) => item.isActive).length;

  const columns = useMemo<DataTableColumn<CashRegister>[]>(
    () => [
      {
        header: "Caja",
        hideInCard: true,
        key: "name",
        render: (item) => (
          <div className="min-w-0">
            <Link
              className="font-medium text-primary hover:underline"
              href={`/cash/registers/${item.id}`}
            >
              {item.name}
            </Link>
            <p className="truncate text-xs text-on-surface-variant">
              {item.assignedUserName ?? "Sin vendedor asignado"}
            </p>
          </div>
        ),
      },
      {
        header: "Cierres pendientes",
        key: "pendingClosures",
        render: (item) => {
          const pending = pendingByRegister.get(item.id);
          if (!pending) {
            return <span className="text-sm text-on-surface-variant">Ninguno</span>;
          }
          return (
            <div>
              <Badge variant="warning">
                {pending.count} sin transferir
              </Badge>
              <p className="mt-1 text-xs tabular-nums text-on-surface-variant">
                {formatVesBs(pending.ves)}
                {pending.ref > 0 ? ` · ${formatRefUsd(pending.ref)}` : ""}
              </p>
            </div>
          );
        },
      },
      {
        header: "Turno",
        key: "session",
        render: (item) => <RegisterSessionStatus session={sessionByRegister.get(item.id)} />,
      },
      {
        align: "right",
        header: "Efectivo en caja",
        key: "cash",
        render: (item) => <RegisterCashCell session={sessionByRegister.get(item.id)} />,
      },
      {
        align: "right",
        header: "Cuenta del turno",
        key: "account",
        render: (item) => {
          const session = sessionByRegister.get(item.id);
          if (!session) {
            return <span className="text-sm text-on-surface-variant">—</span>;
          }
          return (
            <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatVesBs(session.liveTotals?.accountVes ?? 0)}
            </span>
          );
        },
        visibility: "lg",
      },
      {
        header: "Vendedor asignado",
        key: "assignedUserId",
        render: (item) => <RegisterAssignment register={item} vendors={vendors} />,
        visibility: "md",
      },
      {
        header: "Estado",
        key: "isActive",
        render: (item) => (
          <Badge variant={item.isActive ? "success" : "default"}>
            {item.isActive ? "Activa" : "Inactiva"}
          </Badge>
        ),
      },
      {
        align: "right",
        header: "Acciones",
        key: "actions",
        render: (item) => <RegisterRowActions register={item} />,
      },
    ],
    [pendingByRegister, sessionByRegister, vendors],
  );

  return (
    <>
      <EntityListPage
        actions={
          <Button onClick={() => setCreateOpen(true)} type="button">
            Nueva caja
          </Button>
        }
        description="Saldos en vivo de los turnos abiertos, asignacion de vendedores y estado de cada caja."
        layout="sections"
        title="Cajas"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardKpiCard
            accentClassName="bg-amber-500/15"
            icon={Banknote}
            iconClassName="text-amber-600"
            label="Efectivo en cajas Bs."
            trend={
              <p className="mt-1 text-xs text-muted-foreground">
                Fondo de apertura + ventas en efectivo, antes del cierre.
              </p>
            }
            value={isLoadingTotals ? "—" : formatVesBs(totals.cashVes)}
          />
          <DashboardKpiCard
            accentClassName="bg-emerald-500/15"
            icon={CircleDollarSign}
            iconClassName="text-emerald-600"
            label="Efectivo en cajas REF"
            trend={
              <p className="mt-1 text-xs text-muted-foreground">
                Divisas fisicas en los cajones abiertos.
              </p>
            }
            value={isLoadingTotals ? "—" : formatRefUsd(totals.cashRef)}
          />
          <DashboardKpiCard
            accentClassName="bg-indigo-500/15"
            icon={Landmark}
            iconClassName="text-indigo-600"
            label="Cobros en cuenta Bs."
            trend={
              <p className="mt-1 text-xs text-muted-foreground">
                Pago movil, transferencia y punto de los turnos abiertos.
              </p>
            }
            value={isLoadingTotals ? "—" : formatVesBs(totals.accountVes)}
          />
        </div>

        {pendingTotals.ves > 0 || pendingTotals.ref > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-300/70 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950/40">
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  Hay efectivo cerrado que todavia no llega al baul.
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  No entra en los saldos de arriba: esos solo cuentan turnos abiertos. Abre el
                  detalle de la caja para ver cada cierre.
                </p>
              </div>
            </div>
            <p className="shrink-0 text-lg font-semibold tabular-nums text-amber-900 dark:text-amber-200">
              {formatVesBs(pendingTotals.ves)}
              {pendingTotals.ref > 0 ? ` · ${formatRefUsd(pendingTotals.ref)}` : ""}
            </p>
          </div>
        ) : null}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 p-4 pb-3">
            <CardTitle className="text-base">Cajas de la tienda</CardTitle>
            <span className="text-xs text-on-surface-variant">
              {sessions.length} abierta{sessions.length === 1 ? "" : "s"} de {activeCount} activa
              {activeCount === 1 ? "" : "s"}
            </span>
          </CardHeader>
          <CardContent className="p-0 sm:px-4 sm:pb-4">
            <DataTable
              cardSubtitle={(item) => item.assignedUserName ?? "Sin vendedor asignado"}
              cardTitle={(item) => item.name}
              columns={columns}
              data={registers.data ?? []}
              embedded
              emptyState={
                <p className="p-6 text-center text-sm text-on-surface-variant">
                  Aun no hay cajas registradas. Crea la primera con <strong>Nueva caja</strong>.
                </p>
              }
              getRowId={(item) => item.id}
              isFetching={registers.isFetching && !registers.isLoading}
              isLoading={registers.isLoading}
            />
          </CardContent>
        </Card>
      </EntityListPage>

      <CreateCashRegisterModal onOpenChange={setCreateOpen} open={createOpen} />
    </>
  );
}

function CreateCashRegisterModal({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const create = useCreateCashRegister();
  const [name, setName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function reset() {
    setName("");
    setErrorMessage(null);
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setErrorMessage("Escribe un nombre para la caja.");
      return;
    }

    try {
      setErrorMessage(null);
      await create.mutateAsync({ name: name.trim() });
      reset();
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo crear la caja.");
    }
  }

  return (
    <Modal
      description="La caja queda activa y sin vendedor asignado."
      footer={({ close }) => (
        <>
          <Button
            disabled={create.isPending}
            onClick={() => {
              reset();
              close();
            }}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button disabled={create.isPending} onClick={() => void handleSubmit()} type="button">
            {create.isPending ? "Creando..." : "Crear caja"}
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          reset();
        }
        onOpenChange(nextOpen);
      }}
      open={open}
      title="Nueva caja"
    >
      <Input
        label="Nombre de la caja"
        onChange={(event) => setName(event.target.value)}
        placeholder="Caja principal"
        value={name}
      />
      {errorMessage ? <p className="mt-2 text-sm text-destructive">{errorMessage}</p> : null}
    </Modal>
  );
}

function RegisterSessionStatus({ session }: { session?: CashSession }) {
  const clock = useCashSessionClock(session?.openedAt);

  if (!session) {
    return <Badge>Cerrada</Badge>;
  }

  return (
    <div className="space-y-1">
      <Badge variant={clock.expired ? "danger" : "info"}>
        {clock.expired ? "Vencida" : "Abierta"}
      </Badge>
      <p className="text-xs text-on-surface-variant">
        Desde {openedAtLabel(session.openedAt)}
        {clock.expired || !clock.remainingLabel ? null : ` · cierra en ${clock.remainingLabel}`}
      </p>
    </div>
  );
}

function RegisterCashCell({ session }: { session?: CashSession }) {
  if (!session) {
    return <span className="text-sm text-on-surface-variant">—</span>;
  }

  return (
    <div>
      <p className="font-semibold tabular-nums text-foreground">
        {formatVesBs(session.liveTotals?.cashVes ?? session.openingVes)}
      </p>
      <p className="text-xs tabular-nums text-on-surface-variant">
        {formatRefUsd(session.liveTotals?.cashRef ?? session.openingRef)}
      </p>
    </div>
  );
}

function RegisterRowActions({ register }: { register: CashRegister }) {
  const update = useUpdateCashRegister(register.id);

  return (
    <ActionsMenu
      actions={[
        { href: `/cash/registers/${register.id}`, label: "Ver detalle" },
        {
          disabled: update.isPending,
          label: register.isActive ? "Desactivar caja" : "Activar caja",
          onSelect: () => update.mutate({ isActive: !register.isActive }),
          variant: register.isActive ? "danger" : "default",
        },
      ]}
      label={`Acciones de ${register.name}`}
    />
  );
}

function RegisterAssignment({ register, vendors }: { register: CashRegister; vendors: User[] }) {
  const update = useUpdateCashRegister(register.id);

  return (
    <SelectField
      aria-label={`Asignar ${register.name}`}
      disabled={update.isPending}
      onChange={(event) =>
        update.mutate({
          assignedUserId: event.target.value || null,
          assignedUserName: vendors.find((user) => user.id === event.target.value)?.name ?? null,
        })
      }
      options={[
        { label: "Sin asignar", value: "" },
        ...vendors.map((user) => ({ label: user.name, value: user.id })),
      ]}
      value={register.assignedUserId ?? ""}
    />
  );
}
