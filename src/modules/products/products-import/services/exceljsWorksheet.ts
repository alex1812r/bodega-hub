import type ExcelJS from "exceljs";

/** Runtime API present on exceljs worksheets but missing from published types. */
export type WorksheetWithDataValidations = ExcelJS.Worksheet & {
  dataValidations: {
    add: (address: string, validation: ExcelJS.DataValidation) => void;
    model: Record<string, ExcelJS.DataValidation | undefined>;
  };
};

export function asWorksheetWithDataValidations(
  sheet: ExcelJS.Worksheet | undefined,
): WorksheetWithDataValidations | undefined {
  return sheet as WorksheetWithDataValidations | undefined;
}
