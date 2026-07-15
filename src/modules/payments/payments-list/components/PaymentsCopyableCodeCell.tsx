"use client";

import { CopyableCodeCell } from "@/shared/components/CopyableCodeCell";
import { formatTruncatedCode } from "@/shared/utils/truncatedCode";

export { CopyableCodeCell as PaymentsCopyableCodeCell };

export function formatPaymentIdDisplay(id: string) {
  return formatTruncatedCode(id, 10);
}
