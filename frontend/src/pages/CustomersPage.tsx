import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Copy, Download, Edit2, FileSpreadsheet, MessageCircle, Plus, Search, Trash2, Upload, UserCog, UserPlus, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { createCustomer, importCustomersExcel, listCustomers, updateCommunicationPreferences, updateCustomer } from "../api/customers.api";
import { listEmployees } from "../api/employees.api";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { FieldShell, Input, Select, Textarea } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/States";
import { DataTable, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableShell } from "../components/ui/Table";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { cn } from "../lib/cn";
import { translateApiError } from "../lib/i18n";
import { showTaradiAlert, showTaradiConfirm } from "../lib/sweetAlert";
import type { CollectionStatus, Customer, CustomerImportSummary, InvoiceStatus } from "../types/api";

const currentYear = new Date().getFullYear();
const debtYearOptions = Array.from({ length: currentYear - 2000 + 1 }, (_, index) => currentYear - index);
const projectNameOptions = ["STC", "Mobily"] as const;
const pageSizeOptions = [10, 25, 50, 100];

const invoiceStatusOptions: Array<{ value: InvoiceStatus; label: string; className: string }> = [
  { value: "UNPAID", label: "غير مدفوعة", className: "bg-red-50 text-red-700" },
  { value: "PAID", label: "مدفوعة", className: "bg-mint-50 text-mint-800" },
  { value: "SCHEDULED", label: "مجدولة", className: "bg-amber-50 text-amber-800" },
  { value: "DISPUTED", label: "متنازع عليها", className: "bg-purple-50 text-purple-700" },
  { value: "CANCELLED", label: "ملغية", className: "bg-ink-900 text-white" }
];

const collectionStatusOptions: Array<{ value: CollectionStatus; label: string; className: string; tone: "green" | "amber" | "red" | "blue" | "neutral" }> = [
  { value: "ACTIVE_DEBT", label: "مديونية قائمة", className: "bg-amber-50 text-amber-800", tone: "amber" },
  { value: "PAID", label: "تم السداد", className: "bg-mint-100 text-mint-900 ring-1 ring-mint-200", tone: "green" },
  { value: "PARTIALLY_PAID", label: "سداد جزئي", className: "bg-blue-50 text-blue-700", tone: "blue" },
  { value: "PROMISED_TO_PAY", label: "وعد بالسداد", className: "bg-mint-50 text-mint-800", tone: "green" },
  { value: "DISPUTED", label: "متنازع عليها", className: "bg-orange-50 text-orange-800", tone: "amber" },
  { value: "DO_NOT_CONTACT", label: "ممنوع التواصل", className: "bg-red-100 text-red-800 ring-1 ring-red-200", tone: "red" }
];

const sortOptions = [
  { value: "createdAt:desc", label: "الأحدث أولًا" },
  { value: "createdAt:asc", label: "الأقدم أولًا" },
  { value: "fullName:asc", label: "اسم العميل تصاعدي" },
  { value: "fullName:desc", label: "اسم العميل تنازلي" },
  { value: "debtAmount:desc", label: "المديونية الأعلى" },
  { value: "debtAmount:asc", label: "المديونية الأقل" }
];

const customerSchema = z.object({
  fullName: z.string().trim().min(1, "اسم العميل مطلوب"),
  nationalId: z.string().trim().min(1, "رقم الهوية مطلوب"),
  accountNumber: z.string().trim().min(1, "رقم الحساب مطلوب"),
  projectName: z.string().refine((value) => projectNameOptions.includes(value as typeof projectNameOptions[number]), "اختر الجهة"),
  debtAmount: z.string().trim().min(1, "مبلغ المديونية مطلوب").refine((value) => {
    const amount = Number(value.replace(/,/g, ""));
    return Number.isFinite(amount) && amount >= 0;
  }, "مبلغ المديونية غير صحيح"),
  serviceNumber: z.string().trim().min(1, "رقم الخدمة مطلوب"),
  serviceActivationDate: z.string().optional(),
  serviceTerminationDate: z.string().optional(),
  invoiceStatus: z.enum(["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"]),
  collectionStatus: z.enum(["ACTIVE_DEBT", "PAID", "PARTIALLY_PAID", "PROMISED_TO_PAY", "DISPUTED", "DO_NOT_CONTACT"]),
  paidAmount: z.string().optional().refine((value) => {
    if (!value?.trim()) {
      return true;
    }

    const amount = Number(value.replace(/,/g, ""));
    return Number.isFinite(amount) && amount >= 0;
  }, "المبلغ المسدد غير صحيح"),
  paymentReference: z.string().optional(),
  paymentNotes: z.string().optional(),
  debtYear: z.coerce.number().int().min(2000, "سنة المديونية يجب أن تكون بين 2000 والسنة الحالية.").max(currentYear, "سنة المديونية يجب أن تكون بين 2000 والسنة الحالية."),
  primaryPhone: z.string().trim().min(1, "رقم الهاتف الرئيسي مطلوب"),
  secondaryPhones: z.array(z.object({
    phoneNumber: z.string().trim()
  })).default([]),
  assignedEmployeeId: z.string().optional(),
  notes: z.string().optional()
});

type CustomerValues = z.infer<typeof customerSchema>;

const defaultValues: CustomerValues = {
  fullName: "",
  nationalId: "",
  accountNumber: "",
  projectName: "",
  debtAmount: "",
  serviceNumber: "",
  serviceActivationDate: "",
  serviceTerminationDate: "",
  invoiceStatus: "UNPAID",
  collectionStatus: "ACTIVE_DEBT",
  paidAmount: "",
  paymentReference: "",
  paymentNotes: "",
  debtYear: currentYear,
  primaryPhone: "",
  secondaryPhones: [],
  assignedEmployeeId: "",
  notes: ""
};

