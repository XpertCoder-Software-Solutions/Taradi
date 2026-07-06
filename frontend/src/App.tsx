import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { CustomersPage } from "./pages/CustomersPage";
import { InboxPage } from "./pages/InboxPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PermissionsSettingsPage } from "./pages/PermissionsSettingsPage";
import { NotificationSettingsPage } from "./pages/NotificationSettingsPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route element={<ProtectedRoute permissions={["customers.view_assigned", "customers.view_team"]} />}>
            <Route path="customers" element={<CustomersPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["chats.view_assigned", "chats.view_team"]} />}>
            <Route path="inbox" element={<InboxPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["employees.view_team"]} />}>
            <Route path="employees" element={<EmployeesPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["campaigns.view"]} />}>
            <Route path="campaigns" element={<CampaignsPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={["ADMIN"]} />}>
            <Route path="settings/permissions" element={<PermissionsSettingsPage />} />
          </Route>
          <Route path="settings/notifications" element={<NotificationSettingsPage />} />
        </Route>
      </Route>
      <Route path="/403" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
