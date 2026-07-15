import type { ContactMock, ProductMock } from "@/shared/mocks/erp-data";

import type {
  RegisterSupplierPriceResult,
  SupplierProduct as ApiSupplierProduct,
  SupplierProductInput,
  SupplierProductPriceHistory,
  SupplierProductPriceInput,
  SupplierProductPriceOrigin,
  SupplierProductUpdateInput,
  SupplierProductPackUnit,
  SupplierProductPackUnitInput,
  SupplierProductPackUnitUpdateInput,
} from "../services/supplierProducts.schemas";

export type { SupplierProductPriceOrigin };

export type {
  SupplierProductPackUnit,
  SupplierProductPackUnitInput,
  SupplierProductPackUnitUpdateInput,
};

export type SupplierProduct = ApiSupplierProduct & {
  createdAt?: string;
  updatedAt?: string;
  product?: ProductMock;
  supplier?: ContactMock;
};

export type SupplierProductPriceHistoryEntry = SupplierProductPriceHistory;

export type SupplierProductCreateInput = SupplierProductInput;

export type SupplierProductMetadataUpdateInput = SupplierProductUpdateInput & {
  productId?: string;
  supplierId?: string;
};

export type SupplierProductRegisterPriceInput = Omit<
  SupplierProductPriceInput,
  "origin"
> & {
  origin?: SupplierProductPriceOrigin;
};

export type SupplierProductRegisterPriceResult = RegisterSupplierPriceResult;

export type SupplierProductsFilters = {
  isActive?: boolean | string;
  productId?: string;
  supplierId?: string;
};
