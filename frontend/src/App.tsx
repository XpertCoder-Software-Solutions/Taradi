import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";

const DashboardLayout = lazy(() => import("./components/layout/DashboardLayout").then((module) => ({ default: module.DashboardLayout })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const OverviewPage = lazy(() => import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage").then((module) => ({ default: module.EmployeesPage })));
const CustomersPage = lazy(() => import("./pages/CustomersPage").then((module) => ({ default: module.CustomersPage })));
const InboxPage = lazy(() => import("./pages/InboxPage").then((module) => ({ default: module.InboxPage })));
const CampaignsPage = lazy(() => import("./pages/CampaignsPage").then((module) => ({ default: module.CampaignsPage })));
const WhatsappTemplatesPage = lazy(() => import("./pages/WhatsappTemplatesPage").then((module) => ({ default: module.WhatsappTemplatesPage })));
const TemplateMappingsPage = lazy(() => import("./pages/TemplateMappingsPage").then((module) => ({ default: module.TemplateMappingsPage })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));
const PermissionsSettingsPage = lazy(() => import("./pages/PermissionsSettingsPage").then((module) => ({ default: module.PermissionsSettingsPage })));
const NotificationSettingsPage = lazy(() => import("./pages/NotificationSettingsPage").then((module) => ({ default: module.NotificationSettingsPage })));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-600" aria-busy="true">
      جاري التحميل...
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
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
            <Route element={<ProtectedRoute permissions={["templates.view"]} />}>
              <Route path="whatsapp-templates" element={<WhatsappTemplatesPage />} />
            </Route>
            <Route element={<ProtectedRoute roles={["ADMIN"]} />}>
              <Route path="whatsapp-template-mappings" element={<TemplateMappingsPage />} />
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
    </Suspense>
  );
}
