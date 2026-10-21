import { useCallback, useState } from "react";
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
  const [expired, setExpired] = useState(false);
  const login = useCallback((value: string) => {
    persist(value);
    setExpired(false);
    setToken(value);
  }, []);
  const logout = useCallback(() => {
    persist(null);
    setToken(null);
    setExpired(false);
  }, []);
  const expire = useCallback(() => {
    persist(null);
    setToken(null);
    setExpired(true);
  }, []);
  return { token, login, logout, expire, expired };
}
