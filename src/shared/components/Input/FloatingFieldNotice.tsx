"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formFloatingNoticeClassName } from "@/shared/styles/form-controls";

const GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

type FloatingFieldNoticeProps = {
  /** `id` del campo al que se ancla. */
  anchorId: string;
  children: string;
  id: string;
};

function findAnchor(anchorId: string) {
  return typeof document === "undefined" ? null : document.getElementById(anchorId);
}

/**
 * Aviso de un campo pintado fuera del flujo: se ancla bajo el campo con
 * `position: fixed` y en un portal, para no mover la fila de una tabla ni quedar
 * recortado por un contenedor con scroll. Como un tooltip, solo se ve mientras el
 * campo tiene el foco o el puntero encima; el campo conserva su borde de aviso.
 */
export function FloatingFieldNotice({ anchorId, children, id }: FloatingFieldNoticeProps) {
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [isShown, setIsShown] = useState(() => {
    const anchor = findAnchor(anchorId);

    return anchor !== null && (anchor === document.activeElement || anchor.matches(":hover"));
  });

  useEffect(() => {
    const anchor = findAnchor(anchorId);

    if (!anchor) {
      return;
    }

    const show = () => setIsShown(true);
    // Al perder el foco sigue a la vista solo si el puntero está encima, y al revés.
    const handleBlur = () => setIsShown(anchor.matches(":hover"));
    const handleMouseLeave = () => setIsShown(anchor === document.activeElement);

    anchor.addEventListener("focus", show);
    anchor.addEventListener("mouseenter", show);
    anchor.addEventListener("blur", handleBlur);
    anchor.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      anchor.removeEventListener("focus", show);
      anchor.removeEventListener("mouseenter", show);
      anchor.removeEventListener("blur", handleBlur);
      anchor.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [anchorId]);

  // Sin dependencias: el texto del aviso cambia de tamaño y el campo se mueve con la página.
  useLayoutEffect(() => {
    if (!isShown) {
      return;
    }

    function updatePosition() {
      const notice = noticeRef.current;
      const anchor = findAnchor(anchorId)?.getBoundingClientRect();

      if (!notice || !anchor) {
        return;
      }

      // Un ancestro con `transform` (el Modal centrado) pasa a ser el bloque
      // contenedor de `position: fixed`: se descuenta su origen.
      const current = notice.getBoundingClientRect();
      const originLeft = current.left - (parseFloat(notice.style.left) || 0);
      const originTop = current.top - (parseFloat(notice.style.top) || 0);
      const below = anchor.bottom + GAP_PX;
      const above = anchor.top - GAP_PX - current.height;
      const fitsBelow = below + current.height <= window.innerHeight - VIEWPORT_MARGIN_PX;
      const top = fitsBelow || above < VIEWPORT_MARGIN_PX ? below : above;
      const left = Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(anchor.right - current.width, window.innerWidth - VIEWPORT_MARGIN_PX - current.width),
      );

      notice.style.left = `${left - originLeft}px`;
      notice.style.top = `${top - originTop}px`;
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, { capture: true });
      window.removeEventListener("resize", updatePosition);
    };
  });

  if (!isShown || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <p
      aria-live="polite"
      className={formFloatingNoticeClassName}
      data-placement="floating"
      id={id}
      ref={noticeRef}
      role="status"
      style={{ left: 0, top: 0 }}
    >
      {children}
    </p>,
    document.body,
  );
}
