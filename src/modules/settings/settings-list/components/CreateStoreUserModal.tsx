"use client";

import { type FormEvent, useState } from "react";

import { roleLabels, storeUserRoles, type StoreUserRole } from "@/shared/auth/permissions";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";

import { useCreateUser } from "../../hooks/useSettings";

const roleOptions = storeUserRoles.map((role) => ({
  label: roleLabels[role],
  value: role,
}));

const initialForm = {
  email: "",
  fullName: "",
  password: "",
  role: "vendedor" as StoreUserRole,
};

type CreateStoreUserModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function CreateStoreUserModal({ onOpenChange, open }: CreateStoreUserModalProps) {
  const createUser = useCreateUser();
  const [form, setForm] = useState(initialForm);

  function resetForm() {
    setForm(initialForm);
    createUser.reset();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await createUser.mutateAsync({
      email: form.email,
      fullName: form.fullName,
      password: form.password,
      role: form.role,
    });

    handleOpenChange(false);
  }

  return (
    <Modal
      description="Crea un usuario con acceso al ERP de esta tienda."
      footer={({ close }) => (
        <>
          <Button onClick={close} type="button" variant="secondary">
            Cancelar
          </Button>
          <Button
            disabled={createUser.isPending}
            form="create-store-user-form"
            type="submit"
            variant="primary"
          >
            {createUser.isPending ? "Creando..." : "Crear usuario"}
          </Button>
        </>
      )}
      onOpenChange={handleOpenChange}
      open={open}
      title="Nuevo usuario"
    >
      <form className="grid gap-4 sm:grid-cols-2" id="create-store-user-form" onSubmit={handleSubmit}>
        <Input
          className="sm:col-span-2"
          label="Nombre completo"
          onChange={(event) =>
            setForm((current) => ({ ...current, fullName: event.target.value }))
          }
          required
          value={form.fullName}
        />
        <Input
          label="Correo"
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          required
          type="email"
          value={form.email}
        />
        <SelectField
          label="Rol"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              role: event.target.value as StoreUserRole,
            }))
          }
          options={roleOptions}
          required
          value={form.role}
        />
        <Input
          className="sm:col-span-2"
          helperText="Minimo 8 caracteres. El usuario debera cambiarla despues."
          label="Contrasena temporal"
          minLength={8}
          onChange={(event) =>
            setForm((current) => ({ ...current, password: event.target.value }))
          }
          required
          type="password"
          value={form.password}
        />
        {createUser.error ? (
          <p className="text-sm text-destructive sm:col-span-2">{createUser.error.message}</p>
        ) : null}
      </form>
    </Modal>
  );
}
