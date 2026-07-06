import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BriefcaseBusiness,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  Users,
  X
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getUnreadSummary } from "../../api/notifications.api";
import { cn } from "../../lib/cn";
import { showTaradiConfirm } from "../../lib/sweetAlert";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { roleLabel } from "../../lib/i18n";
import { RealtimeStatus } from "../inbox/RealtimeStatus";
import type { Role } from "../../types/api";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: Role[];
  permissions?: string[];
};

const navConfig: NavItem[] = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard },
  { to: "/employees", label: "الفريق", icon: Users, permissions: ["employees.view_team"] },
  { to: "/customers", label: "العملاء", icon: BriefcaseBusiness, permissions: ["customers.view_assigned", "customers.view_team"] },
  { to: "/campaigns", label: "الحملات الجماعية", icon: Megaphone, permissions: ["campaigns.view"] },
  { to: "/inbox", label: "المحادثات", icon: Inbox, permissions: ["chats.view_assigned", "chats.view_team"] },
  { to: "/notifications", label: "الإشعارات", icon: Bell, permissions: ["chats.view_assigned", "chats.view_team"] },
  { to: "/settings/notifications", label: "إعدادات الإشعارات", icon: Bell },
  { to: "/settings/permissions", label: "الإعدادات", icon: Settings, roles: ["ADMIN"] }
];

export function DashboardLayout() {
  const { user, logout, hasAnyPermission, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const navItems = navConfig.filter((item) => hasRole(item.roles) && hasAnyPermission(item.permissions));
  const activeItem = [...navConfig]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to));

  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: getUnreadSummary,
    enabled: Boolean(user)
  });

  const unreadCount = unreadQuery.data?.unreadTotal || 0;

  useEffect(() => {
    const baseTitle = "تراضي لإدارة محادثات واتساب";
    document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;

    return () => {
      document.title = baseTitle;
    };
  }, [unreadCount]);

  const requestBrowserNotificationPermission = async () => {
    if (!("Notification" in window) || Notification.permission !== "default") {
      return;
    }

    try {
      await Notification.requestPermission();
    } catch {
      // إشعارات المتصفح اختيارية، وتظل مؤشرات التطبيق تعمل بدونها.
    }
  };

  const openNotifications = () => {
    void requestBrowserNotificationPermission();
    navigate("/notifications");
  };

  const confirmLogout = async () => {
    const result = await showTaradiConfirm({
      title: "تسجيل الخروج؟",
      text: "سيتم إنهاء جلستك الحالية وفصل الاتصال الفوري.",
      icon: "question",
      confirmButtonText: "نعم، تسجيل الخروج",
      tone: "primary"
    });

    if (result.isConfirmed) {
      await logout();
    }
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <div className="lg:hidden">
        <div className="flex h-16 items-center justify-between border-b border-white/70 bg-white/90 px-4 shadow-sm backdrop-blur">
          <button onClick={() => setSidebarOpen(true)} className="rounded-xl p-2 text-ink-700 hover:bg-surface-100" aria-label="فتح القائمة">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-mint-700 text-sm font-black text-white">ت</div>
            <div>
              <p className="text-sm font-black text-ink-900">تراضي</p>
              <p className="text-[11px] text-ink-500">إدارة محادثات</p>
            </div>
          </div>
          <button onClick={openNotifications} className="relative rounded-xl p-2 text-ink-700 hover:bg-surface-100" aria-label="الإشعارات">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-signal-red" /> : null}
          </button>
        </div>
      </div>

      <aside className={cn(
        "fixed inset-y-0 right-0 z-40 w-72 border-l border-white/70 bg-white/90 shadow-soft backdrop-blur transition lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "translate-x-full"
      )}>
        <div className="flex h-20 items-center justify-between border-b border-surface-200 px-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-3xl bg-gradient-to-br from-mint-900 to-mint-500 text-lg font-black text-white shadow-glow">
              ت
            </div>
            <div>
              <p className="text-lg font-black text-ink-900">تراضي</p>
              <p className="text-xs font-medium text-ink-500">إدارة محادثات واتساب</p>
            </div>
          </div>
          <button className="rounded-xl p-2 text-ink-700 hover:bg-surface-100 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-1.5 px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => cn(
                "group flex h-12 items-center gap-3 rounded-2xl px-3 text-sm font-bold transition duration-200",
                isActive ? "bg-mint-700 text-white shadow-glow" : "text-ink-700 hover:bg-mint-50 hover:text-mint-800"
              )}
            >
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/0 transition group-hover:bg-white/70">
                <item.icon className="h-4 w-4" />
              </span>
              <span className="flex-1">{item.label}</span>
              {item.to === "/inbox" && unreadCount > 0 ? (
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-signal-red" />
                  <Badge tone="red">{unreadCount}</Badge>
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-4 left-3 right-3 rounded-2xl border border-surface-200 bg-surface-50 p-3">
          <p className="text-sm font-bold text-ink-900">{user?.name}</p>
          <p className="mt-1 text-xs text-ink-500">{user?.role ? roleLabel[user.role] : ""}</p>
          <p className="mt-3 border-t border-surface-200 pt-3 text-[11px] font-semibold text-ink-500" dir="ltr">
            Powered by XpertCoder Software Solutions
          </p>
        </div>
      </aside>

      {isSidebarOpen ? (
        <button
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          aria-label="إغلاق القائمة"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <main className="lg:pr-72">
        <header className="sticky top-0 z-20 hidden h-20 items-center justify-between border-b border-white/70 bg-white/85 px-6 shadow-sm backdrop-blur lg:flex">
          <div>
            <p className="text-lg font-black text-ink-900">{activeItem?.label || "لوحة التحكم"}</p>
            <p className="mt-1 text-xs text-ink-500">مساحة عمل تراضي لإدارة محادثات واتساب</p>
          </div>
          <div className="flex items-center gap-3">
            <RealtimeStatus />
            <div className="rounded-2xl bg-surface-50 px-3 py-2">
              <p className="text-sm font-bold text-ink-900">{user?.name}</p>
              <p className="text-[11px] text-ink-500">{user?.role ? roleLabel[user.role] : ""}</p>
            </div>
            <button onClick={openNotifications} className="relative rounded-xl border border-surface-200 bg-white p-2 text-ink-700 shadow-sm hover:bg-mint-50" aria-label="الإشعارات">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 ? <Badge tone="red" className="absolute -right-2 -top-2">{unreadCount}</Badge> : null}
            </button>
            <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => { void confirmLogout(); }}>تسجيل الخروج</Button>
          </div>
        </header>
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
