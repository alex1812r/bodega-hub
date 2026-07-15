import { cn } from "@/shared/utils/cn";

type ProductImportRequirementBadgeProps = {
  required: boolean;
};

export function ProductImportRequirementBadge({
  required,
}: ProductImportRequirementBadgeProps) {
  return (
    <span
      className={cn(
        "product-import-badge",
        required ? "product-import-badge--required" : "product-import-badge--optional",
      )}
    >
      {required ? "Obligatorio" : "Opcional"}
    </span>
  );
}
