import { redirect } from "next/navigation";

import { isDevToolkitEnabled } from "@/lib/api/dataSource";

import { WelcomePage } from "@/modules/dev/welcome/page";

export default function DevWelcomeRoute() {
  if (!isDevToolkitEnabled()) {
    redirect("/login");
  }

  return <WelcomePage />;
}
