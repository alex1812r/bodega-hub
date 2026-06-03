import { redirect } from "next/navigation";

import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";

export default async function Home() {
  try {
    const profile = await getAuthProfileFromSession();

    redirect(profile ? "/dashboard" : "/login");
  } catch {
    redirect("/login");
  }
}
