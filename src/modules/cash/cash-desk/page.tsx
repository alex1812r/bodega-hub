"use client";
import { useState } from "react";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { DataTable } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { Input } from "@/shared/components/Input";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { useCashMovements, useCashRegisters, useCloseCashSession, useMyCashSession, useOpenCashSession } from "../hooks/useCash";

const number = (value: string) => Number(value || 0);
export function CashDeskPage() {
  const registers = useCashRegisters(); const session = useMyCashSession(); const movements = useCashMovements(session.data?.id);
  const open = useOpenCashSession(); const close = useCloseCashSession();
  const [openingVes, setOpeningVes] = useState(""); const [openingRef, setOpeningRef] = useState(""); const [closingVes, setClosingVes] = useState(""); const [closingRef, setClosingRef] = useState("");
  const register = session.data?.register ?? registers.data?.find((item) => item.isActive && item.assignedUserId);
  const theoretical = movements.data?.theoretical;
  return <EntityListPage description="Abre, opera y cierra la caja asignada." layout="sections" title="Mi caja">
    <Card><CardHeader><CardTitle>{register ? `Caja: ${register.name}` : "No tienes una caja asignada"}</CardTitle></CardHeader><CardContent>
      {!session.data ? <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); if (register) open.mutate({ openingRef: number(openingRef), openingVes: number(openingVes), registerId: register.id }); }}>
        <Input label="Apertura Bs." min="0" onChange={(event) => setOpeningVes(event.target.value)} type="number" value={openingVes} />
        <Input label="Apertura REF" min="0" onChange={(event) => setOpeningRef(event.target.value)} type="number" value={openingRef} />
        <Button disabled={!register || open.isPending} type="submit">Abrir caja</Button>
      </form> : <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); close.mutate({ closingRef: number(closingRef), closingVes: number(closingVes), sessionId: session.data!.id }); }}>
        <div><p className="font-semibold tabular-nums">{formatRefUsd(theoretical?.ref ?? session.data.openingRef)}</p><p className="text-sm text-on-surface-variant">{formatVesBs(theoretical?.ves ?? session.data.openingVes)} teórico</p></div>
        <Input label="Cierre Bs." min="0" onChange={(event) => setClosingVes(event.target.value)} type="number" value={closingVes} />
        <Input label="Cierre REF" min="0" onChange={(event) => setClosingRef(event.target.value)} type="number" value={closingRef} />
        <Button disabled={close.isPending} type="submit">Cerrar caja</Button>
      </form>}
    </CardContent></Card>
    <DataTable columns={[{ header: "Tipo", key: "type", render: (item) => item.type }, { align: "right", header: "REF", key: "amountRef", render: (item) => <strong>{formatRefUsd(item.amountRef)}</strong> }, { align: "right", header: "Bs.", key: "amountVes", render: (item) => formatVesBs(item.amountVes) }, { header: "Nota", key: "notes", render: (item) => item.notes ?? "—" }]} data={movements.data?.items ?? []} emptyState={<p className="p-4 text-sm">No hay movimientos.</p>} getRowId={(item) => item.id} isLoading={movements.isLoading} />
  </EntityListPage>;
}
