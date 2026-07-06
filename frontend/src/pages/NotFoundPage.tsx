import { Link } from "react-router-dom";
import { MessageCircleWarning } from "lucide-react";

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4" dir="rtl">
      <div className="w-full max-w-md rounded-3xl border border-white/75 bg-white p-8 text-center shadow-soft">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-mint-50 text-mint-800">
          <MessageCircleWarning className="h-7 w-7" />
        </div>
        <p className="text-4xl font-black text-ink-900">404</p>
        <p className="mt-2 text-sm text-ink-500">هذه الصفحة غير متاحة.</p>
        <Link className="mt-5 inline-flex h-11 items-center rounded-xl bg-mint-700 px-5 text-sm font-bold text-white shadow-glow hover:bg-mint-800" to="/">
          العودة إلى لوحة التحكم
        </Link>
      </div>
    </main>
  );
}
