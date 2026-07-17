import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import * as authApi from "../api/auth.api";
import {
  clearSession,
  getStoredToken,
  getStoredUser,
  setStoredToken,
  setStoredUser
} from "../lib/storage";
import { debugLog } from "../lib/debug";
import { disconnectSocket } from "../lib/socketManager";
import type { Role, User } from "../types/api";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (payload: authApi.LoginPayload) => Promise<User>;
  logout: () => Promise<void>;
  hasRole: (roles?: Role[]) => boolean;
  hasPermission: (permissionKey?: string) => boolean;
  hasAnyPermission: (permissionKeys?: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [isBootstrapping, setIsBootstrapping] = useState(Boolean(getStoredToken()));
  const shouldValidateStoredSession = useRef(Boolean(getStoredToken()));

  const logout = useCallback(async () => {
    debugLog("frontend logout started");
    await disconnectSocket("logout");
    clearSession();
    setToken(null);
    setUser(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    const onUnauthorized = () => {
      void logout();
    };
    window.addEventListener("taradi:unauthorized", onUnauthorized);

    return () => window.removeEventListener("taradi:unauthorized", onUnauthorized);
  }, [logout]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      if (!token || !shouldValidateStoredSession.current) {
        setIsBootstrapping(false);
        return;
      }

      try {
        const result = await authApi.me();

        if (!active) {
          return;
        }

        const nextUser = { ...result.user, permissions: result.permissions };
        setUser(nextUser);
        setStoredUser(nextUser);
      } catch (error) {
        debugLog("Stored session validation failed without forcing logout", error);
      } finally {
        if (active) {
          shouldValidateStoredSession.current = false;
          setIsBootstrapping(false);
        }
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, [token]);

  const login = useCallback(async (payload: authApi.LoginPayload) => {
    const result = await authApi.login(payload);
    const nextUser = { ...result.user, permissions: result.permissions };
    setStoredToken(result.token);
    setStoredUser(nextUser);
    setToken(result.token);
    setUser(nextUser);
    return nextUser;
  }, []);

  const hasRole = useCallback((roles?: Role[]) => {
    if (!roles || roles.length === 0) {
      return true;
    }

    return Boolean(user && roles.includes(user.role));
  }, [user]);

  const hasPermission = useCallback((permissionKey?: string) => {
    if (!permissionKey) {
      return true;
    }

    if (user?.role === "ADMIN") {
      return true;
    }

    return Boolean(user?.permissions?.includes(permissionKey));
  }, [user]);

  const hasAnyPermission = useCallback((permissionKeys?: string[]) => {
    if (!permissionKeys || permissionKeys.length === 0) {
      return true;
    }

    return permissionKeys.some((permissionKey) => hasPermission(permissionKey));
  }, [hasPermission]);

  const value = useMemo<AuthContextValue>(() => ({
    token,
    user,
    isAuthenticated: Boolean(token && user),
    isBootstrapping,
    login,
    logout,
    hasRole,
    hasPermission,
    hasAnyPermission
  }), [hasAnyPermission, hasPermission, hasRole, isBootstrapping, login, logout, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
