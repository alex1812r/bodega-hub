"use client";

import { Check, Download, Loader2 } from "lucide-react";

import { cn } from "@/shared/utils/cn";

import type { ProductImportStep } from "../../types";
import {
  getProductImportStepIndex,
  PRODUCT_IMPORT_STEPS,
} from "./productImportSteps";

type ProductImportStepperProps = {
  currentStep: ProductImportStep;
};

export function ProductImportStepper({ currentStep }: ProductImportStepperProps) {
  const currentIndex = getProductImportStepIndex(currentStep);

  return (
    <nav aria-label="Progreso de importación" className="product-import-stepper">
      <div aria-hidden className="product-import-stepper__track" />
      <ol className="product-import-stepper__list">
        {PRODUCT_IMPORT_STEPS.map((step, index) => {
          const isDone = index < currentIndex;
          const isActive = index === currentIndex;
          const isImporting = isActive && currentStep === "importing";

          return (
            <li className="product-import-stepper__item" key={step.id}>
              <div
                className={cn(
                  "product-import-stepper__node",
                  isDone && "product-import-stepper__node--done",
                  isActive && !isImporting && "product-import-stepper__node--active",
                  isImporting && "product-import-stepper__node--importing",
                  !isDone && !isActive && "product-import-stepper__node--pending",
                )}
              >
                {isDone ? (
                  <Check aria-hidden className="size-4" />
                ) : isActive && step.id === "template" ? (
                  <Download aria-hidden className="size-4" />
                ) : isImporting ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={cn(
                  "product-import-stepper__label",
                  isActive && "product-import-stepper__label--active",
                  isDone && !isActive && "product-import-stepper__label--done",
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
