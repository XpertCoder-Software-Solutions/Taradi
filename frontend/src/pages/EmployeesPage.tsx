import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Download, Edit2, Power, PowerOff, RefreshCw, Search, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { activateEmployee, createEmployee, deactivateEmployee, listEmployees, updateEmployee } from "../api/employees.api";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody } from "../components/ui/Card";
import { FieldShell, Input } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { cn } from "../lib/cn";
import { translateApiError } from "../lib/i18n";
import { showTaradiAlert, showTaradiConfirm } from "../lib/sweetAlert";
import type { Role, User } from "../types/api";

type StaffRole = Extract<Role, "SUPERVISOR" | "EMPLOYEE">;
type ActiveFilter = "" | "true" | "false";

const employeeSchema = z.object({
  employeeName: z.string().trim(),
  employeeCode: z.string().trim().optional(),
  email: z.string().trim().optional().refine((value) => {
    return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }, "البريد الإلكتروني غير صحيح"),
  role: z.enum(["SUPERVISOR", "EMPLOYEE"]),
  supervisorId: z.string().optional(),
  password: z.string().optional(),
  isActive: z.boolean().optional()
}).superRefine((values, context) => {
  if (!values.employeeName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["employeeName"],
      message: values.role === "SUPERVISOR" ? "اسم المشرف مطلوب" : "اسم الموظف مطلوب"
    });
  }

  if (values.role === "SUPERVISOR" && !values.email) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["email"],
      message: "البريد الإلكتروني مطلوب"
    });
  }

  if (values.role === "EMPLOYEE" && !values.employeeCode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["employeeCode"],
      message: "كود الموظف مطلوب"
    });
  }

  if (values.role === "EMPLOYEE" && !values.supervisorId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supervisorId"],
      message: "اسم المشرف مطلوب"
    });
  }
});

type EmployeeValues = z.infer<typeof employeeSchema>;

const defaultValues: EmployeeValues = {
  employeeName: "",
  employeeCode: "",
  email: "",
  role: "EMPLOYEE",
  supervisorId: "",
  password: "",
  isActive: true
};

const pageSizeOptions = [10, 25, 50, 100];
const supervisorEmailDomain = "@tradi.com";

type SelectOption = {
  value: string;
  label: string;
};

const employeeColumns = [
  { key: "employeeCode", label: "كود الموظف" },
  { key: "fullName", label: "اسم الموظف" },
  { key: "supervisorName", label: "اسم المشرف" },
  { key: "assignedCustomersCount", label: "عدد العملاء" },
  { key: "isActive", label: "حالة الحساب" },
  { key: "createdAt", label: "تاريخ إنشاء الحساب" },
  { key: "actions", label: "الإجراءات" }
] as const;

const supervisorColumns = [
  { key: "fullName", label: "اسم المشرف" },
  { key: "email", label: "البريد الإلكتروني" },
  { key: "directReportsCount", label: "عدد الموظفين" },
  { key: "assignedCustomersCount", label: "عدد العملاء" },
  { key: "isActive", label: "حالة الحساب" },
  { key: "createdAt", label: "تاريخ إنشاء الحساب" },
  { key: "actions", label: "الإجراءات" }
] as const;

type ColumnKey = typeof employeeColumns[number]["key"] | typeof supervisorColumns[number]["key"];

const tableHeadCellClass = "px-1.5 py-3 text-center align-middle text-[11px] leading-5 sm:px-2 md:px-3";
const tableCellClass = "overflow-hidden px-1.5 py-3 text-center align-middle sm:px-2 md:px-3";

