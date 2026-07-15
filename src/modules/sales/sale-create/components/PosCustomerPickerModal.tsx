"use client";

import { UserRound } from "lucide-react";
import { useState } from "react";

import type { ContactMock } from "@/shared/mocks/erp-data";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

type PosCustomerPickerModalProps = {
  customers: ContactMock[];
  onOpenChange: (open: boolean) => void;
  onSelect: (customerId: string) => void;
  open: boolean;
  selectedCustomerId: string;
};

export function PosCustomerPickerModal({
  customers,
  onOpenChange,
  onSelect,
  open,
  selectedCustomerId,
}: PosCustomerPickerModalProps) {
  const [draftId, setDraftId] = useState(selectedCustomerId);

  return (
    <Modal
      description="Selecciona el cliente asociado a esta venta."
      footer={({ close }) => (
        <Button
          disabled={!draftId}
          onClick={() => {
            onSelect(draftId);
            close();
          }}
          type="button"
          variant="primary"
        >
          Confirmar cliente
        </Button>
      )}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (nextOpen) {
          setDraftId(selectedCustomerId);
        }
      }}
      open={open}
      title="Cliente"
    >
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {customers.map((customer) => {
          const isSelected = customer.id === draftId;

          return (
            <li key={customer.id}>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-transparent hover:bg-surface-container-low",
                )}
                onClick={() => setDraftId(customer.id)}
                type="button"
              >
                <UserRound aria-hidden className="size-4 shrink-0" />
                <span className="font-medium">{customer.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
