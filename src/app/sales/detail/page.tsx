import { redirect } from "next/navigation";

type PageProps = {
  searchParams?: Promise<{
    id?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;

  if (!params?.id) {
    redirect("/sales");
  }

  redirect(`/sales/${params.id}`);
}
