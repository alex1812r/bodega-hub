import { ProductsListPage } from "@/modules/products/products-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/products"
      requiredPermission="products.view"
    >
      <ProductsListPage />
    </AuthenticatedAppShell>
  );
}
