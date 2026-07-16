import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { productImportTemplateToBuffer } from "@/modules/products/products-import/services/buildProductImportTemplate";
import * as categoriesMockServer from "@/modules/products/services/categories.mock-server";
import * as categoriesServer from "@/modules/products/services/categories.server";

function getCategoriesService() {
  return resolveDataSource() === "supabase" ? categoriesServer : categoriesMockServer;
}

async function listAllActiveCategories(storeId: string) {
  const service = getCategoriesService();
  const items = [];
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    const params = new URLSearchParams({
      limit: "100",
      skip: String(skip),
    });
    const page = await service.listCategories(params, storeId);
    items.push(...page.items);
    total = page.total;
    skip += page.limit;

    if (page.items.length === 0) {
      break;
    }
  }

  return items;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const categories = await listAllActiveCategories(auth.storeId);
    const buffer = await productImportTemplateToBuffer(categories);

    return new NextResponse(buffer, {
      headers: {
        "Content-Disposition": 'attachment; filename="plantilla-productos.xlsx"',
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      status: 200,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
