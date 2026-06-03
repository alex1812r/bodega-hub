import { Button } from "@/shared/components/Button";

type FormActionsProps = {
  cancelLabel?: string;
  isSubmitting?: boolean;
  onCancel?: () => void;
  submitFormId?: string;
  submitLabel?: string;
  submittingLabel?: string;
};

export function FormActions({
  cancelLabel = "Cancelar",
  isSubmitting = false,
  onCancel,
  submitFormId,
  submitLabel = "Guardar",
  submittingLabel = "Guardando...",
}: FormActionsProps) {
  return (
    <>
      <Button onClick={onCancel} type="button" variant="outline">
        {cancelLabel}
      </Button>
      <Button disabled={isSubmitting} form={submitFormId} type="submit">
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    </>
  );
}
