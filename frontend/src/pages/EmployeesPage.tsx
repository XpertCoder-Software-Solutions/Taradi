import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Download, Edit2, FileSpreadsheet, Power, PowerOff, RefreshCw, Search, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { activateEmployee, createEmployee, deactivateEmployee, downloadEmployeeImportTemplate, downloadUserImportTemplate, importEmployeesExcel, importUsersExcel, listEmployees, updateEmployee, type UserImportResult } from "../api/employees.api";
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
import { debugLog } from "../lib/debug";
import { translateApiError } from "../lib/i18n";
import { showTaradiAlert, showTaradiConfirm } from "../lib/sweetAlert";
import type { EmployeeImportSummary, Role, User } from "../types/api";

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

  if (values.password && values.password.length < 8) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["password"],
      message: "كلمة المرور يجب ألا تقل عن 8 أحرف"
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
  { key: "isOnline", label: "حالة الاتصال" },
  { key: "lastSeenAt", label: "آخر ظهور" },
  { key: "createdAt", label: "تاريخ إنشاء الحساب" },
  { key: "actions", label: "الإجراءات" }
] as const;

const supervisorColumns = [
  { key: "fullName", label: "اسم المشرف" },
  { key: "email", label: "البريد الإلكتروني" },
  { key: "directReportsCount", label: "عدد الموظفين" },
  { key: "assignedCustomersCount", label: "عدد العملاء" },
  { key: "isActive", label: "حالة الحساب" },
  { key: "isOnline", label: "حالة الاتصال" },
  { key: "lastSeenAt", label: "آخر ظهور" },
  { key: "createdAt", label: "تاريخ إنشاء الحساب" },
  { key: "actions", label: "الإجراءات" }
] as const;

type ColumnKey = typeof employeeColumns[number]["key"] | typeof supervisorColumns[number]["key"];

