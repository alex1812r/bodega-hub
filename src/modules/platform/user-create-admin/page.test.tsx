import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreateStoreAdminPage } from "./page";

const push = jest.fn();
const mutateAsync = jest.fn();
let storeIdParam: string | null = null;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: (key: string) => (key === "storeId" ? storeIdParam : null) }),
}));

jest.mock("../hooks/useStores", () => ({
  useStoresList: () => ({
    data: {
      items: [
        { id: "store-1", name: "Tienda Uno", slug: "uno" },
        { id: "store-2", name: "Tienda Dos", slug: "dos" },
      ],
      limit: 100,
      skip: 0,
      total: 2,
    },
  }),
}));

jest.mock("../hooks/useUsers", () => ({
  useCreateStoreAdmin: () => ({ error: null, isPending: false, mutateAsync }),
}));

describe("CreateStoreAdminPage · tienda preseleccionada", () => {
  beforeEach(() => {
    storeIdParam = null;
    push.mockReset();
    mutateAsync.mockReset();
  });

  it("starts without a store when the URL has no storeId", () => {
    render(<CreateStoreAdminPage />);

    expect(screen.getByLabelText(/Tienda/)).toHaveValue("");
  });

  it("starts with the store of the URL and submits it", async () => {
    const user = userEvent.setup();
    storeIdParam = "store-2";
    mutateAsync.mockResolvedValueOnce({ id: "user-9" });
    render(<CreateStoreAdminPage />);

    expect(screen.getByLabelText(/Tienda/)).toHaveValue("store-2");

    await user.type(screen.getByLabelText(/Nombre completo/), "Ana Perez");
    await user.type(screen.getByLabelText(/Email/), "ana@test.dev");
    await user.type(screen.getByLabelText(/Contrasena temporal/), "secreta123");
    await user.click(screen.getByRole("button", { name: /crear|guardar/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/platform/users/user-9"));
    expect(mutateAsync).toHaveBeenCalledWith({
      email: "ana@test.dev",
      fullName: "Ana Perez",
      password: "secreta123",
      storeId: "store-2",
    });
  });

  it("follows a new storeId in the URL without losing what was typed", async () => {
    const user = userEvent.setup();
    storeIdParam = "store-1";
    const { rerender } = render(<CreateStoreAdminPage />);

    await user.type(screen.getByLabelText(/Nombre completo/), "Ana Perez");
    storeIdParam = "store-2";
    rerender(<CreateStoreAdminPage />);

    expect(screen.getByLabelText(/Tienda/)).toHaveValue("store-2");
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue("Ana Perez");
  });

  it("keeps the chosen store when storeId disappears from the URL or repeats", async () => {
    const user = userEvent.setup();
    storeIdParam = "store-1";
    const { rerender } = render(<CreateStoreAdminPage />);

    await user.selectOptions(screen.getByLabelText(/Tienda/), "store-2");
    rerender(<CreateStoreAdminPage />);
    expect(screen.getByLabelText(/Tienda/)).toHaveValue("store-2");

    storeIdParam = null;
    rerender(<CreateStoreAdminPage />);
    expect(screen.getByLabelText(/Tienda/)).toHaveValue("store-2");
  });
});
