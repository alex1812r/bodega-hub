import { ProductDetailsPage } from "@/modules/products/product-details/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function Page(props: PageProps) {
  const { id } = await props.params;

  return (
    <AuthenticatedAppShell currentPath="/products" requiredPermission="products.view">
      <ProductDetailsPage productId={id} />
    </AuthenticatedAppShell>
  );
}
