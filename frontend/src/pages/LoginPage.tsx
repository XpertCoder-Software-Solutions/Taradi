import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, LockKeyhole, MessageCircle, UserRound } from "lucide-react";
import { z } from "zod";
import { Button } from "../components/ui/Button";
import { FieldShell, Input } from "../components/ui/Field";
import { API_BASE_URL } from "../lib/api";
import { debugLog } from "../lib/debug";
import { useAuth } from "../contexts/AuthContext";
import { translateApiError } from "../lib/i18n";

const loginSchema = z.object({
  login: z.string().trim().min(1, "البريد الإلكتروني أو كود الموظف مطلوب"),
  password: z.string().min(1, "كلمة المرور مطلوبة")
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      login: "",
      password: ""
    }
  });

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(values: LoginValues) {
    const loginValue = values.login.trim();
    debugLog("Login submit started", {
      login: loginValue,
      apiBaseUrl: API_BASE_URL
    });

    try {
      await login(loginValue.includes("@")
        ? { email: loginValue, password: values.password }
        : { employeeCode: loginValue, password: values.password });
      debugLog("Login submit completed");
      const destination = (location.state as { from?: Location } | null)?.from?.pathname || "/";
      navigate(destination, { replace: true });
    } catch (error) {
      debugLog("Login submit failed", error);
      form.setError("root", { message: translateApiError(error) });
    }
  }

  function onInvalid() {
    debugLog("Login submit blocked by validation", {
      values: form.getValues(),
      errors: form.formState.errors
    });
    form.setError("root", {
      message: "يرجى إدخال البريد الإلكتروني أو كود الموظف وكلمة المرور قبل الدخول."
    });
  }

  return (
    <main className="grid min-h-screen place-items-center overflow-hidden bg-[radial-gradient(circle_at_top_right,#ecfdf5,transparent_36%),linear-gradient(135deg,#f8fafc,#eef2ff)] px-4 py-8" dir="rtl">
      <section className="w-full max-w-md rounded-3xl border border-white/75 bg-white/95 p-7 shadow-soft backdrop-blur">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-mint-900 to-mint-500 text-white shadow-glow">
            <MessageCircle className="h-8 w-8" />
          </div>
          <p className="text-3xl font-black text-ink-900">تسجيل الدخول</p>
          <p className="mt-2 text-sm font-medium text-ink-500">لوحة إدارة محادثات تراضي</p>
        </div>

        <form className="space-y-4" noValidate onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
          <FieldShell label="البريد الإلكتروني أو كود الموظف" error={form.formState.errors.login?.message}>
            <div className="relative">
              <UserRound className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input className="pr-9" autoComplete="username" {...form.register("login")} />
            </div>
          </FieldShell>

          <FieldShell label="كلمة المرور" error={form.formState.errors.password?.message}>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input className="pr-9" type="password" autoComplete="current-password" {...form.register("password")} />
            </div>
          </FieldShell>

          {form.formState.errors.root?.message ? (
            <div className="rounded-2xl bg-red-50 px-3 py-2 text-sm font-medium text-signal-red">
              {form.formState.errors.root.message}
            </div>
          ) : null}

          <Button className="w-full" size="lg" type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري الدخول
              </>
            ) : "دخول"}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs font-semibold text-ink-500" dir="ltr">
          Powered by XpertCoder Software Solutions
        </p>
      </section>
    </main>
  );
}