const tableHeadCellClass = "whitespace-nowrap px-2 py-3 text-center align-middle text-[11px] leading-5 sm:px-3";
const tableCellClass = "whitespace-nowrap px-2 py-3 text-center align-middle sm:px-3";

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
    <Badge tone="green" className="max-w-full justify-center text-center leading-5">🟢 نشط</Badge>
  ) : (
    <Badge tone="red" className="max-w-full justify-center text-center leading-5">🔴 معطل</Badge>
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

function formatLastSeen(value?: string | null) {
  const date = parseDate(value);

  if (!date) {
    return "آخر ظهور: غير متاح";
  }

  const now = new Date();
  const diffMinutes = Math.max(Math.floor((now.getTime() - date.getTime()) / 60000), 0);

  if (diffMinutes < 1) {
    return "آخر ظهور: منذ لحظات";
  }

  if (diffMinutes < 60) {
    return diffMinutes === 1 ? "آخر ظهور: منذ دقيقة" : `آخر ظهور: منذ ${diffMinutes} دقيقة`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24 && isSameDay(date, now)) {
    return diffHours === 1 ? "آخر ظهور: منذ ساعة" : `آخر ظهور: منذ ${diffHours} ساعة`;
  }

  if (isSameDay(date, now)) {
    return "آخر ظهور: اليوم";
  }

  if (isYesterday(date, now)) {
    return "آخر ظهور: أمس";
  }

  return `آخر ظهور: ${formatDateOnly(value)}`;
}

function ConnectionStatusBadge({ isOnline }: { isOnline?: boolean }) {
  return isOnline ? (
    <Badge className="max-w-full justify-center bg-mint-100 text-center leading-5 text-mint-800">
      متصل الآن
    </Badge>
  ) : (
    <Badge className="max-w-full justify-center bg-surface-100 text-center leading-5 text-ink-600">
      غير متصل
    </Badge>
  );
}

function LastSeenText({ employee }: { employee: User }) {
  const text = employee.isOnline ? "متصل الآن" : formatLastSeen(employee.lastSeenAt);

  return (
    <span title={employee.isOnline ? "متصل الآن" : formatExactDateTime(employee.lastSeenAt)} className="inline-block whitespace-nowrap text-xs font-black leading-5 text-ink-700">
      {text}
    </span>
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
  const [activeTab, setActiveTab] = useState<StaffRole>("EMPLOYEE");
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
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importRole, setImportRole] = useState<StaffRole>("EMPLOYEE");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<UserImportResult | EmployeeImportSummary | null>(null);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const activeColumns = activeTab === "SUPERVISOR" ? supervisorColumns : employeeColumns;
  const isSupervisor = user?.role === "SUPERVISOR";

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
  const supervisorOptions = isAdmin
    ? supervisorsQuery.data?.items || []
    : isSupervisor && user
      ? [user]
      : [];

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
      const supervisorId = isSupervisor && user ? user.id : values.supervisorId || null;
      const basePayload = {
        employeeName: values.employeeName,
        ...(values.password ? { password: values.password } : {}),
        ...(editing && canToggle ? { isActive: values.isActive } : {})
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
          supervisorId
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

      pushToast({ title: "تمت إضافة الموظف بنجاح.", tone: "success" });
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

  const importMutation = useMutation<UserImportResult | EmployeeImportSummary, Error, { role: StaffRole; file: File }>({
    mutationFn: ({ role, file }: { role: StaffRole; file: File }) => role === "EMPLOYEE"
      ? importEmployeesExcel(file)
      : importUsersExcel(role, file),
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      const succeeded = "imported" in result ? result.imported : result.created + result.updated;
      const failed = "failedRows" in result ? result.failedRows.length : result.failed;
      pushToast({
        title: "اكتمل استيراد المستخدمين",
        description: `تم استيراد ${succeeded} وتعذر استيراد ${failed}.`,
        tone: "success"
      });
    },
    onError: (error) => pushToast({ title: "تعذر استيراد الموظفين", description: translateApiError(error), tone: "error" })
  });

  const employees = employeesQuery.data?.items || [];
  const total = employeesQuery.data?.meta.total || 0;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const hasLoadedEmployees = employeesQuery.isSuccess;
  const hasActiveSearch = Boolean(search || activeFilter || supervisorFilter);
  const canCreate = hasPermission("employees.create") || hasPermission("employees.view_team");
  const canEdit = hasPermission("employees.edit");
  const canToggle = hasPermission("employees.activate_deactivate");
  const canImportEmployees = isAdmin || isSupervisor;
  const importErrors = importResult
    ? "failedRows" in importResult ? importResult.failedRows : importResult.errors
    : [];
  const importedCount = importResult
    ? "imported" in importResult ? importResult.imported : importResult.created + importResult.updated
    : 0;
  const failedImportCount = importResult
    ? "failed" in importResult && typeof importResult.failed === "number" ? importResult.failed : importErrors.length
    : 0;
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

  useEffect(() => {
    debugLog("Employees page active role filter", {
      activeTab,
      roleFilter: activeTab,
      activeFilter: activeFilter || "ALL",
      supervisorId: activeTab === "EMPLOYEE" ? supervisorFilter || null : null,
      page,
      pageSize
    });
  }, [activeFilter, activeTab, page, pageSize, supervisorFilter]);

  useEffect(() => {
    if (!employeesQuery.isSuccess) {
      return;
    }

    debugLog("Employees page received employees", {
      activeTab,
      count: employees.length,
      total,
      responsePage: employeesQuery.data.meta.page,
      responseLimit: employeesQuery.data.meta.limit
    });
  }, [activeTab, employees.length, employeesQuery.data, employeesQuery.isSuccess, total]);

  function openCreateModal() {
    setEditing(null);
    form.reset({
      ...defaultValues,
      role: isSupervisor ? "EMPLOYEE" : activeTab,
      supervisorId: isSupervisor && user ? user.id : "",
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

    if (values.password && values.password.length < 8) {
      form.setError("password", { message: "كلمة المرور يجب ألا تقل عن 8 أحرف" });
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
        employee.isOnline ? "متصل الآن" : "غير متصل",
        employee.isOnline ? "متصل الآن" : formatLastSeen(employee.lastSeenAt),
        formatDateOnly(employee.createdAt)
      ]
      : [
        employee.employeeCode || "",
        employeeName(employee),
        supervisorLabel(employee),
        assignedCount(employee),
        employee.isActive ? "نشط" : "معطل",
        employee.isOnline ? "متصل الآن" : "غير متصل",
        employee.isOnline ? "متصل الآن" : formatLastSeen(employee.lastSeenAt),
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

  function handleImportFile(file: File | null) {
    setImportFile(file);
    setImportResult(null);
  }

  function openImport(role: StaffRole) {
    setImportRole(role); setImportFile(null); setImportResult(null); setImportModalOpen(true);
  }

  function downloadErrors() {
    if (!importErrors.length) return;
    const csv = ["row,reason", ...importErrors.map((error) => `${error.row},"${error.reason.replace(/"/g, '""')}"`)].join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "user-import-errors.csv"; link.click(); URL.revokeObjectURL(url);
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

          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input
                className="pr-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeTab === "SUPERVISOR" ? "ابحث باسم المشرف أو البريد الإلكتروني" : "ابحث باسم الموظف أو الكود"}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <PremiumSelect
                className="w-36"
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
                  className="w-44"
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

            <div className="flex flex-wrap items-center justify-start gap-2">
              {canImportEmployees ? <Button className="px-3" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => openImport("EMPLOYEE")}>استيراد الموظفين</Button> : null}
              {canCreate ? <Button className="px-3" icon={<UserPlus className="h-4 w-4" />} onClick={openCreateModal}>{isAdmin && activeTab === "SUPERVISOR" ? "إضافة مشرف" : "إضافة موظف"}</Button> : null}
              <Button className="px-3" variant="secondary" icon={<RefreshCw className={cn("h-4 w-4", employeesQuery.isFetching && "animate-spin")} />} onClick={() => employeesQuery.refetch()}>
                تحديث
              </Button>
              <Button className="px-3" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCurrentRows} disabled={employees.length === 0}>
                تصدير Excel
              </Button>
            </div>
          </div>
        </CardBody>

        <div className="max-h-[68vh] overflow-auto border-t border-surface-200">
          <table className="w-full min-w-[1320px] table-fixed border-separate border-spacing-0 text-right text-[11px] sm:text-xs md:text-sm">
            <colgroup>
              {activeTab === "SUPERVISOR" ? (
                <>
                  {visibleColumns.fullName ? <col style={{ width: "20%" }} /> : null}
                  {visibleColumns.email ? <col style={{ width: "18%" }} /> : null}
                  {visibleColumns.directReportsCount ? <col style={{ width: "9%" }} /> : null}
                  {visibleColumns.assignedCustomersCount ? <col style={{ width: "9%" }} /> : null}
                  {visibleColumns.isActive ? <col style={{ width: "8%" }} /> : null}
                  {visibleColumns.isOnline ? <col style={{ width: "10%" }} /> : null}
                  {visibleColumns.lastSeenAt ? <col style={{ width: "12%" }} /> : null}
                  {visibleColumns.createdAt ? <col style={{ width: "8%" }} /> : null}
                  {visibleColumns.actions ? <col style={{ width: "6%" }} /> : null}
                </>
              ) : (
                <>
                  {visibleColumns.employeeCode ? <col style={{ width: "10%" }} /> : null}
                  {visibleColumns.fullName ? <col style={{ width: "16%" }} /> : null}
                  {visibleColumns.supervisorName ? <col style={{ width: "14%" }} /> : null}
                  {visibleColumns.assignedCustomersCount ? <col style={{ width: "10%" }} /> : null}
                  {visibleColumns.isActive ? <col style={{ width: "8%" }} /> : null}
                  {visibleColumns.isOnline ? <col style={{ width: "10%" }} /> : null}
                  {visibleColumns.lastSeenAt ? <col style={{ width: "12%" }} /> : null}
                  {visibleColumns.createdAt ? <col style={{ width: "10%" }} /> : null}
                  {visibleColumns.actions ? <col style={{ width: "10%" }} /> : null}
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
              {!employeesQuery.isLoading && !employeesQuery.error && hasLoadedEmployees && employees.length === 0 ? (
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
                          <p className="truncate font-black leading-6 text-ink-900">{employeeName(employee)}</p>
                        </td>
                      ) : null}
                      {visibleColumns.email ? (
                        <td className={cn(tableCellClass, "truncate font-semibold text-ink-700")} dir="ltr">{employee.email || "—"}</td>
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
                          <span className="block truncate px-1 font-black text-ink-900 sm:px-2">
                            <span dir="ltr">{employee.employeeCode || "-"}</span>
                          </span>
                        </td>
                      ) : null}
                      {visibleColumns.fullName ? (
                        <td className={tableCellClass}>
                          <p className="truncate font-black leading-6 text-ink-900">{employeeName(employee)}</p>
                        </td>
                      ) : null}
                      {visibleColumns.supervisorName ? (
                        <td className={cn(tableCellClass, "truncate font-semibold leading-6 text-ink-700")}>{supervisorLabel(employee)}</td>
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
                  {visibleColumns.isOnline ? (
                    <td className={tableCellClass}><ConnectionStatusBadge isOnline={employee.isOnline} /></td>
                  ) : null}
                  {visibleColumns.lastSeenAt ? (
                    <td className={tableCellClass}><LastSeenText employee={employee} /></td>
                  ) : null}
                  {visibleColumns.createdAt ? (
                    <td className={cn(tableCellClass, "font-medium text-ink-500")} dir="ltr">{formatDateOnly(employee.createdAt)}</td>
                  ) : null}
                  {visibleColumns.actions ? (
                    <td className={tableCellClass}>
                      <div className="flex flex-nowrap items-center justify-center gap-1.5">
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

        <div className="flex flex-nowrap items-center justify-between gap-3 overflow-x-auto border-t border-surface-200 bg-surface-50 px-5 py-4">
          <div className="flex shrink-0 flex-nowrap items-center gap-2 text-sm font-semibold text-ink-600">
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
          <div className="flex shrink-0 items-center justify-end gap-2">
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
        open={isImportModalOpen}
        title={importRole === "SUPERVISOR" ? "استيراد المشرفين" : "استيراد الموظفين"}
        description={importRole === "EMPLOYEE"
          ? "ارفع ملف Excel بالأعمدة: الاسم، التحويلة، اسم المشرف، كلمة المرور، حالة الحساب"
          : "ارفع ملف Excel بالأعمدة: name, email, phone, employeeCode"}
        onClose={() => !importMutation.isPending && setImportModalOpen(false)}
        footer={<div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => importRole === "EMPLOYEE" ? downloadEmployeeImportTemplate() : downloadUserImportTemplate(importRole)} icon={<Download className="h-4 w-4" />}>تحميل القالب</Button>
          {importErrors.length ? <Button variant="secondary" onClick={downloadErrors} icon={<Download className="h-4 w-4" />}>تنزيل تقرير الأخطاء CSV</Button> : null}
          <Button disabled={!importFile || importMutation.isPending} onClick={() => importFile && importMutation.mutate({ role: importRole, file: importFile })} icon={<FileSpreadsheet className={cn("h-4 w-4", importMutation.isPending && "animate-pulse")} />}>{importMutation.isPending ? "جاري الاستيراد..." : "بدء الاستيراد"}</Button>
        </div>}
      >
        <div className="space-y-4">
          <input ref={importInputRef} type="file" accept=".xlsx,.xls" onChange={(event) => handleImportFile(event.target.files?.[0] || null)} className="block w-full rounded-xl border border-surface-200 p-3 text-sm" />
          <div className="rounded-xl bg-surface-50 p-3 text-sm font-bold">اسم الملف: {importFile?.name || "لم يتم اختيار ملف"}<br />عدد الصفوف: {importResult?.totalRows ?? "يظهر بعد الاستيراد"}</div>
          {importResult ? <div className="grid grid-cols-3 gap-2 text-center"><Badge tone="neutral">الإجمالي {importResult.totalRows}</Badge><Badge tone="green">تم {importedCount}</Badge><Badge tone={failedImportCount ? "red" : "green"}>فشل {failedImportCount}</Badge></div> : null}
          {importResult && "created" in importResult ? <div className="grid grid-cols-3 gap-2 text-center text-xs"><Badge tone="green">جديد {importResult.created}</Badge><Badge tone="neutral">تم تحديثه {importResult.updated}</Badge><Badge tone="neutral">مشرف جديد {importResult.supervisorsCreated || 0}</Badge></div> : null}
          {importResult && "users" in importResult && importResult.users.length ? <div className="max-h-52 overflow-auto rounded-xl border"><table className="w-full text-xs"><thead><tr><th className="p-2">الاسم</th><th>البريد</th><th>كلمة المرور المؤقتة</th></tr></thead><tbody>{importResult.users.map((item) => <tr key={item.employeeCode} className="border-t"><td className="p-2">{item.name}</td><td dir="ltr">{item.email}</td><td dir="ltr" className="font-mono">{item.temporaryPassword}</td></tr>)}</tbody></table></div> : null}
          {importErrors.length ? <div className="max-h-52 overflow-auto rounded-xl border border-red-100"><table className="w-full text-xs"><thead><tr><th className="p-2">الصف</th><th>السبب</th></tr></thead><tbody>{importErrors.map((error) => <tr key={`${error.row}-${error.reason}`} className="border-t"><td className="p-2 text-center">{error.row}</td><td className="p-2 text-red-700">{error.reason}</td></tr>)}</tbody></table></div> : null}
        </div>
      </Modal>

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
                    ...(isSupervisor ? [] : [{ value: "", label: "اختر المشرف" }]),
                    ...supervisorOptions.map((supervisor) => ({
                      value: supervisor.id,
                      label: employeeName(supervisor)
                    }))
                  ]}
                  disabled={isSupervisor}
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
          {editing && canToggle ? (
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
