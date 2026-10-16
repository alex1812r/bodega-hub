import { resolveDataSource } from "@/lib/api/dataSource";

import * as mockContacts from "./contacts.mock-server";
import * as serverContacts from "./contacts.server";
import * as mockSupplierProductAliases from "./supplierProductAliases.mock-server";
import * as serverSupplierProductAliases from "./supplierProductAliases.server";
import * as mockSupplierProducts from "./supplierProducts.mock-server";
import * as serverSupplierProducts from "./supplierProducts.server";

export function getContactsService() {
  return resolveDataSource() === "mock" ? mockContacts : serverContacts;
}

export function getSupplierProductsService() {
  return resolveDataSource() === "mock" ? mockSupplierProducts : serverSupplierProducts;
}

export function getSupplierProductAliasesService() {
  return resolveDataSource() === "mock" ? mockSupplierProductAliases : serverSupplierProductAliases;
}