function formatDateOnly(value?: string | null) {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function employeeName(employee: User) {
  return employee.fullName || employee.name;
}

function getSupervisorEmailName(email?: string | null) {
  const value = String(email || "").trim();

  if (!value) {
    return "";
  }

  if (value.toLowerCase().endsWith(supervisorEmailDomain)) {
    return value.slice(0, -supervisorEmailDomain.length);
  }

  return value.split("@")[0] || value;
}

function buildSupervisorEmailName(value: string) {
  return value.trim().split("@")[0].toLowerCase();
}

function buildSupervisorEmail(value: string) {
  const emailName = buildSupervisorEmailName(value);
  return emailName ? `${emailName}${supervisorEmailDomain}` : "";
}

function assignedCount(employee: User) {
  return employee.assignedCustomersCount ?? employee._count?.assignedCustomers ?? 0;
}

function directReportsCount(employee: User) {
  return employee.directReportsCount ?? employee._count?.directReports ?? 0;
}

function supervisorLabel(employee: User) {
  if (employee.role === "SUPERVISOR") {
    return "—";
  }

  return employee.supervisorName || employee.supervisor?.name || "—";
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge tone="green" className="max-w-full justify-center whitespace-normal text-center leading-5">🟢 نشط</Badge>
  ) : (
    <Badge tone="red" className="max-w-full justify-center whitespace-normal text-center leading-5">🔴 معطل</Badge>
  );
}

function parseDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatExactDateTime(value?: string | null) {
  const date = parseDate(value);

  if (!date) {
    return "لا يوجد آخر ظهور";
  }

  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function isYesterday(date: Date, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return isSameDay(date, yesterday);
}

function getLastSeenRelative(value?: string | null) {
  const date = parseDate(value);

  if (!date) {
    return "غير متاح";
  }

  const now = new Date();
  const diffMinutes = Math.max(Math.floor((now.getTime() - date.getTime()) / 60000), 0);

  if (diffMinutes < 1) {
    return "الآن";
  }

  if (diffMinutes === 1) {
    return "منذ دقيقة";
  }

  if (diffMinutes < 60) {
    return `منذ ${diffMinutes} دقيقة`;
  }

  if (diffMinutes < 120) {
    return "منذ ساعة";
  }

  if (diffMinutes < 180) {
    return "منذ ساعتين";
  }

  if (isSameDay(date, now)) {
    return "اليوم";
  }

  if (isYesterday(date, now)) {
    return "أمس";
  }

  return formatDateOnly(value);
}

function ConnectionStatusBadge({ employee }: { employee: User }) {
  if (employee.isOnline) {
    return (
      <div title="متصل الآن" className="space-y-1">
        <Badge className="max-w-full justify-center whitespace-normal bg-mint-100 text-center leading-5 text-mint-800">
          متصل الآن
        </Badge>
      </div>
    );
  }

  const tooltip = formatExactDateTime(employee.lastSeenAt);

  return (
    <div title={tooltip} className="space-y-1">
      <Badge className="max-w-full justify-center whitespace-normal bg-surface-100 text-center leading-5 text-ink-600">
        غير متصل
      </Badge>
      <p className="text-[10px] font-black leading-4 text-ink-700">
        آخر ظهور: {getLastSeenRelative(employee.lastSeenAt)}
      </p>
    </div>
  );
}

function IconButton({
  label,
  children,
  variant = "secondary",
  disabled,
  onClick
}: {
  label: string;
  children: ReactNode;
  variant?: "secondary" | "danger" | "soft";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={variant}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 rounded-lg md:h-9 md:w-9 md:rounded-xl"
    >
      {children}
    </Button>
  );
}

function PremiumSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={selectId}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-surface-200 bg-white px-3 text-sm font-bold text-ink-900 shadow-sm outline-none transition hover:border-mint-100 hover:bg-mint-50/50 focus:border-mint-700 focus:ring-4 focus:ring-mint-100 disabled:cursor-not-allowed disabled:bg-surface-50 disabled:text-ink-400",
          open && "border-mint-700 bg-mint-50/60 ring-4 ring-mint-100"
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate text-right">{selected?.label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-mint-800 transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          id={selectId}
          role="listbox"
          className="absolute right-0 top-12 z-40 w-full min-w-[160px] overflow-hidden rounded-2xl border border-mint-100 bg-white p-1.5 text-right shadow-[0_20px_55px_rgba(15,23,42,0.16)] ring-1 ring-black/5"
        >
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {options.map((option) => {
              const active = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-right text-sm font-bold transition",
                    active ? "bg-mint-50 text-mint-900" : "text-ink-700 hover:bg-surface-50 hover:text-ink-900"
                  )}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <span className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-white transition",
                    active ? "border-mint-700 bg-mint-700" : "border-surface-200 bg-white"
                  )}>
                    {active ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmployeeTableSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 8 }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-5 gap-2 md:grid-cols-10 md:gap-3">
          {Array.from({ length: 10 }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className="h-10" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmployeesPage() {
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [activeTab, setActiveTab] = useState<StaffRole>("SUPERVISOR");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("");
  const [supervisorFilter, setSupervisorFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(
    () => Object.fromEntries([...employeeColumns, ...supervisorColumns].map((column) => [column.key, true])) as Record<ColumnKey, boolean>
  );
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const activeColumns = activeTab === "SUPERVISOR" ? supervisorColumns : employeeColumns;

  useEffect(() => {
    if (!isAdmin && activeTab === "SUPERVISOR") {
      setActiveTab("EMPLOYEE");
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    setPage(1);
  }, [search, activeTab, activeFilter, supervisorFilter, pageSize]);

  useEffect(() => {
    if (activeTab === "SUPERVISOR" && supervisorFilter) {
      setSupervisorFilter("");
    }
  }, [activeTab, supervisorFilter]);

  const employeesQuery = useQuery({
    queryKey: ["employees", { search, activeTab, activeFilter, supervisorFilter, page, pageSize }],
    queryFn: () => listEmployees({
      page,
      limit: pageSize,
      search,
      role: activeTab,
      isActive: activeFilter === "" ? "" : activeFilter === "true",
      supervisorId: activeTab === "EMPLOYEE" ? supervisorFilter || undefined : undefined
    })
  });

  const supervisorsQuery = useQuery({
    queryKey: ["employees", "supervisors"],
    queryFn: () => listEmployees({ limit: 100, role: "SUPERVISOR", isActive: true }),
    enabled: isAdmin
  });

  const form = useForm<EmployeeValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues
  });
  const selectedRole = form.watch("role");

  useEffect(() => {
    if (selectedRole === "SUPERVISOR") {
      form.setValue("supervisorId", "");
    }
  }, [form, selectedRole]);

  const saveMutation = useMutation({
    mutationFn: async (values: EmployeeValues) => {
      const role = values.role;
      const basePayload = {
        employeeName: values.employeeName,
        ...(values.password ? { password: values.password } : {}),
        ...(editing ? { isActive: values.isActive } : {})
      };
      const payload = role === "SUPERVISOR"
        ? {
          ...basePayload,
          role,
          email: buildSupervisorEmail(getSupervisorEmailName(values.email)) || null,
          supervisorId: null
        }
        : {
          ...basePayload,
          role,
          employeeCode: values.employeeCode || "",
          supervisorId: values.supervisorId || null
        };

      if (editing) {
        return updateEmployee(editing.id, payload);
      }

      return createEmployee({
        ...payload,
        password: values.password || ""
      });
    },
    onSuccess: () => {
      const wasEditing = Boolean(editing);
      const savedRole = form.getValues("role");
      form.reset(defaultValues);
      setEditing(null);
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      if (wasEditing) {
        void showTaradiAlert({
          title: savedRole === "SUPERVISOR" ? "تم تعديل بيانات المشرف بنجاح" : "تم تعديل بيانات الموظف بنجاح",
          icon: "success"
        });
        return;
      }

      void showTaradiAlert({
        title: savedRole === "SUPERVISOR" ? "تم إضافة المشرف بنجاح" : "تم إضافة الموظف بنجاح",
        icon: "success"
      });
    },
    onError: (error) => pushToast({ title: "حدث خطأ أثناء تنفيذ العملية", description: translateApiError(error), tone: "error" })
  });

  const statusMutation = useMutation({
    mutationFn: ({ employee, action }: { employee: User; action: "activate" | "deactivate" }) => {
      return action === "activate" ? activateEmployee(employee.id) : deactivateEmployee(employee.id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      const roleLabel = variables.employee.role === "SUPERVISOR" ? "المشرف" : "الموظف";
      pushToast({
        title: variables.action === "activate" ? `تم تفعيل حساب ${roleLabel}` : `تم تعطيل حساب ${roleLabel}`,
        tone: "success"
      });
    },
    onError: (error) => pushToast({ title: "حدث خطأ أثناء تنفيذ العملية", description: translateApiError(error), tone: "error" })
  });

  const employees = employeesQuery.data?.items || [];
  const total = employeesQuery.data?.meta.total || 0;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const hasActiveSearch = Boolean(search || activeFilter || supervisorFilter);
  const canCreate = hasPermission("employees.create") && isAdmin;
  const canEdit = hasPermission("employees.edit") && isAdmin;
  const canToggle = hasPermission("employees.activate_deactivate") && isAdmin;
  const visibleColumnCount = activeColumns.filter((column) => visibleColumns[column.key]).length;
  const isSupervisorForm = selectedRole === "SUPERVISOR";
  const staffLabel = isSupervisorForm ? "المشرف" : "الموظف";
  const modalTitle = isSupervisorForm
    ? editing ? "تعديل بيانات المشرف" : "إضافة مشرف"
    : editing ? "تعديل بيانات الموظف" : "إضافة موظف";
  const modalDescription = editing
    ? "اترك كلمة المرور فارغة إذا لم ترغب في تغييرها"
    : isSupervisorForm
      ? "أدخل بيانات حساب المشرف ليتمكن من الدخول بالبريد الإلكتروني."
      : "أدخل بيانات حساب الموظف واربطه بالمشرف المسؤول.";
  const emptyTitle = activeTab === "SUPERVISOR"
    ? hasActiveSearch ? "لا يوجد مشرفون مطابقون لنتائج البحث" : "لا يوجد مشرفون"
    : hasActiveSearch ? "لا يوجد موظفون مطابقون لنتائج البحث" : "لا يوجد موظفون";

  function openCreateModal() {
    setEditing(null);
    form.reset({
      ...defaultValues,
      role: activeTab,
      isActive: true
    });
    setModalOpen(true);
  }

  function openEditModal(employee: User) {
    setEditing(employee);
    form.reset({
      employeeName: employeeName(employee),
      employeeCode: employee.employeeCode || "",
      email: employee.role === "SUPERVISOR" ? buildSupervisorEmail(getSupervisorEmailName(employee.email)) : employee.email || "",
      role: employee.role === "SUPERVISOR" ? "SUPERVISOR" : "EMPLOYEE",
      supervisorId: employee.supervisorId || "",
      password: "",
      isActive: employee.isActive
    });
    setModalOpen(true);
  }

  function submit(values: EmployeeValues) {
    if (!editing && !values.password) {
      form.setError("password", { message: "كلمة المرور مطلوبة عند الإنشاء" });
      return;
    }

    saveMutation.mutate(values);
  }

  async function confirmStatusAction(employee: User, action: "activate" | "deactivate") {
    const isActivate = action === "activate";
    const roleLabel = employee.role === "SUPERVISOR" ? "المشرف" : "الموظف";
    const result = await showTaradiConfirm({
      title: isActivate ? `تفعيل حساب ${roleLabel}؟` : `تعطيل حساب ${roleLabel}؟`,
      text: isActivate ? `سيتمكن ${roleLabel} من تسجيل الدخول مرة أخرى.` : `لن يتمكن ${roleLabel} من تسجيل الدخول أو استخدام النظام.`,
      icon: isActivate ? "question" : "warning",
      confirmButtonText: isActivate ? "نعم، تفعيل" : "نعم، تعطيل",
      tone: isActivate ? "primary" : "danger"
    });

    if (result.isConfirmed) {
      statusMutation.mutate({ employee, action });
    }
  }

  function exportCurrentRows() {
    const header = activeColumns
      .filter((column) => column.key !== "actions")
      .map((column) => column.label);
    const rows = employees.map((employee) => activeTab === "SUPERVISOR"
      ? [
        employeeName(employee),
        employee.email || "",
        directReportsCount(employee),
        assignedCount(employee),
        employee.isActive ? "نشط" : "معطل",
        formatDateOnly(employee.createdAt)
      ]
      : [
        employee.employeeCode || "",
        employeeName(employee),
        supervisorLabel(employee),
        assignedCount(employee),
        employee.isActive ? "نشط" : "معطل",
        formatDateOnly(employee.createdAt)
      ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "taradi-employees.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="إدارة الفريق"
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="inline-flex rounded-2xl border border-surface-200 bg-surface-50 p-1 shadow-sm">
            {isAdmin ? (
              <button
                type="button"
                className={cn(
                  "h-10 rounded-xl px-5 text-sm font-black transition",
                  activeTab === "SUPERVISOR" ? "bg-mint-700 text-white shadow-glow" : "text-ink-700 hover:bg-white"
                )}
                onClick={() => setActiveTab("SUPERVISOR")}
              >
                المشرفون
              </button>
            ) : null}
            <button
              type="button"
              className={cn(
                "h-10 rounded-xl px-5 text-sm font-black transition",
                activeTab === "EMPLOYEE" ? "bg-mint-700 text-white shadow-glow" : "text-ink-700 hover:bg-white"
              )}
              onClick={() => setActiveTab("EMPLOYEE")}
            >
              الموظفون
            </button>
          </div>

          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,300px)_auto] xl:items-center">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input
                className="pr-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeTab === "SUPERVISOR" ? "ابحث باسم المشرف أو البريد الإلكتروني" : "ابحث باسم الموظف أو الكود"}
              />
            </div>

            <div className={cn("grid min-w-0 gap-2", activeTab === "EMPLOYEE" && isAdmin ? "sm:grid-cols-2 xl:grid-cols-[150px_minmax(0,150px)]" : "xl:grid-cols-[150px]")}>
              <PremiumSelect
                value={activeFilter}
                ariaLabel="الحالة"
                options={[
                  { value: "", label: "الحالة" },
                  { value: "true", label: "نشط" },
                  { value: "false", label: "معطل" }
                ]}
                onChange={(nextValue) => setActiveFilter(nextValue as ActiveFilter)}
              />
              {isAdmin && activeTab === "EMPLOYEE" ? (
                <PremiumSelect
                  value={supervisorFilter}
                  ariaLabel="المشرف"
                  options={[
                    { value: "", label: "المشرف" },
                    ...(supervisorsQuery.data?.items.map((supervisor) => ({
                      value: supervisor.id,
                      label: employeeName(supervisor)
                    })) || [])
                  ]}
                  onChange={setSupervisorFilter}
                />
              ) : null}
            </div>

            <div className="flex min-w-0 items-center justify-start gap-2 overflow-hidden xl:justify-end">
              {canCreate ? <Button className="px-3" icon={<UserPlus className="h-4 w-4" />} onClick={openCreateModal}>{activeTab === "SUPERVISOR" ? "إضافة مشرف" : "إضافة موظف"}</Button> : null}
              <Button className="px-3" variant="secondary" icon={<RefreshCw className={cn("h-4 w-4", employeesQuery.isFetching && "animate-spin")} />} onClick={() => employeesQuery.refetch()}>
                تحديث
              </Button>
              <Button className="px-3" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCurrentRows} disabled={employees.length === 0}>
                تصدير Excel
              </Button>
            </div>
          </div>
        </CardBody>

        <div className="max-h-[68vh] overflow-y-auto overflow-x-hidden border-t border-surface-200">
          <table className="w-full table-fixed border-separate border-spacing-0 text-right text-[11px] sm:text-xs md:text-sm">
            <colgroup>
              {activeTab === "SUPERVISOR" ? (
                <>
                  {visibleColumns.fullName ? <col style={{ width: "20%" }} /> : null}
                  {visibleColumns.email ? <col style={{ width: "22%" }} /> : null}
                  {visibleColumns.directReportsCount ? <col style={{ width: "12%" }} /> : null}
                  {visibleColumns.assignedCustomersCount ? <col style={{ width: "12%" }} /> : null}
                  {visibleColumns.isActive ? <col style={{ width: "10%" }} /> : null}
                  {visibleColumns.createdAt ? <col style={{ width: "12%" }} /> : null}
                  {visibleColumns.actions ? <col style={{ width: "12%" }} /> : null}
                </>
              ) : (
                <>
                  {visibleColumns.employeeCode ? <col style={{ width: "13%" }} /> : null}
                  {visibleColumns.fullName ? <col style={{ width: "20%" }} /> : null}
                  {visibleColumns.supervisorName ? <col style={{ width: "17%" }} /> : null}
                  {visibleColumns.assignedCustomersCount ? <col style={{ width: "14%" }} /> : null}
                  {visibleColumns.isActive ? <col style={{ width: "10%" }} /> : null}
                  {visibleColumns.createdAt ? <col style={{ width: "13%" }} /> : null}
                  {visibleColumns.actions ? <col style={{ width: "13%" }} /> : null}
                </>
              )}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface-50 text-xs font-black text-ink-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
              <tr>
                {activeColumns.map((column) => visibleColumns[column.key] ? (
                  <th key={column.key} className={tableHeadCellClass}>{column.label}</th>
                ) : null)}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200 bg-white">
              {employeesQuery.isLoading ? (
                <tr>
                  <td colSpan={visibleColumnCount}>
                    <EmployeeTableSkeleton />
                  </td>
                </tr>
              ) : null}
              {employeesQuery.error ? (
                <tr>
                  <td colSpan={visibleColumnCount}>
                    <ErrorState error={employeesQuery.error} />
                  </td>
                </tr>
              ) : null}
              {!employeesQuery.isLoading && !employeesQuery.error && employees.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumnCount}>
                    <EmptyState title={emptyTitle} />
                  </td>
                </tr>
              ) : null}
              {!employeesQuery.isLoading && !employeesQuery.error ? employees.map((employee) => (
                <tr key={employee.id} className="group transition hover:bg-mint-50/45">
                  {activeTab === "SUPERVISOR" ? (
                    <>
                      {visibleColumns.fullName ? (
                        <td className={tableCellClass}>
                          <p className="break-words font-black leading-6 text-ink-900">{employeeName(employee)}</p>
                        </td>
                      ) : null}
                      {visibleColumns.email ? (
                        <td className={cn(tableCellClass, "break-all font-semibold text-ink-700")} dir="ltr">{employee.email || "—"}</td>
                      ) : null}
                      {visibleColumns.directReportsCount ? (
                        <td className={tableCellClass}>
                          <span className="inline-flex max-w-full justify-center px-1.5 py-1 text-xs font-black sm:px-2 md:text-sm">
                            {directReportsCount(employee)}
                          </span>
                        </td>
                      ) : null}
                      {visibleColumns.assignedCustomersCount ? (
                        <td className={tableCellClass}>
                          <span className="inline-flex max-w-full justify-center px-1.5 py-1 text-xs font-black sm:px-2 md:text-sm">
                            {assignedCount(employee)}
                          </span>
                        </td>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {visibleColumns.employeeCode ? (
                        <td className={tableCellClass}>
                          <span className="block break-all px-1 font-black text-ink-900 sm:px-2">
                            <span dir="ltr">{employee.employeeCode || "-"}</span>
                          </span>
                        </td>
                      ) : null}
                      {visibleColumns.fullName ? (
                        <td className={tableCellClass}>
                          <p className="break-words font-black leading-6 text-ink-900">{employeeName(employee)}</p>
                        </td>
                      ) : null}
                      {visibleColumns.supervisorName ? (
                        <td className={cn(tableCellClass, "break-words font-semibold leading-6 text-ink-700")}>{supervisorLabel(employee)}</td>
                      ) : null}
                      {visibleColumns.assignedCustomersCount ? (
                        <td className={tableCellClass}>
                          <span className="inline-flex max-w-full justify-center px-1.5 py-1 text-xs font-black sm:px-2 md:text-sm">
                            {assignedCount(employee)}
                          </span>
                        </td>
                      ) : null}
                    </>
                  )}
                  {visibleColumns.isActive ? (
                    <td className={tableCellClass}><StatusBadge isActive={employee.isActive} /></td>
                  ) : null}
                  {visibleColumns.createdAt ? (
                    <td className={cn(tableCellClass, "break-all font-medium text-ink-500")} dir="ltr">{formatDateOnly(employee.createdAt)}</td>
                  ) : null}
                  {visibleColumns.actions ? (
                    <td className={tableCellClass}>
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        {canEdit ? (
                          <IconButton label="تعديل" onClick={() => openEditModal(employee)}>
                            <Edit2 className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                        {canToggle ? employee.isActive ? (
                          <IconButton
                            label="تعطيل الحساب"
                            variant="danger"
                            disabled={statusMutation.isPending}
                            onClick={() => confirmStatusAction(employee, "deactivate")}
                          >
                            <PowerOff className="h-4 w-4" />
                          </IconButton>
                        ) : (
                          <IconButton
                            label="تفعيل الحساب"
                            variant="soft"
                            disabled={statusMutation.isPending}
                            onClick={() => confirmStatusAction(employee, "activate")}
                          >
                            <Power className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              )) : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-surface-200 bg-surface-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-600">
            <span>عرض</span>
            <PremiumSelect
              className="w-24"
              value={String(pageSize)}
              ariaLabel="عدد الصفوف"
              options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
              onChange={(nextValue) => setPageSize(Number(nextValue))}
            />
            <span>صف</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs shadow-sm">{total} إجمالي</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" disabled={page <= 1 || employeesQuery.isFetching} onClick={() => setPage((value) => Math.max(value - 1, 1))}>
              السابق
            </Button>
            <span className="rounded-xl bg-white px-3 py-2 text-sm font-black text-ink-800 shadow-sm">
              {page} / {totalPages}
            </span>
            <Button variant="secondary" disabled={page >= totalPages || employeesQuery.isFetching} onClick={() => setPage((value) => Math.min(value + 1, totalPages))}>
              التالي
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={isModalOpen}
        title={modalTitle}
        description={modalDescription}
        onClose={() => setModalOpen(false)}
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button type="submit" form="employee-form" disabled={saveMutation.isPending} icon={<ShieldCheck className="h-4 w-4" />}>
              {editing ? "حفظ التغييرات" : `إضافة ${staffLabel}`}
            </Button>
          </div>
        )}
      >
        <form id="employee-form" className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          <FieldShell label={`اسم ${staffLabel}`} error={form.formState.errors.employeeName?.message}>
            <Input {...form.register("employeeName")} placeholder={`اسم ${staffLabel}`} />
          </FieldShell>

          {isSupervisorForm ? (
            <FieldShell label="البريد الإلكتروني" error={form.formState.errors.email?.message}>
              <input type="hidden" {...form.register("email")} />
              <div className="flex h-11 overflow-hidden rounded-xl border border-surface-200 bg-white text-sm shadow-sm transition hover:border-neutral-300 focus-within:border-mint-700 focus-within:ring-4 focus-within:ring-mint-100" dir="ltr">
                <input
                  type="text"
                  value={getSupervisorEmailName(form.watch("email"))}
                  onChange={(event) => form.setValue("email", buildSupervisorEmail(event.target.value), {
                    shouldDirty: true,
                    shouldValidate: true
                  })}
                  placeholder="supervisor"
                  autoComplete="username"
                  className="min-w-0 flex-1 border-0 bg-transparent px-3 text-left text-sm text-ink-900 outline-none placeholder:text-ink-400"
                />
                <span className="grid shrink-0 place-items-center border-l border-surface-200 bg-surface-50 px-3 text-sm font-black text-mint-800">
                  {supervisorEmailDomain}
                </span>
              </div>
            </FieldShell>
          ) : (
            <>
              <FieldShell label="كود الموظف" error={form.formState.errors.employeeCode?.message}>
                <Input {...form.register("employeeCode")} placeholder="EMP001" dir="ltr" />
              </FieldShell>
              <FieldShell label="اسم المشرف" error={form.formState.errors.supervisorId?.message}>
                <PremiumSelect
                  value={form.watch("supervisorId") || ""}
                  ariaLabel="اسم المشرف"
                  options={[
                    { value: "", label: "اختر المشرف" },
                    ...(supervisorsQuery.data?.items.map((supervisor) => ({
                      value: supervisor.id,
                      label: employeeName(supervisor)
                    })) || [])
                  ]}
                  onChange={(nextValue) => form.setValue("supervisorId", nextValue, {
                    shouldDirty: true,
                    shouldValidate: true
                  })}
                />
              </FieldShell>
            </>
          )}

          <FieldShell label="كلمة المرور" error={form.formState.errors.password?.message}>
            <Input
              type="password"
              {...form.register("password")}
              placeholder={editing ? "اتركها فارغة إذا لم ترغب في تغييرها" : "كلمة المرور"}
            />
          </FieldShell>
          {editing ? (
            <FieldShell label="الحالة">
              <PremiumSelect
                value={form.watch("isActive") ? "true" : "false"}
                ariaLabel="الحالة"
                options={[
                  { value: "true", label: "نشط" },
                  { value: "false", label: "معطل" }
                ]}
                onChange={(nextValue) => form.setValue("isActive", nextValue === "true", {
                  shouldDirty: true,
                  shouldValidate: true
                })}
              />
            </FieldShell>
          ) : null}
        </form>
      </Modal>

    </div>
  );
}
