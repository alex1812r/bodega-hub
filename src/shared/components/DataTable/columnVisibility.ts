import { type ColumnVisibility } from "./DataTable";

export function getColumnVisibilityClass(visibility: ColumnVisibility = "always") {
  switch (visibility) {
    case "md":
      return "hidden md:table-cell";
    case "lg":
      return "hidden lg:table-cell";
    default:
      return "";
  }
}
