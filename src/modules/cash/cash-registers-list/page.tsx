"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/shared/api/apiFetch";
import { Button } from "@/shared/components/Button";
import { DataTable } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import { useCashRegisters, useCreateCashRegister, useUpdateCashRegister } from "../hooks/useCash";
import type { CashRegister } from "../types";
type User = { id: string; name: string; role: string };
export function CashRegistersListPage() {
  const [name, setName] = useState(""); const registers = useCashRegisters(); const create = useCreateCashRegister();
  const users = useQuery({ queryKey: ["users", "vendors"], queryFn: () => apiFetch<{ items: User[] }>("/api/users", { query: { limit: 100 } }) });
  const vendors = (users.data?.items ?? []).filter((user) => user.role === "vendedor");
  return <EntityListPage description="Crea, asigna y desactiva las cajas de la tienda." layout="sections" title="Cajas">
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (name.trim()) { create.mutate({ name }); setName(""); } }}><Input aria-label="Nombre de caja" onChange={(event) => setName(event.target.value)} placeholder="Nombre de la caja" value={name} /><Button disabled={create.isPending} type="submit">Crear caja</Button></form>
    <DataTable columns={[{ header: "Caja", key: "name", render: (item) => item.name }, { header: "Asignar vendedor", key: "assignedUserId", render: (item: CashRegister) => <RegisterAssignment register={item} vendors={vendors} /> }, { header: "Estado", key: "isActive", render: (item) => item.isActive ? "Activa" : "Inactiva" }]} data={registers.data ?? []} emptyState={<p className="p-4 text-sm">No hay cajas registradoras.</p>} getRowId={(item) => item.id} isLoading={registers.isLoading} />
  </EntityListPage>;
}
function RegisterAssignment({ register, vendors }: { register: CashRegister; vendors: User[] }) {
  const update = useUpdateCashRegister(register.id);
  return <div className="flex gap-2"><SelectField aria-label={`Asignar ${register.name}`} onChange={(event) => update.mutate({ assignedUserId: event.target.value || null, assignedUserName: vendors.find((user) => user.id === event.target.value)?.name ?? null })} options={[{ label: "Sin asignar", value: "" }, ...vendors.map((user) => ({ label: user.name, value: user.id }))]} value={register.assignedUserId ?? ""} /><Button disabled={update.isPending} onClick={() => update.mutate({ isActive: !register.isActive })} size="sm" type="button" variant="outline">{register.isActive ? "Desactivar" : "Activar"}</Button></div>;
}
