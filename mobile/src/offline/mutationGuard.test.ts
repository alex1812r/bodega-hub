import NetInfo from "@react-native-community/netinfo";

import { assertOnline, OfflineError } from "./mutationGuard";

const fetchMock = NetInfo.fetch as jest.Mock;

describe("assertOnline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lets a mutation through when the network is reachable", async () => {
    fetchMock.mockResolvedValue({ isConnected: true, isInternetReachable: true });

    await expect(assertOnline("registrar la venta")).resolves.toBeUndefined();
  });

  it("blocks when there is no connection, naming the action in Spanish", async () => {
    fetchMock.mockResolvedValue({ isConnected: false, isInternetReachable: false });

    await expect(assertOnline("registrar la venta")).rejects.toThrow(
      "No hay conexion. No se puede registrar la venta sin internet.",
    );
  });

  it("blocks on a connected network with no internet, which is the airport wifi case", async () => {
    fetchMock.mockResolvedValue({ isConnected: true, isInternetReachable: false });

    await expect(assertOnline()).rejects.toBeInstanceOf(OfflineError);
  });

  it("allows the request when reachability is still unknown", async () => {
    // NetInfo devuelve null mientras comprueba; bloquear ahi seria un falso positivo.
    fetchMock.mockResolvedValue({ isConnected: true, isInternetReachable: null });

    await expect(assertOnline()).resolves.toBeUndefined();
  });
});
