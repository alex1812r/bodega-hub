"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/components/Card";

const AUTO_CONTINUE_SECONDS = 5;

type PosSaleSuccessOverlayProps = {
  invoiceNumber: string;
  onNewSale: () => void;
  /**
   * La venta existe pero quedo en `pendiente_pago` aunque se enviaron cobros:
   * no se anuncia como cobrada ni se pasa sola a la venta siguiente.
   */
  pendingPayment?: boolean;
};

export function PosSaleSuccessOverlay({
  invoiceNumber,
  onNewSale,
  pendingPayment = false,
}: PosSaleSuccessOverlayProps) {
  const [secondsLeft, setSecondsLeft] = useState(AUTO_CONTINUE_SECONDS);
  const onNewSaleRef = useRef(onNewSale);
  const didAutoContinueRef = useRef(false);

  useEffect(() => {
    onNewSaleRef.current = onNewSale;
  }, [onNewSale]);

  useEffect(() => {
    didAutoContinueRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la cuenta atras se reinicia en el mismo efecto que arma el intervalo y rearma didAutoContinueRef; separarlos cambia el orden que dispara la nueva venta
    setSecondsLeft(AUTO_CONTINUE_SECONDS);

    if (pendingPayment) {
      // El cajero tiene que leer el aviso: sin cuenta atras.
      return;
    }

    const intervalId = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [invoiceNumber, pendingPayment]);

  useEffect(() => {
    if (secondsLeft !== 0 || didAutoContinueRef.current) {
      return;
    }

    didAutoContinueRef.current = true;
    onNewSaleRef.current();
  }, [secondsLeft]);

  const progressPercent = (secondsLeft / AUTO_CONTINUE_SECONDS) * 100;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-surface/80 px-4 py-8 backdrop-blur-[1px]">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <CardTitle>{pendingPayment ? "Venta registrada sin cobro" : "Venta registrada"}</CardTitle>
          <CardDescription>
            Factura <span className="font-medium text-foreground">{invoiceNumber}</span>.{" "}
            {pendingPayment
              ? "Quedo pendiente de pago: no la vuelvas a crear, registra el cobro desde Ventas."
              : `Nueva venta en ${secondsLeft}s si no eliges otra opcion.`}
          </CardDescription>
        </CardHeader>

        <div className={pendingPayment ? "hidden" : "px-6"}>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild className="w-full sm:w-auto" size="sm" variant="outline">
            <Link href="/sales">Volver al listado</Link>
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              didAutoContinueRef.current = true;
              onNewSale();
            }}
            size="sm"
            type="button"
            variant="primary"
          >
            Nueva venta
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
