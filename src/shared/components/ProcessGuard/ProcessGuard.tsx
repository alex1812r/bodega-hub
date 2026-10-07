"use client";

import Link from "next/link";
import { type ComponentProps } from "react";

import {
  interceptProcessGuardNavigation,
  PROCESS_GUARD_LINK_ATTRIBUTE,
  type ProcessGuardController,
  useProcessGuard,
  type UseProcessGuardOptions,
} from "@/shared/hooks/useProcessGuard";

import { Button } from "../Button";
import { Modal } from "../Modal";

const CONSEQUENCE_TEXT = {
  discard: "Si sales ahora, se perderán los cambios.",
  draft: "Si sales ahora, se guardará un borrador para que puedas continuar después.",
} as const;

type ProcessGuardModalProps = {
  guard: Pick<ProcessGuardController, "dialog">;
};

/** Modal del guardia. Recibe lo que devuelve `useProcessGuard`. */
export function ProcessGuardModal({ guard }: ProcessGuardModalProps) {
  const { description, error, label, leave, leaving, onLeave, open, stay } = guard.dialog;

  return (
    <Modal
      description={CONSEQUENCE_TEXT[onLeave]}
      footer={
        <>
          <Button autoFocus disabled={leaving} onClick={stay}>
            Seguir aquí
          </Button>
          <Button
            disabled={leaving}
            onClick={leave}
            variant={onLeave === "discard" ? "danger" : "outline"}
          >
            Salir
          </Button>
        </>
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          stay();
        }
      }}
      open={open}
      title="¿Salir sin terminar?"
    >
      <p className="break-words rounded-md border border-border bg-surface-container-low px-3 py-2 text-sm font-medium text-foreground">
        {label}
      </p>
      {description ? (
        <p className="mt-3 text-sm leading-6 text-on-surface-variant">{description}</p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

/** Guardia listo para usar cuando la pantalla no necesita las funciones del hook. */
export function ProcessGuard(props: UseProcessGuardOptions) {
  const guard = useProcessGuard(props);

  return <ProcessGuardModal guard={guard} />;
}

type GuardedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

/**
 * `next/link` que bloquea con `onNavigate` (mecanismo documentado por Next)
 * mientras haya un guardia activo. Sin guardias se comporta como `Link`.
 */
export function GuardedLink({ href, onNavigate, replace, ...props }: GuardedLinkProps) {
  return (
    <Link
      {...props}
      {...{ [PROCESS_GUARD_LINK_ATTRIBUTE]: "" }}
      href={href}
      onNavigate={(event) => {
        let prevented = false;

        onNavigate?.({
          preventDefault: () => {
            prevented = true;
            event.preventDefault();
          },
        });

        if (!prevented && interceptProcessGuardNavigation(href, replace)) {
          event.preventDefault();
        }
      }}
      replace={replace}
    />
  );
}
