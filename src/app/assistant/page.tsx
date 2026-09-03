import { AssistantHomePage } from "@/modules/assistant/assistant-home/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/assistant"
      mainClassName="flex min-h-0 flex-col px-4 py-6 lg:px-6"
      mainScroll="hidden"
      requiredPermission="assistant.use"
    >
      <AssistantHomePage />
    </AuthenticatedAppShell>
  );
}
