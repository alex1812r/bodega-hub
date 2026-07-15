import { buildContactExportFilename } from "../utils/contactExportFilename";
import { buildContactsExportWorkbook } from "./buildContactsExportWorkbook";
import {
  fetchContactsForExport,
  type ContactsExportFilters,
} from "./fetchContactsForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportContactsToExcel(filters: ContactsExportFilters) {
  const exportedAt = new Date().toISOString();
  const contacts = await fetchContactsForExport(filters);
  const buffer = await buildContactsExportWorkbook(contacts, {
    exportedAt,
    filters,
  });

  const filename = buildContactExportFilename(new Date(exportedAt));

  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}
