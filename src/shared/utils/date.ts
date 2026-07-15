import moment from "moment";

export const DATE_FORMATS = {
  short: "DD/MM/YYYY",
  dateTime: "DD/MM/YYYY HH:mm",
  month: "MMMM YYYY",
  time: "HH:mm",
} as const;

export function formatDate(
  value: string | Date,
  format: (typeof DATE_FORMATS)[keyof typeof DATE_FORMATS] = DATE_FORMATS.short,
) {
  return moment(value).format(format);
}

/** Stitch listados: "24 Oct, 14:30" */
export function formatDateTimeShort(value: string | Date) {
  return moment(value).locale("es").format("D MMM, HH:mm");
}

export function toIsoDateRange(start: Date, end: Date) {
  return {
    start: moment(start).startOf("day").toISOString(),
    end: moment(end).endOf("day").toISOString(),
  };
}
