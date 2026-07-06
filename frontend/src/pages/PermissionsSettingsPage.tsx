import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getPermissions, updatePermissions } from "../api/settings.api";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/States";
import { useToast } from "../contexts/ToastContext";
import { cn } from "../lib/cn";
import { translateApiError } from "../lib/i18n";

type ManagedRole = "SUPERVISOR" | "EMPLOYEE";

const roleTabs: Array<{ role: ManagedRole; label: string }> = [
  { role: "SUPERVISOR", label: "صلاحيات المشرف" },
  { role: "EMPLOYEE", label: "صلاحيات الموظف" }
];

export function PermissionsSettingsPage() {
  const [activeRole, setActiveRole] = useState<ManagedRole>("SUPERVISOR");
  const [draft, setDraft] = useState<Record<ManagedRole, Record<string, boolean>>>({
    SUPERVISOR: {},
    EMPLOYEE: {}
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const permissionsQuery = useQuery({
    queryKey: ["settings", "permissions"],
    queryFn: getPermissions
  });

  useEffect(() => {
    if (permissionsQuery.data?.roles) {
      setDraft({
        SUPERVISOR: { ...permissionsQuery.data.roles.SUPERVISOR },
        EMPLOYEE: { ...permissionsQuery.data.roles.EMPLOYEE }
      });
    }
  }, [permissionsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => updatePermissions({
      role: activeRole,
      permissions: draft[activeRole]
    }),
    onSuccess: (matrix) => {
      setDraft({
        SUPERVISOR: { ...matrix.roles.SUPERVISOR },
        EMPLOYEE: { ...matrix.roles.EMPLOYEE }
      });
      queryClient.setQueryData(["settings", "permissions"], matrix);
      setConfirmOpen(false);
      pushToast({ title: "تم تحديث الصلاحيات بنجاح", tone: "success" });
    },
    onError: (error) => {
      setConfirmOpen(false);
      pushToast({ title: "حدث خطأ أثناء تحديث الصلاحيات", description: translateApiError(error), tone: "error" });
    }
  });

  function togglePermission(permissionKey: string) {
    setDraft((current) => ({
      ...current,
      [activeRole]: {
        ...current[activeRole],
        [permissionKey]: !current[activeRole][permissionKey]
      }
    }));
  }

  async function reloadPermissions() {
    const result = await permissionsQuery.refetch();

    if (result.data?.roles) {
      setDraft({
        SUPERVISOR: { ...result.data.roles.SUPERVISOR },
        EMPLOYEE: { ...result.data.roles.EMPLOYEE }
      });
    }
  }

  const categories = permissionsQuery.data?.categories || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="إعدادات الصلاحيات"
        description="تحكم في صلاحيات المشرفين والموظفين من مكان واحد."
        action={(
          <>
            <Button variant="secondary" onClick={reloadPermissions} disabled={permissionsQuery.isFetching} icon={<RefreshCw className={cn("h-4 w-4", permissionsQuery.isFetching && "animate-spin")} />}>
              إعادة تحميل
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={!permissionsQuery.data || saveMutation.isPending} icon={<Save className="h-4 w-4" />}>
              حفظ التغييرات
            </Button>
          </>
        )}
      />

      <div className="inline-flex rounded-2xl border border-surface-200 bg-white p-1 shadow-sm">
        {roleTabs.map((tab) => (
          <button
            key={tab.role}
            type="button"
            className={cn(
              "h-10 rounded-xl px-4 text-sm font-bold transition",
              activeRole === tab.role ? "bg-mint-700 text-white shadow-sm" : "text-ink-600 hover:bg-surface-100"
            )}
            onClick={() => setActiveRole(tab.role)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {permissionsQuery.isLoading ? <LoadingState label="جاري تحميل الصلاحيات..." /> : null}
      {permissionsQuery.error ? <ErrorState error={permissionsQuery.error} /> : null}
      {!permissionsQuery.isLoading && categories.length === 0 ? <EmptyState title="لا توجد صلاحيات" /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {categories.map((category) => (
          <Card key={category.key}>
            <CardHeader
              title={category.nameAr}
              action={<Badge tone="blue">{category.permissions.length}</Badge>}
            />
            <CardBody className="space-y-3">
              {category.permissions.map((permission) => {
                const checked = Boolean(draft[activeRole][permission.key]);

                return (
                  <label key={permission.key} className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 transition hover:border-mint-100 hover:bg-mint-50/60">
                    <span className="min-w-0">
                      <span className="block font-bold text-ink-900">{permission.nameAr}</span>
                      {permission.descriptionAr ? <span className="mt-1 block text-sm leading-6 text-ink-500">{permission.descriptionAr}</span> : null}
                    </span>
                    <span className={cn(
                      "relative h-7 w-12 shrink-0 rounded-full transition",
                      checked ? "bg-mint-700" : "bg-surface-300"
                    )}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => togglePermission(permission.key)}
                      />
                      <span className={cn(
                        "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition",
                        checked ? "right-6" : "right-1"
                      )} />
                    </span>
                  </label>
                );
              })}
            </CardBody>
          </Card>
        ))}
      </div>

      <Modal
        open={confirmOpen}
        title="حفظ تغييرات الصلاحيات؟"
        description="سيتم تطبيق الصلاحيات الجديدة على المستخدمين فورًا."
        onClose={() => setConfirmOpen(false)}
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>إلغاء</Button>
            <Button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()} icon={<ShieldCheck className="h-4 w-4" />}>
              نعم، حفظ
            </Button>
          </div>
        )}
      >
        <div className="rounded-2xl bg-surface-50 p-4">
          <p className="font-bold text-ink-900">{activeRole === "SUPERVISOR" ? "صلاحيات المشرف" : "صلاحيات الموظف"}</p>
          <p className="mt-1 text-sm text-ink-500">سيتم تحديث الصلاحيات لهذا الدور فقط.</p>
        </div>
      </Modal>
    </div>
  );
}
