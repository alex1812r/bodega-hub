import moment from "moment";

export const DATE_FORMATS = {
  short: "DD/MM/YYYY",
  dateTime: "DD/MM/YYYY HH:mm",
  month: "MMMM YYYY",
} as const;

export function formatDate(value: string | Date, format = DATE_FORMATS.short) {
  return moment(value).format(format);
}

export function toIsoDateRange(start: Date, end: Date) {
  return {
    start: moment(start).startOf("day").toISOString(),
    end: moment(end).endOf("day").toISOString(),
  };
}
