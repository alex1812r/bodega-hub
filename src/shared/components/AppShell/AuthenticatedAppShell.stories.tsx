import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";

import { AuthenticatedAppShell } from "./AuthenticatedAppShell";

const localRoleStorageKey = "control-ventas:user-role";

function setLocalRole(role: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(localRoleStorageKey, role);
  }
}

const meta = {
  component: AuthenticatedAppShell,
  title: "Shared/Layout/AuthenticatedAppShell",
  tags: ["ai-generated"],
} satisfies Meta<typeof AuthenticatedAppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AdminAllowed: Story = {
  args: {
    children: null,
    currentPath: "/dashboard",
    requiredPermission: "dashboard.view",
  },
  render: () => {
    setLocalRole("admin");

    return (
      <AuthenticatedAppShell currentPath="/dashboard" requiredPermission="dashboard.view">
        <Card>
          <CardHeader>
            <CardTitle>Dashboard protegido</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Contenido visible para administrador.</p>
          </CardContent>
        </Card>
      </AuthenticatedAppShell>
    );
  },
};

export const SellerMenuFiltered: Story = {
  args: {
    children: null,
    currentPath: "/sales",
    requiredPermission: "sales.view",
  },
  render: () => {
    setLocalRole("vendedor");

    return (
      <AuthenticatedAppShell currentPath="/sales" requiredPermission="sales.view">
        <Card>
          <CardHeader>
            <CardTitle>Ventas</CardTitle>
          </CardHeader>
          <CardContent>
            <p>El menú queda filtrado por permisos de vendedor.</p>
          </CardContent>
        </Card>
      </AuthenticatedAppShell>
    );
  },
};

export const WithoutPermission: Story = {
  args: {
    children: null,
    currentPath: "/purchases",
    requiredPermission: "purchases.view",
  },
  render: () => {
    setLocalRole("vendedor");

    return (
      <AuthenticatedAppShell
        currentPath="/purchases"
        requiredPermission="purchases.view"
      >
        <p>Este contenido no debe mostrarse.</p>
      </AuthenticatedAppShell>
    );
  },
};
