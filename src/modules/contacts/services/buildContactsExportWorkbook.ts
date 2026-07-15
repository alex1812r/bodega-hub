import ExcelJS from "exceljs";

import type { ContactMock, ContactType } from "@/shared/mocks/erp-data";

import type { ContactsExportFilters } from "./fetchContactsForExport";

export type ContactsExportWorkbookMetadata = {
  exportedAt: string;
  filters: ContactsExportFilters;
};

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  ambos: "Ambos",
  cliente: "Cliente",
  proveedor: "Proveedor",
};

const EXPORT_COLUMNS = [
  { header: "Nombre / Razón Social", key: "name" },
  { header: "Tipo", key: "type" },
  { header: "RIF / Cédula", key: "taxId" },
  { header: "Contacto", key: "contact" },
  { header: "Estado", key: "status" },
] as const;

function formatContactType(type: ContactType) {
  return CONTACT_TYPE_LABELS[type];
}

function formatContactStatus(isActive: boolean) {
  return isActive ? "Activo" : "Inactivo";
}

function formatContactInfo(contact: ContactMock) {
  const parts = [contact.phone, contact.email].filter(Boolean);

  if (parts.length === 0) {
    return "—";
  }

  return parts.join("\n");
}

function formatTaxId(taxId: string) {
  return taxId.trim() || "—";
}

function buildFiltersLabel(filters: ContactsExportFilters) {
  const parts: string[] = [];

  if (filters.search?.trim()) {
    parts.push(`Búsqueda: ${filters.search.trim()}`);
  }

  if (filters.type) {
    parts.push(`Tipo: ${formatContactType(filters.type as ContactType)}`);
  }

  if (filters.isActive === true || filters.isActive === "true") {
    parts.push("Estado: Activo");
  } else if (filters.isActive === false || filters.isActive === "false") {
    parts.push("Estado: Inactivo");
  }

  return parts.length > 0 ? parts.join(" · ") : "Sin filtros aplicados";
}

function contactToRow(contact: ContactMock) {
  return [
    contact.name,
    formatContactType(contact.type),
    formatTaxId(contact.taxId),
    formatContactInfo(contact),
    formatContactStatus(contact.isActive),
  ];
}

export async function buildContactsExportWorkbook(
  contacts: ContactMock[],
  metadata: ContactsExportWorkbookMetadata,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Ventas";
  workbook.created = new Date(metadata.exportedAt);

  const worksheet = workbook.addWorksheet("Contactos");
  const exportedDate = metadata.exportedAt.slice(0, 10);

  worksheet.addRow([`Exportado: ${exportedDate}`]);
  worksheet.addRow([buildFiltersLabel(metadata.filters)]);
  worksheet.addRow([]);
  worksheet.addRow(EXPORT_COLUMNS.map((column) => column.header));

  for (const contact of contacts) {
    worksheet.addRow(contactToRow(contact));
  }

  const headerRow = worksheet.getRow(4);
  headerRow.font = { bold: true };
  worksheet.columns = EXPORT_COLUMNS.map((column) => ({
    key: column.key,
    width: Math.max(column.header.length + 2, 16),
  }));

  return workbook.xlsx.writeBuffer();
}
