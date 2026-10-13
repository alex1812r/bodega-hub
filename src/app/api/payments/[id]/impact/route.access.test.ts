/**
 * @jest-environment node
 */

/**
 * AUD-01: la ruta pasa al cargador real lo que la sesión puede ver de caja y de
 * baúl, además del rol.
 */
jest.mock("../../../../../lib/api/dataSource", () => ({
  resolveDataSource: () => "supabase",
}));
jest.mock("../../../../../modules/payments/services/paymentImpact.server", () => ({
  getPaymentImpact: jest.fn(async () => ({ allowed: true })),
}));

import { getPaymentImpact } from "@/modules/payments/services/paymentImpact.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";

function get(role: string) {
  return GET(
    new Request(`http://localhost/api/payments/${PAYMENT_ID}/impact?action=cancel`, {
      headers: { "x-demo-role": role },
    }),
    { params: Promise.resolve({ id: PAYMENT_ID }) },
  );
}

describe("/api/payments/[id]/impact · acceso al libro por rol", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(["admin", "contador"])("%s: con acceso a caja y baúl", async (role) => {
    const response = await get(role);

    expect(response.status).toBe(200);
    expect(getPaymentImpact).toHaveBeenCalledWith(PAYMENT_ID, "cancel", DEFAULT_STORE_ID, role, {
      canViewCash: true,
      canViewVault: true,
    });
  });

  it.each(["vendedor", "almacen"])("%s: 403 sin llegar al cargador", async (role) => {
    const response = await get(role);

    expect(response.status).toBe(403);
    expect(getPaymentImpact).not.toHaveBeenCalled();
  });
});
