import { redirect } from "next/navigation";

import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";
import { getDefaultHomePathForRole } from "@/shared/auth/defaultHomePath";

export default async function Home() {
  try {
    const profile = await getAuthProfileFromSession();

    if (!profile) {
      redirect("/login");
    }

    redirect(getDefaultHomePathForRole(profile.role));
  } catch {
    redirect("/login");
  }
}
