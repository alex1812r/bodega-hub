"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { cn } from "@/shared/utils/cn";

import { PosCatalogColumn } from "./PosCatalogColumn";
import { PosMobileCartBar } from "./PosMobileCartBar";

type PosWorkspaceProps = {
  /** Single cart instance; receives close handler only in the mobile modal. */
  cart: (options: { onRequestClose?: () => void }) => ReactNode;
  catalogScroll: ReactNode;
  categorySlider: ReactNode;
  className?: string;
  itemsCount: number;
  rateVes: number;
  toolbar: ReactNode;
  totalRef: number;
  totalVes: number;
};

/**
 * POS: movil = catalogo a pantalla completa + barra de carrito / modal;
 * desktop = catalogo + carrito (--pos-cart-width) a la derecha.
 */
export function PosWorkspace({
  cart,
  catalogScroll,
  categorySlider,
  className,
  itemsCount,
  rateVes,
  toolbar,
  totalRef,
  totalVes,
}: PosWorkspaceProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const previousItemsCountRef = useRef(itemsCount);

  useEffect(() => {
    const previousCount = previousItemsCountRef.current;
    previousItemsCountRef.current = itemsCount;

    // Close after a successful sale (cart emptied), not when opening an empty cart.
    if (previousCount > 0 && itemsCount === 0 && mobileCartOpen) {
      setMobileCartOpen(false);
    }
  }, [itemsCount, mobileCartOpen]);

  useEffect(() => {
    if (isDesktop) {
      setMobileCartOpen(false);
    }
  }, [isDesktop]);

  return (
    <div
      className={cn(
        "flex min-h-0 max-w-full flex-1 flex-col overflow-hidden lg:flex-row lg:items-stretch",
        className,
      )}
    >
      <PosCatalogColumn
        categorySlider={categorySlider}
        className="min-h-0 min-w-0 flex-1"
        productScroll={catalogScroll}
        toolbar={toolbar}
      />

      {isDesktop ? (
        <div className="pos-cart-aside flex min-h-0 flex-col overflow-hidden">
          {cart({})}
        </div>
      ) : (
        <>
          <PosMobileCartBar
            itemsCount={itemsCount}
            onOpen={() => setMobileCartOpen(true)}
            rateVes={rateVes}
            totalRef={totalRef}
            totalVes={totalVes}
          />

          <Dialog.Root onOpenChange={setMobileCartOpen} open={mobileCartOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50" />
              <Dialog.Content
                aria-describedby={undefined}
                className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-surface-container-lowest outline-none"
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <Dialog.Title className="sr-only">Carrito de venta</Dialog.Title>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {cart({ onRequestClose: () => setMobileCartOpen(false) })}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      )}
    </div>
  );
}
