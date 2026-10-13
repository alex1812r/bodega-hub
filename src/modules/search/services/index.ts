import { resolveDataSource } from "@/lib/api/dataSource";

import * as mockSearch from "./search.mock-server";
import * as serverSearch from "./search.server";

export function getSearchService() {
  return resolveDataSource() === "mock" ? mockSearch : serverSearch;
}
