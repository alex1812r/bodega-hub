import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

/**
 * `isConnected` puede ser true con internet inalcanzable; por eso se mira
 * tambien `isInternetReachable`, que es lo que decide si mostramos el banner.
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable;
      setIsOnline(Boolean(state.isConnected) && reachable !== false);
    });

    return unsubscribe;
  }, []);

  return { isOnline };
}
