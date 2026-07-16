import { ApiError } from "@/lib/api/apiError";

import {
  STORE_ACCESS_FORBIDDEN_MESSAGE,
  SUPERADMIN_ERP_FORBIDDEN_MESSAGE,
  assertStoreAccess,
  requireStoreId,
} from "./storeAccess";
import type { ApiAuthContext } from "./requirePermission";

function auth(partial: Partial<ApiAuthContext>): ApiAuthContext {
  return {
    isSuperadmin: false,
    permissions: [],
    role: "admin",
    storeId: "store-a",
    userId: "user-1",
    ...partial,
  };
}

describe("storeAccess", () => {
  it("allows matching store ids", () => {
    expect(() => assertStoreAccess("store-a", "store-a")).not.toThrow();
  });

  it("rejects mismatched or missing resource store", () => {
    expect(() => assertStoreAccess("store-a", "store-b")).toThrow(ApiError);
    expect(() => assertStoreAccess("store-a", null)).toThrow(
      expect.objectContaining({ message: STORE_ACCESS_FORBIDDEN_MESSAGE, status: 403 }),
    );
  });

  it("requireStoreId blocks superadmin and missing store", () => {
    expect(() =>
      requireStoreId(auth({ isSuperadmin: true, role: "superadmin", storeId: null })),
    ).toThrow(expect.objectContaining({ message: SUPERADMIN_ERP_FORBIDDEN_MESSAGE }));

    expect(() => requireStoreId(auth({ storeId: null }))).toThrow(ApiError);
  });

  it("requireStoreId returns store id for store users", () => {
    expect(requireStoreId(auth({ storeId: "store-a" }))).toBe("store-a");
  });
});
