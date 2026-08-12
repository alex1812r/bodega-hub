"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/components/Card";

const AUTO_CONTINUE_SECONDS = 5;

type PosSaleSuccessOverlayProps = {
  invoiceNumber: string;
  onNewSale: () => void;
};

export function PosSaleSuccessOverlay({
  invoiceNumber,
  onNewSale,
}: PosSaleSuccessOverlayProps) {
  const [secondsLeft, setSecondsLeft] = useState(AUTO_CONTINUE_SECONDS);
  const onNewSaleRef = useRef(onNewSale);
  const didAutoContinueRef = useRef(false);

  useEffect(() => {
    onNewSaleRef.current = onNewSale;
  }, [onNewSale]);

  useEffect(() => {
    didAutoContinueRef.current = false;
    setSecondsLeft(AUTO_CONTINUE_SECONDS);

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
  }, [invoiceNumber]);

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
          <CardTitle>Venta registrada</CardTitle>
          <CardDescription>
            Factura <span className="font-medium text-foreground">{invoiceNumber}</span>.
            Nueva venta en {secondsLeft}s si no eliges otra opcion.
          </CardDescription>
        </CardHeader>

        <div className="px-6">
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
