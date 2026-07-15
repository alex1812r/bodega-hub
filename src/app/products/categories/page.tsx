import { CategoriesListPage } from "@/modules/products/categories-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/products"
      requiredPermission="products.view"
    >
      <CategoriesListPage />
    </AuthenticatedAppShell>
  );
}
