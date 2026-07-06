import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Role } from "../../types/api";
import { LoadingState } from "../ui/States";
import { useAuth } from "../../contexts/AuthContext";

export function ProtectedRoute({ roles, permissions }: { roles?: Role[]; permissions?: string[] }) {
  const { isAuthenticated, isBootstrapping, hasRole, hasAnyPermission } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return <LoadingState label="جاري فتح لوحة التحكم..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!hasRole(roles) || !hasAnyPermission(permissions)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
