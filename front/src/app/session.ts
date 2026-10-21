import { useCallback, useState } from "react";
import type { Me } from "../api/client";
const SESSION_KEY = "smart-harness.access-token";
function storedToken() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function persist(token: string | null) {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* Restricted storage keeps the session in memory only. */
  }
}
export function useSession() {
  const [token, setToken] = useState(storedToken);
  const [me, setMe] = useState<Me>();
  const [expired, setExpired] = useState(false);
  const login = useCallback((value: string, identity: Me) => {
    setMe(identity);
    persist(value);
    setExpired(false);
    setToken(value);
  }, []);
  const logout = useCallback(() => {
    persist(null);
    setToken(null);
    setMe(undefined);
    setExpired(false);
  }, []);
  const expire = useCallback(() => {
    persist(null);
    setToken(null);
    setMe(undefined);
    setExpired(true);
  }, []);
  return { token, me, login, logout, expire, expired };
}
