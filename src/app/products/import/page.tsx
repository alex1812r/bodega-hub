import { ProductsImportPage } from "@/modules/products/products-import/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/products"
      requiredPermission="products.manage"
    >
      <ProductsImportPage />
    </AuthenticatedAppShell>
  );
}
