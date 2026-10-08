"use client";

import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { getFormSaveDescription } from "@/lib/api/dataSourceUi";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import { useToast } from "@/shared/components/Toast";
import type { ContactMock } from "@/shared/mocks/erp-data";

import type { ContactInput } from "../../hooks/useContacts";

const DEFAULT_CONTACT_TYPE: ContactInput["type"] = "cliente";

/**
 * Formulario de contacto (alta y edición).
 *
 * El alta ofrece además "Guardar y crear otro": tras guardar, el modal sigue
 * abierto con el formulario vacío, el foco en Nombre y el Tipo recién usado ya
 * elegido, para dar altas en serie (p. ej. varios proveedores). Al cerrar y
 * volver a abrir, el Tipo vuelve a "Cliente". Si `onSubmit` rechaza no se
 * limpia nada y el modal queda abierto.
 *
 * Enter en un campo equivale siempre al botón principal: "Guardar y crear otro"
 * no es un botón de envío (`type="button"`), así que el navegador nunca lo
 * elige como botón por defecto del formulario; solo actúa con clic o con
 * Enter/Espacio teniendo el foco.
 *
 * Los opcionales vacíos no viajan en un alta (el BFF rechaza `email: ""`). En
 * edición, Teléfono, RIF y Dirección vacíos sí viajan como `""` para poder
 * borrarlos; el Correo vacío no viaja (el BFF no admite borrarlo).
 *
 * Tras un alta correcta (con cualquiera de los dos botones) muestra el aviso
 * "Contacto creado: <nombre>" con el enlace "Ver" a su detalle (sin enlace si
 * `onSubmit` no devolvió el contacto). En edición no avisa.
 */
type ContactFormModalProps = {
  contact?: ContactMock;
  customersOnly?: boolean;
  errorMessage?: string;
  isSubmitting?: boolean;
  mode?: "create" | "edit";
  onOpenChange?: (open: boolean) => void;
  /**
   * Guarda. Si lanza o rechaza, el modal queda abierto (el consumidor muestra el
   * motivo con `errorMessage`); el rechazo se captura aquí. En un alta puede
   * devolver el contacto creado para que el aviso enlace a su detalle; no
   * devolver nada sigue siendo válido.
   */
  onSubmit?: (input: ContactInput) => Promise<ContactMock | void> | ContactMock | void;
  open?: boolean;
  trigger?: ReactNode;
};

export function ContactFormModal({
  contact,
  customersOnly = false,
  errorMessage,
  isSubmitting = false,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  trigger,
}: ContactFormModalProps) {
  const { showToast } = useToast();
  const formId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const isEdit = mode === "edit";
  const formRef = useRef<HTMLFormElement | null>(null);
  // Cambia tras "Guardar y crear otro": el formulario se monta de nuevo, vacío.
  const [formResetKey, setFormResetKey] = useState(0);
  const [createType, setCreateType] = useState(DEFAULT_CONTACT_TYPE);
  // Candado propio: `isSubmitting` llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);
  // Solo vale durante el envío que lanza "Guardar y crear otro".
  const createAnotherRequestedRef = useRef(false);

  function submitAndCreateAnother() {
    createAnotherRequestedRef.current = true;
    // Valida como un envío normal; si un campo no es válido no hay evento submit.
    formRef.current?.requestSubmit();
    createAnotherRequestedRef.current = false;
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
    setCreateType(DEFAULT_CONTACT_TYPE);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || isSubmitInFlightRef.current) {
      return;
    }

    const createAnother = !isEdit && createAnotherRequestedRef.current;
    const formData = new FormData(event.currentTarget);
    const optionalText = (name: string, clearable = isEdit) =>
      String(formData.get(name) ?? "").trim() || (clearable ? "" : undefined);
    const input: ContactInput = {
      address: optionalText("address"),
      email: optionalText("email", false),
      name: String(formData.get("name") ?? ""),
      phone: optionalText("phone"),
      taxId: optionalText("taxId"),
      type: String(formData.get("type") ?? "cliente") as ContactInput["type"],
    };

    // Si `onSubmit` rechaza no se llega más abajo: el modal queda abierto con
    // lo escrito. El rechazo se queda aquí (no sube como promesa sin manejar):
    // el motivo lo pinta el consumidor con `errorMessage`.
    let created: ContactMock | void;

    isSubmitInFlightRef.current = true;

    try {
      created = await onSubmit?.(input);
    } catch {
      return;
    } finally {
      isSubmitInFlightRef.current = false;
    }

    if (!isEdit) {
      showToast({
        action: created ? { href: `/contacts/${created.id}`, label: "Ver" } : undefined,
        title: `Contacto creado: ${created?.name ?? input.name}`,
        tone: "success",
      });
    }

    if (!createAnother) {
      handleOpenChange(false);

      return;
    }

    flushSync(() => {
      setCreateType(input.type);
      setFormResetKey((key) => key + 1);
    });

    const nameField = formRef.current?.elements.namedItem("name");

    if (nameField instanceof HTMLElement) {
      nameField.focus();
    }
  }

  return (
    <Modal
      description={getFormSaveDescription()}
      footer={({ close }) =>
        isEdit ? (
          <FormActions
            isSubmitting={isSubmitting}
            onCancel={close}
            submitFormId={formId}
            submitLabel="Guardar cambios"
          />
        ) : (
          // FormActions no admite una acción secundaria entre Cancelar y la principal.
          <>
            <Button onClick={close} variant="outline">
              Cancelar
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={submitAndCreateAnother}
              type="button"
              variant="outline"
            >
              Guardar y crear otro
            </Button>
            <Button disabled={isSubmitting} form={formId} type="submit">
              {isSubmitting ? "Guardando..." : "Crear contacto"}
            </Button>
          </>
        )
      }
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
        key={`${contact?.id ?? "new"}-${formResetKey}`}
        onSubmit={(event) => void handleSubmit(event)}
        ref={formRef}
      >
        <Input defaultValue={contact?.name} label="Nombre" name="name" required />
        <SelectField
          defaultValue={contact?.type ?? createType}
          label="Tipo"
          name="type"
          options={
            customersOnly
              ? [{ label: "Cliente", value: "cliente" }]
              : [
                  { label: "Cliente", value: "cliente" },
                  { label: "Proveedor", value: "proveedor" },
                  { label: "Cliente y proveedor", value: "ambos" },
                ]
          }
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
          <p className="min-w-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 [overflow-wrap:anywhere] dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