function customerDisplayName(customer: Customer) {
  return customer.fullName || customer.name || customer.whatsappProfileName || customer.primaryPhone || customer.phone || "بدون اسم";
}

function customerCollectorName(customer: Customer) {
  return customer.collectorName || customer.assignedEmployee?.name || customer.assignedTo?.name || "غير مسند";
}

function customerSupervisorName(customer: Customer) {
  if (customer.supervisorName) {
    return customer.supervisorName;
  }

  if (!customer.assignedEmployee && !customer.assignedTo) {
    return "غير محدد";
  }

  const assignedUser = customer.assignedEmployee || customer.assignedTo;
  if (assignedUser?.role === "SUPERVISOR") {
    return assignedUser.name;
  }

  return assignedUser?.supervisor?.name || "غير محدد";
}

function customerPrimaryPhone(customer: Customer) {
  return customer.primaryPhone || customer.phone;
}

function customerDebtAmount(customer: Customer) {
  const amount = Number(String(customer.debtAmount || "0").replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function isCustomerFullyPaid(customer: Customer) {
  return customer.collectionStatus === "PAID" || customer.invoiceStatus === "PAID";
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toDateInput(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatDateOnly(value?: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatCurrency(value?: string | number | null) {
  const amount = Number(String(value || "0").replace(/,/g, ""));

  if (!Number.isFinite(amount)) {
    return "—";
  }

  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)} ريال`;
}

function phoneKindBadgeHtml(isPrimary: boolean) {
  const label = isPrimary ? "⭐ الرقم الرئيسي" : "رقم فرعي";
  const colors = isPrimary
    ? "background:#ecfdf3;color:#047857;border:1px solid #bbf7d0"
    : "background:#f8fafc;color:#334155;border:1px solid #e2e8f0";

  return `<span style="display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;white-space:nowrap;${colors}">${escapeHtml(label)}</span>`;
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const option = invoiceStatusOptions.find((item) => item.value === status) || invoiceStatusOptions[0];

  return (
    <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-black", option.className)}>
      {option.label}
    </span>
  );
}

function ProjectBadge({ projectName }: { projectName?: string | null }) {
  const className = projectName === "STC"
    ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
    : projectName === "Mobily"
      ? "bg-blue-50 text-blue-800 ring-1 ring-blue-100"
      : "bg-surface-100 text-ink-700";

  return (
    <span className={cn("inline-flex rounded-full px-3 py-1.5 text-xs font-black", className)}>
      {projectName || "غير محدد"}
    </span>
  );
}

function CollectionStatusBadge({ status }: { status?: CollectionStatus }) {
  const option = collectionStatusOptions.find((item) => item.value === status) || collectionStatusOptions[0];
  const isPaid = option.value === "PAID";

  return (
    <span className={cn(
      "inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-black",
      isPaid ? "px-4 py-1.5 text-sm" : "",
      option.className
    )}>
      {option.label}
    </span>
  );
}

function FormSection({ title, children, gridClassName }: { title: string; children: ReactNode; gridClassName?: string }) {
  return (
    <section className="rounded-2xl border border-surface-200 bg-surface-50/60 p-5">
      <p className="mb-4 border-b border-surface-200 pb-3 text-sm font-black text-ink-900">{title}</p>
      <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", gridClassName)}>
        {children}
      </div>
    </section>
  );
}

export function CustomersPage() {
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const canCreate = hasPermission("customers.create");
  const canEdit = hasPermission("customers.edit");
  const canAssign = hasPermission("customers.assign");
  const canImport = hasPermission("customers.import_csv");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [projectNameFilter, setProjectNameFilter] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceStatus | "">("");
  const [collectorFilter, setCollectorFilter] = useState("");
  const [supervisorFilter, setSupervisorFilter] = useState("");
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<CollectionStatus | "">("");
  const [debtYearFilter, setDebtYearFilter] = useState("");
  const [sortValue, setSortValue] = useState("createdAt:desc");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<CustomerImportSummary | null>(null);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [sortBy, sortOrder] = sortValue.split(":") as ["fullName" | "debtAmount" | "createdAt", "asc" | "desc"];

  const customersQuery = useQuery({
    queryKey: ["customers", {
      search,
      page,
      pageSize,
      projectNameFilter,
      invoiceStatusFilter,
      collectorFilter,
      supervisorFilter,
      collectionStatusFilter,
      debtYearFilter,
      sortValue
    }],
    queryFn: () => listCustomers({
      search,
      page,
      limit: pageSize,
      sortBy,
      sortOrder,
      ...(projectNameFilter ? { projectName: projectNameFilter } : {}),
      ...(invoiceStatusFilter ? { invoiceStatus: invoiceStatusFilter } : {}),
      ...(collectorFilter ? { assignedEmployeeId: collectorFilter } : {}),
      ...(supervisorFilter ? { supervisorId: supervisorFilter } : {}),
      ...(collectionStatusFilter ? { collectionStatus: collectionStatusFilter } : {}),
      ...(debtYearFilter ? { debtYear: debtYearFilter } : {})
    }),
    placeholderData: keepPreviousData
  });

  const employeesQuery = useQuery({
    queryKey: ["employees", "collector-options"],
    queryFn: () => listEmployees({ limit: 100, role: "EMPLOYEE", isActive: true }),
    enabled: canAssign
  });

  const supervisorsQuery = useQuery({
    queryKey: ["employees", "supervisor-filter-options"],
    queryFn: () => listEmployees({ limit: 100, role: "SUPERVISOR", isActive: true }),
    enabled: canAssign
  });

  const form = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues
  });
  const watchedCollectionStatus = form.watch("collectionStatus");
  const secondaryPhones = useFieldArray({
    control: form.control,
    name: "secondaryPhones"
  });

  const saveMutation = useMutation({
    mutationFn: async (values: CustomerValues) => {
      const payload = {
        fullName: values.fullName,
        nationalId: values.nationalId,
        accountNumber: values.accountNumber,
        projectName: values.projectName,
        debtAmount: values.debtAmount,
        serviceNumber: values.serviceNumber,
        serviceActivationDate: values.serviceActivationDate || null,
        serviceTerminationDate: values.serviceTerminationDate || null,
        invoiceStatus: values.invoiceStatus,
        collectionStatus: values.collectionStatus,
        paidAmount: values.paidAmount || null,
        paymentReference: values.paymentReference || null,
        paymentNotes: values.paymentNotes || null,
        debtYear: values.debtYear,
        primaryPhone: values.primaryPhone,
        secondaryPhones: values.secondaryPhones.map((phone) => phone.phoneNumber).filter(Boolean),
        notes: values.notes || null,
        ...(canAssign ? { assignedEmployeeId: values.assignedEmployeeId || null } : {})
      };

      if (editing) {
        return updateCustomer(editing.id, payload);
      }

      return createCustomer(payload);
    },
    onSuccess: (result, values) => {
      const wasEditing = Boolean(editing);
      const collectorChanged = wasEditing &&
        canAssign &&
        (editing?.assignedEmployeeId || editing?.assignedToId || "") !== (values.assignedEmployeeId || "");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      setEditing(null);
      setModalOpen(false);
      form.reset(defaultValues);
      pushToast({
        title: collectorChanged ? "تم تغيير المحصل" : wasEditing ? "تم تحديث بيانات العميل" : "تم إضافة العميل بنجاح",
        description: collectorChanged && "archivedConversationId" in result && result.archivedConversationId
          ? "تم نقل العميل إلى الموظف الجديد وأرشفة المحادثة السابقة."
          : undefined,
        tone: "success"
      });
      void showTaradiAlert({
        title: wasEditing ? "تم تعديل بيانات العميل بنجاح" : "تم إضافة العميل بنجاح",
        icon: "success"
      });
    },
    onError: (error) => pushToast({ title: "تعذر حفظ العميل", description: translateApiError(error), tone: "error" })
  });

  const importMutation = useMutation({
    mutationFn: () => {
      if (!importFile) {
        throw new Error("اختر ملف Excel أو CSV أولًا");
      }

      return importCustomersExcel(importFile);
    },
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      pushToast({
        title: "تم استيراد العملاء بنجاح",
        description: `${result.created} إنشاء، ${result.updated} تحديث، ${result.assigned} مسند، ${result.unassigned || 0} غير مسند`,
        tone: result.errors.length || result.warnings?.length ? "info" : "success"
      });
    },
    onError: (error) => pushToast({ title: "تعذر استيراد العملاء", description: translateApiError(error), tone: "error" })
  });

  const preferencesMutation = useMutation({
    mutationFn: ({ customer, optIn }: { customer: Customer; optIn: boolean }) => updateCommunicationPreferences(customer.id, optIn ? {
      whatsappOptIn: true,
      source: window.prompt("أدخل مصدر الموافقة") || "ADMIN_CONFIRMED",
      optInAt: new Date().toISOString(),
      reason: "Manual update from customer dashboard"
    } : {
      whatsappOptIn: false,
      reason: "Manual opt-out from customer dashboard"
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      pushToast({ title: "تم تحديث تفضيلات التواصل", tone: "success" });
    },
    onError: (error) => pushToast({ title: "تعذر تحديث تفضيلات التواصل", description: translateApiError(error), tone: "error" })
  });

  function changeCommunicationPreference(customer: Customer, optIn: boolean) {
    const action = optIn ? "إعادة تفعيل موافقة واتساب لهذا العميل؟" : "إلغاء موافقة واتساب ومنع الحملات لهذا العميل؟";
    if (window.confirm(action)) preferencesMutation.mutate({ customer, optIn });
  }

  function openCreateModal() {
    setEditing(null);
    form.reset(defaultValues);
    setModalOpen(true);
  }

  function openImportModal() {
    setImportFile(null);
    setImportResult(null);
    setImportModalOpen(true);
  }

  function openEditModal(customer: Customer) {
    setEditing(customer);
    form.reset({
      fullName: customerDisplayName(customer),
      nationalId: customer.nationalId || "",
      accountNumber: customer.accountNumber || "",
      projectName: projectNameOptions.includes(customer.projectName as typeof projectNameOptions[number]) ? customer.projectName : "",
      debtAmount: String(customer.debtAmount || ""),
      serviceNumber: customer.serviceNumber || "",
      serviceActivationDate: toDateInput(customer.serviceActivationDate),
      serviceTerminationDate: toDateInput(customer.serviceTerminationDate),
      invoiceStatus: customer.invoiceStatus || "UNPAID",
      collectionStatus: customer.collectionStatus || "ACTIVE_DEBT",
      paidAmount: customer.paidAmount || "",
      paymentReference: customer.paymentReference || "",
      paymentNotes: customer.paymentNotes || "",
      debtYear: customer.debtYear || currentYear,
      primaryPhone: customerPrimaryPhone(customer),
      secondaryPhones: (customer.secondaryPhones || []).map((phoneNumber) => ({ phoneNumber })),
      assignedEmployeeId: customer.assignedEmployeeId || customer.assignedToId || "",
      notes: customer.notes || ""
    });
    setModalOpen(true);
  }

  function downloadSampleCsv() {
    const csv = [
      "الجهة,اسم العميل,رقم الهوية,الرقم الرئيسي,رقم الحساب,مبلغ المديونية,المحصل,اسم المستخدم,المتابعة,رقم الخدمة,تأريخ تفعيل الخدمة,تاريخ إنتهاء الخدمة,حالة الفاتورة,تأريخ سنة المديونية",
      "STC,أحمد علي,1234567890,0500000001,ACC-1001,2500.75,محمد المحصل,user-01,متابعة خلال أسبوع,SVC-9988,15/01/2020,20/03/2021,Closed - N,2021"
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "taradi-customers-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submitCustomerForm(values: CustomerValues) {
    const willMarkPaid = values.collectionStatus === "PAID" && (!editing || editing.collectionStatus !== "PAID");

    if (willMarkPaid) {
      const result = await showTaradiConfirm({
        title: "تأكيد سداد المديونية؟",
        text: "بعد التأكيد، سيتم منع التواصل مع هذا العميل واستبعاده من الحملات الجماعية.",
        confirmButtonText: "نعم، تم السداد",
        cancelButtonText: "إلغاء",
        icon: "warning",
        tone: "primary"
      });

      if (!result.isConfirmed) {
        return;
      }
    }

    saveMutation.mutate(values);
  }

  const customerItems = customersQuery.data?.items || [];
  const collectorOptions = employeesQuery.data?.items || [];
  const supervisorOptions = supervisorsQuery.data?.items || [];
  const totalCustomers = customersQuery.data?.meta.total ?? 0;
  const totalPages = Math.max(Math.ceil(totalCustomers / pageSize), 1);
  const hasSearchOrFilters = Boolean(
    search ||
    projectNameFilter ||
    invoiceStatusFilter ||
    collectorFilter ||
    supervisorFilter ||
    collectionStatusFilter ||
    debtYearFilter
  );
  const activeFiltersCount = [
    search,
    projectNameFilter,
    invoiceStatusFilter,
    collectorFilter,
    supervisorFilter,
    collectionStatusFilter,
    debtYearFilter
  ].filter(Boolean).length;
  const pageTitle = isAdmin ? "العملاء" : user?.role === "SUPERVISOR" ? "عملاء الفريق" : "عملائي";

  async function copyText(value: string, label: string) {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard?.writeText(value);
      pushToast({ title: `تم نسخ ${label}`, tone: "success" });
    } catch (error) {
      pushToast({ title: "تعذر النسخ", description: "انسخ القيمة يدويًا من الجدول.", tone: "error" });
    }
  }

  function openConversation(customer: Customer) {
    navigate(`/inbox?customerId=${customer.id}`);
  }

  function openWhatsApp(customer: Customer) {
    const phone = customerPrimaryPhone(customer);
    if (!phone) {
      return;
    }

    window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
  }

  function showCustomerDetails(customer: Customer) {
    const phoneDetails: Array<{
      phoneNumber: string;
      isPrimary: boolean;
      position: number;
    }> = (customer.phones && customer.phones.length > 0
      ? customer.phones.map((phone) => ({
          phoneNumber: phone.phoneNumber,
          isPrimary: phone.isPrimary,
          position: phone.position
        }))
      : [
          {
            phoneNumber: customerPrimaryPhone(customer),
            isPrimary: true,
            position: 0
          },
          ...(customer.secondaryPhones || []).map((phoneNumber, index) => ({
            phoneNumber,
            isPrimary: false,
            position: index + 1
          }))
        ])
      .filter((phone) => Boolean(phone.phoneNumber))
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) {
          return a.isPrimary ? -1 : 1;
        }

        return a.position - b.position;
      });
    const phonesHtml = phoneDetails.length
      ? phoneDetails.map((phone) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #e5e7eb;background:#ffffff;border-radius:14px;padding:10px 12px;margin-top:8px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${phoneKindBadgeHtml(phone.isPrimary)}
            </div>
            <b dir="ltr" style="font-size:14px;color:#111827">${escapeHtml(phone.phoneNumber)}</b>
          </div>
        `).join("")
      : `<div style="border:1px dashed #e5e7eb;border-radius:14px;padding:12px;color:#64748b">لا توجد أرقام مسجلة</div>`;
    const debtsHtml = (customer.debts || []).map((debt) => `
      <div style="border:1px solid #d1fae5;background:${debt.isActive ? "#f0fdf4" : "#f8fafc"};border-radius:14px;padding:12px;margin-top:8px">
        <div><b>${escapeHtml(debt.projectName || "جهة غير محددة")}</b> — حساب <span dir="ltr">${escapeHtml(debt.accountNumber)}</span></div>
        <div>الخدمة: <span dir="ltr">${escapeHtml(debt.serviceNumber || "غير محدد")}</span> | السنة: ${debt.debtYear}</div>
        <div>المبلغ: <b>${escapeHtml(formatCurrency(debt.debtAmount))}</b> | ${debt.isActive ? "نشطة" : "مؤرشفة"}</div>
      </div>`).join("") || `<div style="border:1px dashed #e5e7eb;border-radius:14px;padding:12px;color:#64748b">لا توجد مديونيات مسجلة</div>`;

    void showTaradiAlert({
      title: "تفاصيل العميل",
      html: `
        <div dir="rtl" style="text-align:right;line-height:1.9">
          <p><b>اسم العميل:</b> ${escapeHtml(customerDisplayName(customer))}</p>
          <p><b>رقم الهوية:</b> ${escapeHtml(customer.nationalId || "غير محدد")}</p>
          <div style="margin:12px 0">
            <b>أرقام التواصل:</b>
            ${phonesHtml}
          </div>
          <div style="margin:12px 0"><b>مديونيات العميل:</b>${debtsHtml}</div>
          <div style="margin:12px 0;border:1px solid #e5e7eb;border-radius:14px;padding:12px">
            <b>تفضيلات تواصل واتساب</b>
            <p>الموافقة: ${customer.whatsappOptIn ? "مفعلة" : "غير مفعلة"}</p>
            <p>تاريخ/مصدر الموافقة: ${escapeHtml(customer.whatsappOptInAt || "غير محدد")} / ${escapeHtml(customer.whatsappOptInSource || "غير محدد")}</p>
            <p>إلغاء الاشتراك: ${escapeHtml(customer.whatsappOptOutAt || "لا يوجد")}</p>
            <p>الحظر: ${customer.whatsappSuppressed ? escapeHtml(customer.whatsappSuppressionReason || "محظور") : "غير محظور"}</p>
            <p>آخر حملة: ${escapeHtml(customer.lastCampaignMessageAt || "لا يوجد")}</p>
          </div>
          <p><b>المحصل:</b> ${escapeHtml(customerCollectorName(customer))}</p>
          <p><b>المشرف:</b> ${escapeHtml(customerSupervisorName(customer))}</p>
        </div>
      `,
      confirmButtonText: "إغلاق"
    });
  }

  function setFilter<T>(setter: (value: T) => void, value: T) {
    setPage(1);
    setter(value);
  }

  function clearFilters() {
    setPage(1);
    setSearch("");
    setProjectNameFilter("");
    setInvoiceStatusFilter("");
    setCollectorFilter("");
    setSupervisorFilter("");
    setCollectionStatusFilter("");
    setDebtYearFilter("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={pageTitle}
        description="إدارة بيانات عملاء التحصيل والمديونيات وأرقام التواصل."
        action={(
          <>
            {canImport ? (
              <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={openImportModal}>
                استيراد العملاء
              </Button>
            ) : null}
            {canCreate ? <Button icon={<UserPlus className="h-4 w-4" />} onClick={openCreateModal}>إضافة عميل</Button> : null}
          </>
        )}
      />

      <Card>
        <CardHeader
          title={isAdmin ? "كل العملاء" : "العملاء المسندون"}
          description={`${totalCustomers} عميل في العرض الحالي${customersQuery.isFetching ? " · جاري التحديث..." : ""}`}
          action={(
            <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <div className="relative min-w-0 sm:col-span-2">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                <Input
                  className="pr-9"
                  value={search}
                  onChange={(event) => setFilter(setSearch, event.target.value)}
                  placeholder="ابحث باسم العميل أو رقم الهوية أو الحساب أو الهاتف"
                />
              </div>
              <Select className="w-full" value={projectNameFilter} onChange={(event) => setFilter(setProjectNameFilter, event.target.value)}>
                <option value="">كل الجهات</option>
                {projectNameOptions.map((projectName) => <option key={projectName} value={projectName}>{projectName}</option>)}
              </Select>
              <Select className="w-full" value={invoiceStatusFilter} onChange={(event) => setFilter(setInvoiceStatusFilter, event.target.value as InvoiceStatus | "")}>
                <option value="">كل الفواتير</option>
                {invoiceStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
              {canAssign ? (
                <Select className="w-full" value={collectorFilter} onChange={(event) => setFilter(setCollectorFilter, event.target.value)}>
                  <option value="">كل المحصلين</option>
                  {collectorOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                </Select>
              ) : null}
              {canAssign ? (
                <Select className="w-full" value={supervisorFilter} onChange={(event) => setFilter(setSupervisorFilter, event.target.value)}>
                  <option value="">كل المشرفين</option>
                  {supervisorOptions.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>)}
                </Select>
              ) : null}
              <Select className="w-full" value={collectionStatusFilter} onChange={(event) => setFilter(setCollectionStatusFilter, event.target.value as CollectionStatus | "")}>
                <option value="">كل التحصيل</option>
                {collectionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
              <Select className="w-full" value={debtYearFilter} onChange={(event) => setFilter(setDebtYearFilter, event.target.value)}>
                <option value="">كل السنوات</option>
                {debtYearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </Select>
              <Select className="w-full" value={sortValue} onChange={(event) => setFilter(setSortValue, event.target.value)}>
                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
              <div className="flex min-w-0 items-center gap-2 sm:col-span-2 xl:col-span-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-w-0 flex-1 px-3"
                  icon={<Trash2 className="h-4 w-4" />}
                  disabled={!hasSearchOrFilters}
                  onClick={clearFilters}
                >
                  مسح الفلاتر
                </Button>
                {activeFiltersCount ? (
                  <span className="inline-flex h-10 shrink-0 items-center rounded-xl bg-mint-50 px-3 text-xs font-black text-mint-800 ring-1 ring-mint-100">
                    {activeFiltersCount} نشط
                  </span>
                ) : null}
              </div>
            </div>
          )}
        />

        {customersQuery.isLoading && !customersQuery.data ? <TableSkeleton rows={6} columns={10} /> : null}
        {customersQuery.error ? <ErrorState error={customersQuery.error} /> : null}
        {customerItems.length === 0 && !customersQuery.isLoading ? (
          <EmptyState
            title={hasSearchOrFilters ? "لا توجد نتائج مطابقة" : "لا يوجد عملاء"}
            description={hasSearchOrFilters ? "جرّب تعديل البحث أو الفلاتر الحالية." : "أضف عميلًا جديدًا أو استورد ملف Excel أو CSV."}
          />
        ) : null}

        {customerItems.length ? (
          <>
            <div className="divide-y divide-surface-200 lg:hidden">
              {customerItems.map((customer) => (
                <div key={customer.id} className="space-y-3 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={customerDisplayName(customer)} />
                      <div className="min-w-0">
                        <p className="truncate font-black text-ink-900">{customerDisplayName(customer)}</p>
                        <p className="mt-1 text-sm font-bold text-mint-800" dir="ltr">{customer.nationalId || "غير محدد"}</p>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="icon"
                      title="فتح المحادثة"
                      onClick={() => openConversation(customer)}
                      aria-label="فتح المحادثة"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 pb-1">
                    <Badge tone="blue">{customer.activeDebtsCount ?? customer.debts?.filter((debt) => debt.isActive).length ?? 1} مديونية نشطة</Badge>
                    <InvoiceStatusBadge status={customer.invoiceStatus} />
                    <Badge tone={isCustomerFullyPaid(customer) ? "green" : "red"}>{formatCurrency(customer.totalActiveDebtAmount ?? customer.debtAmount)}</Badge>
                    <Badge tone="neutral">{customerCollectorName(customer)}</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-sm text-ink-600 sm:grid-cols-2">
                    <span>الهاتف: <b dir="ltr">{customerPrimaryPhone(customer)}</b></span>
                    <span>المشاريع: <b>{customer.debtProjects?.join("، ") || customer.projectName}</b></span>
                    <span>المشرف: {customerSupervisorName(customer)}</span>
                    <span>المحصل: {customerCollectorName(customer)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pb-1">
                    <Button variant="secondary" size="sm" icon={<ClipboardList className="h-4 w-4" />} onClick={() => showCustomerDetails(customer)}>عرض التفاصيل</Button>
                    {canEdit ? <Button variant="secondary" size="sm" icon={<Edit2 className="h-4 w-4" />} onClick={() => openEditModal(customer)}>تعديل</Button> : null}
                    {canAssign ? <Button variant="secondary" size="sm" icon={<UserCog className="h-4 w-4" />} onClick={() => openEditModal(customer)}>تغيير المحصل</Button> : null}
                    {isAdmin ? <Button variant="secondary" size="sm" disabled={preferencesMutation.isPending} onClick={() => changeCommunicationPreference(customer, !customer.whatsappOptIn)}>{customer.whatsappOptIn ? "إلغاء موافقة واتساب" : "تفعيل موافقة واتساب"}</Button> : null}
                  </div>
                </div>
              ))}
            </div>

            <TableShell className="hidden lg:block [&_td]:text-center [&_td]:whitespace-nowrap [&_th]:text-center [&_th]:whitespace-nowrap">
              <DataTable minWidth="1280px">
                <TableHead>
                  <tr>
                    <TableHeaderCell>اسم العميل</TableHeaderCell>
                    <TableHeaderCell>رقم الهوية</TableHeaderCell>
                    <TableHeaderCell>رقم الهاتف الرئيسي</TableHeaderCell>
                    <TableHeaderCell>المشاريع</TableHeaderCell>
                    <TableHeaderCell>المديونيات النشطة</TableHeaderCell>
                    <TableHeaderCell>إجمالي المديونية</TableHeaderCell>
                    <TableHeaderCell>حالة الفاتورة</TableHeaderCell>
                    <TableHeaderCell>اسم المحصل</TableHeaderCell>
                    <TableHeaderCell>اسم المشرف</TableHeaderCell>
                    <TableHeaderCell>الإجراءات</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {customerItems.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="flex min-w-[190px] items-center justify-center gap-3">
                          <div className="min-w-0">
                            <p className="max-w-[210px] truncate font-black text-ink-900">{customerDisplayName(customer)}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-bold text-ink-700"><span dir="ltr">{customer.nationalId || "—"}</span></TableCell>
                      <TableCell>
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <span className="font-bold text-ink-800" dir="ltr">{customerPrimaryPhone(customer)}</span>
                        </div>
                      </TableCell>
                      <TableCell>{customer.debtProjects?.join("، ") || customer.projectName}</TableCell>
                      <TableCell>
                        <div className="group flex items-center justify-center gap-1.5" dir="ltr">
                          <span className="font-black text-mint-800">{customer.activeDebtsCount ?? customer.debts?.filter((debt) => debt.isActive).length ?? 1}</span>
                        </div>
                      </TableCell>
                      <TableCell className={cn("font-black", customerDebtAmount(customer) > 0 && !isCustomerFullyPaid(customer) ? "text-red-700" : "text-mint-800")}>
                        {formatCurrency(customer.totalActiveDebtAmount ?? customer.debtAmount)}
                      </TableCell>
                      <TableCell><InvoiceStatusBadge status={customer.invoiceStatus} /></TableCell>
                      <TableCell><span className="inline-block max-w-[150px] truncate align-middle">{customerCollectorName(customer)}</span></TableCell>
                      <TableCell><span className="inline-block max-w-[150px] truncate align-middle">{customerSupervisorName(customer)}</span></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-9 w-9 rounded-lg"
                            title="فتح المحادثة"
                            aria-label="فتح المحادثة"
                            onClick={() => openConversation(customer)}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                          {canEdit ? (
                            <Button variant="secondary" size="icon" className="h-9 w-9 rounded-lg" title="تعديل" aria-label="تعديل" onClick={() => openEditModal(customer)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {isAdmin ? (
                            <Button variant="secondary" size="sm" disabled={preferencesMutation.isPending} title="تفضيلات واتساب" onClick={() => changeCommunicationPreference(customer, !customer.whatsappOptIn)}>
                              {customer.whatsappOptIn ? "إلغاء الموافقة" : "تفعيل الموافقة"}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </TableShell>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-200 bg-surface-50 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-600">
                <span>عرض</span>
                <Select
                  className="w-24"
                  value={String(pageSize)}
                  aria-label="عدد الصفوف"
                  onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}
                >
                  {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
                </Select>
                <span>صف</span>
                <span className="inline-flex min-w-max whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-xs font-black shadow-sm">{totalCustomers} إجمالي</span>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page <= 1 || customersQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(current - 1, 1))}
                >
                  السابق
                </Button>
                <span className="rounded-xl bg-white px-3 py-2 text-sm font-black text-ink-800 shadow-sm">
                  {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page >= totalPages || customersQuery.isFetching}
                  onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
                >
                  التالي
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </Card>

      <Modal
        open={isModalOpen}
        title={editing ? "تعديل بيانات العميل" : "إضافة عميل"}
        description="أدخل بيانات العميل والمديونية وأرقام التواصل الخاصة به."
        className="!max-w-[1180px]"
        onClose={() => setModalOpen(false)}
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button type="submit" form="customer-form" disabled={saveMutation.isPending} icon={<UsersRound className="h-4 w-4" />}>
              {saveMutation.isPending ? "جاري الحفظ..." : editing ? "حفظ التغييرات" : "إضافة العميل"}
            </Button>
          </div>
        )}
      >
        <form id="customer-form" className="space-y-4" onSubmit={form.handleSubmit(submitCustomerForm)}>
          <FormSection title="بيانات العميل">
            <FieldShell label="اسم العميل" error={form.formState.errors.fullName?.message}>
              <Input {...form.register("fullName")} placeholder="اسم العميل" />
            </FieldShell>
            <FieldShell label="رقم الهوية" error={form.formState.errors.nationalId?.message}>
              <Input {...form.register("nationalId")} placeholder="رقم الهوية" dir="ltr" />
            </FieldShell>
            <FieldShell label="رقم الحساب" error={form.formState.errors.accountNumber?.message}>
              <Input {...form.register("accountNumber")} placeholder="ACC-1001" dir="ltr" />
            </FieldShell>
          </FormSection>

          <FormSection title="بيانات الخدمة" gridClassName="lg:grid-cols-4">
            <FieldShell label="الجهة" error={form.formState.errors.projectName?.message}>
              <Select {...form.register("projectName")}>
                <option value="">اختر الجهة</option>
                {projectNameOptions.map((projectName) => (
                  <option key={projectName} value={projectName}>{projectName}</option>
                ))}
              </Select>
            </FieldShell>
            <FieldShell label="رقم الخدمة" error={form.formState.errors.serviceNumber?.message}>
              <Input {...form.register("serviceNumber")} placeholder="رقم الخدمة" dir="ltr" />
            </FieldShell>
            <FieldShell label="تاريخ التفعيل" error={form.formState.errors.serviceActivationDate?.message}>
              <Input type="date" {...form.register("serviceActivationDate")} />
            </FieldShell>
            <FieldShell label="تاريخ الإنهاء" error={form.formState.errors.serviceTerminationDate?.message}>
              <Input type="date" {...form.register("serviceTerminationDate")} />
            </FieldShell>
          </FormSection>

          <FormSection title="بيانات المديونية">
            <FieldShell label="مبلغ المديونية" error={form.formState.errors.debtAmount?.message}>
              <Input {...form.register("debtAmount")} placeholder="2500.00" inputMode="decimal" dir="ltr" />
            </FieldShell>
            <FieldShell label="سنة المديونية" error={form.formState.errors.debtYear?.message}>
              <Select {...form.register("debtYear", { valueAsNumber: true })}>
                {debtYearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </Select>
            </FieldShell>
            <FieldShell label="حالة الفاتورة" error={form.formState.errors.invoiceStatus?.message}>
              <Select {...form.register("invoiceStatus")}>
                {invoiceStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </FieldShell>
          </FormSection>

          <FormSection title="حالة التحصيل والمحصل" gridClassName={canAssign ? "lg:grid-cols-2" : undefined}>
            <FieldShell label="حالة التحصيل" error={form.formState.errors.collectionStatus?.message}>
              <Select {...form.register("collectionStatus")}>
                {collectionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </FieldShell>
            {canAssign ? (
              <FieldShell label="اسم المحصل" error={form.formState.errors.assignedEmployeeId?.message}>
                <Select {...form.register("assignedEmployeeId")}>
                  <option value="">{isAdmin ? "غير مسند" : "اختر المحصل"}</option>
                  {collectorOptions.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.name}</option>
                  ))}
                </Select>
              </FieldShell>
            ) : null}
            {editing?.paidAt ? (
              <div className="rounded-2xl border border-mint-100 bg-mint-50 px-4 py-3 text-sm font-bold text-mint-800">
                تاريخ السداد المسجل: {formatDateOnly(editing.paidAt)}
              </div>
            ) : null}
            {watchedCollectionStatus === "PAID" ? (
              <>
                <div className="rounded-2xl border border-mint-200 bg-mint-50 px-4 py-3 text-sm font-bold text-mint-900 md:col-span-2 lg:col-span-full">
                  بعد الحفظ سيتم منع التواصل مع هذا العميل واستبعاده من الحملات الجماعية تلقائيًا.
                </div>
                <FieldShell label="المبلغ المسدد" error={form.formState.errors.paidAmount?.message}>
                  <Input {...form.register("paidAmount")} placeholder="1500.00" inputMode="decimal" dir="ltr" />
                </FieldShell>
                <FieldShell label="رقم مرجع السداد" error={form.formState.errors.paymentReference?.message}>
                  <Input {...form.register("paymentReference")} placeholder="BANK-123" dir="ltr" />
                </FieldShell>
                <div className="md:col-span-2 lg:col-span-full">
                  <FieldShell label="ملاحظات السداد" error={form.formState.errors.paymentNotes?.message}>
                    <Textarea {...form.register("paymentNotes")} placeholder="تم السداد عبر التحويل البنكي" />
                  </FieldShell>
                </div>
              </>
            ) : null}
            {watchedCollectionStatus === "DO_NOT_CONTACT" ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 md:col-span-2 lg:col-span-full">
                سيتم منع التواصل مع هذا العميل وإغلاق المحادثة المرتبطة به.
              </div>
            ) : null}
          </FormSection>

          <FormSection title="أرقام التواصل" gridClassName="lg:grid-cols-[minmax(220px,0.85fr)_minmax(0,2.15fr)]">
            <FieldShell label="رقم الهاتف الرئيسي" error={form.formState.errors.primaryPhone?.message}>
              <Input {...form.register("primaryPhone")} placeholder="966500000001" dir="ltr" />
            </FieldShell>
            <div className="space-y-3 md:col-span-2 lg:col-span-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink-700">الأرقام الفرعية</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => secondaryPhones.append({ phoneNumber: "" })}
                >
                  إضافة رقم
                </Button>
              </div>
              <div className="space-y-2">
                {secondaryPhones.fields.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-surface-200 bg-white px-3 py-3 text-sm font-semibold text-ink-500">
                    لا توجد أرقام فرعية
                  </div>
                ) : null}
                {secondaryPhones.fields.map((field, index) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <Input
                      {...form.register(`secondaryPhones.${index}.phoneNumber`)}
                      placeholder="رقم فرعي"
                      dir="ltr"
                    />
                    <Button type="button" variant="secondary" size="icon" aria-label="حذف الرقم" onClick={() => secondaryPhones.remove(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </FormSection>

          <FormSection title="ملاحظات">
            <div className="md:col-span-2 lg:col-span-3">
              <FieldShell label="ملاحظات" error={form.formState.errors.notes?.message}>
                <Textarea {...form.register("notes")} placeholder="ملاحظات مختصرة عن العميل" />
              </FieldShell>
            </div>
          </FormSection>
        </form>
      </Modal>

      <Modal
        open={isImportModalOpen}
        title="استيراد العملاء"
        description="ارفع ملف Excel أو CSV يحتوي على بيانات العملاء والمديونيات وأرقام التواصل."
        onClose={() => setImportModalOpen(false)}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={downloadSampleCsv} icon={<Download className="h-4 w-4" />}>
              تحميل نموذج CSV
            </Button>
            <Button type="button" variant="secondary" onClick={() => setImportModalOpen(false)}>إغلاق</Button>
            <Button type="button" disabled={!importFile || importMutation.isPending} onClick={() => importMutation.mutate()} icon={<Upload className="h-4 w-4" />}>
              {importMutation.isPending ? "جاري الاستيراد..." : "بدء الاستيراد"}
            </Button>
          </div>
        )}
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-dashed border-mint-200 bg-mint-50/70 p-5">
            <FieldShell label="ملف Excel أو CSV">
              <Input
                type="file"
                accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(event) => {
                  setImportFile(event.target.files?.[0] || null);
                  setImportResult(null);
                }}
              />
            </FieldShell>
            {importFile ? <p className="mt-2 text-sm font-medium text-mint-800">{importFile.name}</p> : null}
          </div>

          <div className="rounded-2xl bg-surface-50 p-4">
            <p className="font-bold text-ink-900">الأعمدة المطلوبة</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                "اسم العميل",
                "رقم الهوية",
                "الرقم الرئيسي",
                "رقم الحساب",
                "الجهة",
                "مبلغ المديونية",
                "رقم الخدمة",
                "حالة الفاتورة",
                "سنة المديونية",
                "رقم الهاتف الرئيسي"
              ].map((label) => <Badge key={label} tone="green">{label}</Badge>)}
            </div>
            <p className="mt-4 font-bold text-ink-900">أعمدة اختيارية</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>تاريخ تفعيل الخدمة</Badge>
              <Badge>تاريخ إنهاء الخدمة</Badge>
              <Badge>حالة التحصيل</Badge>
              <Badge>تاريخ السداد</Badge>
              <Badge>المبلغ المسدد</Badge>
              <Badge>رقم مرجع السداد</Badge>
              <Badge>ملاحظات السداد</Badge>
              <Badge>رقم الهاتف الفرعي1</Badge>
              <Badge>رقم الهاتف الفرعي2</Badge>
              <Badge>المحصل</Badge>
              <Badge>اسم المستخدم</Badge>
              <Badge>المتابعة</Badge>
              <Badge>ملاحظات</Badge>
            </div>
          </div>

          {importResult ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl bg-surface-50 p-4"><p className="text-sm text-ink-500">إجمالي الصفوف</p><p className="mt-1 text-2xl font-black text-ink-900">{importResult.totalRows}</p></div>
                <div className="rounded-2xl bg-mint-50 p-4"><p className="text-sm text-mint-800">تم الإنشاء</p><p className="mt-1 text-2xl font-black text-ink-900">{importResult.created}</p></div>
                <div className="rounded-2xl bg-blue-50 p-4"><p className="text-sm text-blue-700">تم التحديث</p><p className="mt-1 text-2xl font-black text-ink-900">{importResult.updated}</p></div>
                <div className="rounded-2xl bg-amber-50 p-4"><p className="text-sm text-amber-800">تم التخطي</p><p className="mt-1 text-2xl font-black text-ink-900">{importResult.skipped}</p></div>
                <div className="rounded-2xl bg-mint-50 p-4"><p className="text-sm text-mint-800">تم الإسناد</p><p className="mt-1 text-2xl font-black text-ink-900">{importResult.assigned}</p></div>
                <div className="rounded-2xl bg-amber-50 p-4"><p className="text-sm text-amber-800">غير مسند</p><p className="mt-1 text-2xl font-black text-ink-900">{importResult.unassigned || 0}</p></div>
                <div className="rounded-2xl bg-amber-50 p-4"><p className="text-sm text-amber-800">التحذيرات</p><p className="mt-1 text-2xl font-black text-ink-900">{importResult.warnings?.length || 0}</p></div>
                <div className="rounded-2xl bg-red-50 p-4"><p className="text-sm text-red-700">الأخطاء</p><p className="mt-1 text-2xl font-black text-ink-900">{importResult.errors.length}</p></div>
              </div>

              {importResult.warnings?.length ? (
                <div className="max-h-56 overflow-auto rounded-2xl border border-amber-100">
                  {importResult.warnings.map((warning, index) => (
                    <div key={`${warning.row}-${index}`} className="flex items-center justify-between gap-3 border-b border-amber-100 px-4 py-3 text-sm last:border-b-0">
                      <span className="font-bold text-ink-900">صف {warning.row}</span>
                      <span className="text-amber-800">{warning.reason}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {importResult.errors.length ? (
                <div className="max-h-56 overflow-auto rounded-2xl border border-red-100">
                  {importResult.errors.map((error, index) => (
                    <div key={`${error.row}-${index}`} className="flex items-center justify-between gap-3 border-b border-red-100 px-4 py-3 text-sm last:border-b-0">
                      <span className="font-bold text-ink-900">صف {error.row}</span>
                      <span className="text-red-700">{error.reason}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
