"use client";
import { useState } from "react";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { DataTable } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { useOpenCashSessions } from "@/modules/cash/hooks/useCash";
import { useTransferFromCash, useVault, useVaultDeposit, useVaultMovements, useVaultWithdrawal } from "../hooks/useVault";
function VaultForm({ label, onSubmit }: { label: string; onSubmit: (input: { amountRef: number; amountVes: number; notes?: string }) => void }) {
  const [ves, setVes] = useState(""); const [ref, setRef] = useState(""); const [notes, setNotes] = useState("");
  return <form className="grid gap-2 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); onSubmit({ amountRef: Number(ref || 0), amountVes: Number(ves || 0), notes }); setRef(""); setVes(""); setNotes(""); }}><Input label="Bs." min="0" onChange={(event) => setVes(event.target.value)} type="number" value={ves}/><Input label="REF" min="0" onChange={(event) => setRef(event.target.value)} type="number" value={ref}/><Input label="Nota" onChange={(event) => setNotes(event.target.value)} value={notes}/><Button type="submit">{label}</Button></form>;
}
export function VaultHomePage() {
  const vault = useVault(); const movements = useVaultMovements(); const deposit = useVaultDeposit(); const withdrawal = useVaultWithdrawal(); const transfer = useTransferFromCash();
  const sessions = useOpenCashSessions(); const [sessionId, setSessionId] = useState("");
  return <EntityListPage description="Controla el efectivo central de la tienda." layout="sections" title="Baúl">
    <Card><CardHeader><CardTitle>Saldo disponible</CardTitle></CardHeader><CardContent className="flex gap-8"><div><strong className="text-xl">{formatRefUsd(vault.data?.balanceRef ?? 0)}</strong><p>{formatVesBs(vault.data?.balanceVes ?? 0)}</p></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Movimientos manuales</CardTitle></CardHeader><CardContent className="space-y-4"><VaultForm label="Depositar" onSubmit={(input) => deposit.mutate(input)} /><VaultForm label="Retirar" onSubmit={(input) => withdrawal.mutate(input)} /></CardContent></Card>
    <Card><CardHeader><CardTitle>Transferir desde caja abierta</CardTitle></CardHeader><CardContent><SelectField label="Sesión de caja" onChange={(event) => setSessionId(event.target.value)} options={sessions.data?.map((session) => ({ label: `${session.register.name} — ${session.openedAt}`, value: session.id })) ?? []} placeholder="Selecciona una sesión" value={sessionId} /><VaultForm label="Transferir al baúl" onSubmit={(input) => { if (sessionId) transfer.mutate({ ...input, sessionId }); }} /></CardContent></Card>
    <DataTable columns={[{ header: "Tipo", key: "type", render: (item) => item.type }, { align: "right", header: "REF", key: "amountRef", render: (item) => <strong>{formatRefUsd(item.amountRef)}</strong> }, { align: "right", header: "Bs.", key: "amountVes", render: (item) => formatVesBs(item.amountVes) }, { header: "Nota", key: "notes", render: (item) => item.notes ?? "—" }]} data={movements.data ?? []} emptyState={<p className="p-4 text-sm">No hay movimientos.</p>} getRowId={(item) => item.id} isLoading={movements.isLoading} />
  </EntityListPage>;
}
