"use client";

import { type FormEvent, useId, useState } from "react";

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
  onSubmit?: (input: ContactInput) => Promise<void> | void;
};

export function ContactFormModal({
  contact,
  errorMessage,
  isSubmitting = false,
  mode = "create",
  onSubmit,
}: ContactFormModalProps) {
  const formId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const isEdit = mode === "edit";

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
    setIsOpen(false);
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
      onOpenChange={setIsOpen}
      open={isOpen}
      title={isEdit ? "Editar contacto" : "Crear contacto"}
      trigger={
        <Button size="sm" variant={isEdit ? "outline" : "primary"}>
          {isEdit ? "Editar contacto" : "Nuevo contacto"}
        </Button>
      }
    >
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
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
          <Input defaultValue={contact?.phone} label="Telefono" name="phone" />
          <Input
            defaultValue={contact?.email}
            label="Correo"
            name="email"
            type="email"
          />
        </div>
        <Input
          defaultValue={contact?.taxId}
          label="Documento fiscal"
          name="taxId"
        />
        <Textarea
          defaultValue={contact?.address}
          label="Direccion"
          name="address"
        />
        <Textarea label="Notas" placeholder="Observaciones internas" />
        {errorMessage ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
