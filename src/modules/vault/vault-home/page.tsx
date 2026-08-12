"use client";

import { Building2, Banknote, CircleDollarSign } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardKpiCard } from "@/modules/dashboard/components/DashboardKpiCard";
import { Can } from "@/shared/auth/Can";
import { ActionsMenu } from "@/shared/components/ActionsMenu";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { useVault, useVaultMovements } from "../hooks/useVault";
import type { VaultMovement } from "../types";

import { VaultDepositModal } from "./components/VaultDepositModal";
import { VaultTransferFromCashModal } from "./components/VaultTransferFromCashModal";
import { VaultWithdrawalModal } from "./components/VaultWithdrawalModal";

const movementTypeLabels: Record<VaultMovement["type"], string> = {
  adjustment: "Ajuste",
  deposit: "Deposito efectivo",
  purchase_out: "Pago compra",
  sale_in: "Ingreso cuenta",
  transfer_in: "Transferencia caja",
  withdrawal: "Retiro efectivo",
};

const bucketLabels: Record<VaultMovement["bucket"], string> = {
  cuenta: "Cuenta",
  efectivo: "Efectivo",
};

type VaultModal = "deposit" | "transfer" | "withdrawal" | null;

export function VaultHomePage() {
  const vault = useVault();
  const movements = useVaultMovements();
  const [activeModal, setActiveModal] = useState<VaultModal>(null);

  const columns = useMemo<DataTableColumn<VaultMovement>[]>(
    () => [
      {
        header: "Tipo",
        key: "type",
        render: (item) => movementTypeLabels[item.type] ?? item.type,
      },
      {
        header: "Cubeta",
        key: "bucket",
        render: (item) => bucketLabels[item.bucket] ?? item.bucket,
      },
      {
        align: "right",
        header: "REF",
        key: "amountRef",
        render: (item) => <strong className="tabular-nums">{formatRefUsd(item.amountRef)}</strong>,
      },
      {
        align: "right",
        header: "Bs.",
        key: "amountVes",
        render: (item) => (
          <span className="tabular-nums text-on-surface-variant">{formatVesBs(item.amountVes)}</span>
        ),
      },
      {
        header: "Nota",
        key: "notes",
        render: (item) => item.notes ?? "—",
      },
      {
        header: "Fecha",
        key: "createdAt",
        render: (item) =>
          item.createdAt ? new Date(item.createdAt).toLocaleString("es-VE") : "—",
        visibility: "md",
      },
    ],
    [],
  );

  const balanceRef = vault.isLoading ? "—" : formatRefUsd(vault.data?.balanceRef ?? 0);
  const balanceEfectivoVes = vault.isLoading
    ? "—"
    : formatVesBs(vault.data?.balanceEfectivoVes ?? 0);
  const balanceCuentaVes = vault.isLoading ? "—" : formatVesBs(vault.data?.balanceVes ?? 0);

  return (
    <>
      <EntityListPage
        actions={
          <Can permission="vault.manage">
            <ActionsMenu
              actions={[
                { label: "Depositar efectivo", onSelect: () => setActiveModal("deposit") },
                { label: "Retirar efectivo", onSelect: () => setActiveModal("withdrawal") },
                {
                  label: "Transferir cierres",
                  onSelect: () => setActiveModal("transfer"),
                },
              ]}
              label="Operaciones del baul"
              variant="secondary"
            />
          </Can>
        }
        description="Centro financiero: efectivo fisico, saldo de cuenta y REF."
        layout="sections"
        title="Baul"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardKpiCard
            accentClassName="bg-amber-500/15"
            icon={Banknote}
            iconClassName="text-amber-600"
            label="Efectivo Bs."
            value={balanceEfectivoVes}
          />
          <DashboardKpiCard
            accentClassName="bg-emerald-500/15"
            icon={Building2}
            iconClassName="text-emerald-600"
            label="Cuenta Bs."
            value={balanceCuentaVes}
          />
          <DashboardKpiCard
            accentClassName="bg-primary/15"
            icon={CircleDollarSign}
            iconClassName="text-primary"
            label="Saldo REF"
            value={balanceRef}
          />
        </div>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Movimientos</h2>
          <DataTable
            columns={columns}
            data={movements.data ?? []}
            emptyState={
              <EmptyState
                className="py-10"
                description="Las operaciones del menu se reflejaran aqui."
                title="Sin movimientos"
              />
            }
            getRowId={(item) => item.id}
            isLoading={movements.isLoading}
          />
        </section>
      </EntityListPage>

      <VaultDepositModal
        onOpenChange={(open) => setActiveModal(open ? "deposit" : null)}
        open={activeModal === "deposit"}
      />
      <VaultWithdrawalModal
        onOpenChange={(open) => setActiveModal(open ? "withdrawal" : null)}
        open={activeModal === "withdrawal"}
      />
      <VaultTransferFromCashModal
        onOpenChange={(open) => setActiveModal(open ? "transfer" : null)}
        open={activeModal === "transfer"}
      />
    </>
  );
}
