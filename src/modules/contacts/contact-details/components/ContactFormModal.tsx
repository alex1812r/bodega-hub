"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";

import { getFormSaveDescription } from "@/lib/api/dataSourceUi";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import type { ContactMock } from "@/shared/mocks/erp-data";

import type { ContactInput } from "../../hooks/useContacts";

type ContactFormModalProps = {
  contact?: ContactMock;
  errorMessage?: string;
  isSubmitting?: boolean;
  mode?: "create" | "edit";
  onOpenChange?: (open: boolean) => void;
  onSubmit?: (input: ContactInput) => Promise<void> | void;
  open?: boolean;
  trigger?: ReactNode;
};

export function ContactFormModal({
  contact,
  errorMessage,
  isSubmitting = false,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  trigger,
}: ContactFormModalProps) {
  const formId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const isEdit = mode === "edit";

  function handleOpenChange(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const input: ContactInput = {
      address: String(formData.get("address") ?? ""),
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      taxId: String(formData.get("taxId") ?? ""),
      type: String(formData.get("type") ?? "cliente") as ContactInput["type"],
    };

    await onSubmit?.(input);
    handleOpenChange(false);
  }

  return (
    <Modal
      description={getFormSaveDescription()}
      footer={({ close }) => (
        <FormActions
          isSubmitting={isSubmitting}
          onCancel={close}
          submitFormId={formId}
          submitLabel={isEdit ? "Guardar cambios" : "Crear contacto"}
        />
      )}
      onOpenChange={handleOpenChange}
      open={isOpen}
      title={isEdit ? "Editar contacto" : "Crear contacto"}
      trigger={
        trigger ?? (
          <Button size="sm" variant={isEdit ? "outline" : "primary"}>
            {isEdit ? "Editar contacto" : "Nuevo contacto"}
          </Button>
        )
      }
    >
      <form
        className="grid gap-4"
        id={formId}
        key={contact?.id ?? "new"}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <Input defaultValue={contact?.name} label="Nombre" name="name" required />
        <SelectField
          defaultValue={contact?.type ?? ""}
          label="Tipo"
          name="type"
          options={[
            { label: "Cliente", value: "cliente" },
            { label: "Proveedor", value: "proveedor" },
            { label: "Cliente y proveedor", value: "ambos" },
          ]}
          placeholder="Selecciona tipo"
          required
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Input defaultValue={contact?.phone} label="Teléfono" name="phone" />
          <Input
            defaultValue={contact?.email}
            label="Correo"
            name="email"
            type="email"
          />
        </div>
        <Input
          defaultValue={contact?.taxId}
          label="RIF / Cédula"
          name="taxId"
        />
        <Textarea
          defaultValue={contact?.address}
          label="Dirección"
          name="address"
        />
        {errorMessage ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
