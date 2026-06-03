import { PaymentDetailsPage } from "@/modules/payments/payment-details/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function Page(props: PageProps) {
  const { id } = await props.params;

  return (
    <AuthenticatedAppShell currentPath="/payments" requiredPermission="payments.view">
      <PaymentDetailsPage paymentId={id} />
    </AuthenticatedAppShell>
  );
}
