const PERMISSION_CATEGORIES = [
  { key: "chats", nameAr: "المحادثات" },
  { key: "customers", nameAr: "العملاء" },
  { key: "employees", nameAr: "الموظفون" },
  { key: "campaigns", nameAr: "الحملات" },
  { key: "templates", nameAr: "القوالب" },
  { key: "reports", nameAr: "التقارير" },
  { key: "settings", nameAr: "الإعدادات" }
];

const PERMISSIONS = [
  {
    key: "chats.view_assigned",
    nameAr: "عرض المحادثات المسندة",
    descriptionAr: "يسمح بعرض المحادثات المسندة مباشرة للمستخدم.",
    category: "chats"
  },
  {
    key: "chats.view_team",
    nameAr: "عرض محادثات الفريق",
    descriptionAr: "يسمح للمشرف بعرض محادثاته ومحادثات الموظفين التابعين له.",
    category: "chats"
  },
  {
    key: "chats.send_message",
    nameAr: "إرسال رسالة نصية",
    descriptionAr: "يسمح بإرسال ردود نصية من المحادثة.",
    category: "chats"
  },
  {
    key: "chats.send_media",
    nameAr: "إرسال مرفقات",
    descriptionAr: "يسمح بإرسال الصور والملفات والمقاطع الصوتية.",
    category: "chats"
  },
  {
    key: "chats.mark_read",
    nameAr: "تحديد كمقروء",
    descriptionAr: "يسمح بتصفير عداد الرسائل غير المقروءة للمحادثة.",
    category: "chats"
  },
  {
    key: "chats.change_status",
    nameAr: "تغيير حالة المحادثة",
    descriptionAr: "يسمح بتغيير حالة المحادثة بين مفتوحة وقيد المتابعة ومغلقة.",
    category: "chats"
  },
  {
    key: "chats.change_priority",
    nameAr: "تغيير أولوية المحادثة",
    descriptionAr: "يسمح بتعديل أولوية المحادثة.",
    category: "chats"
  },
  {
    key: "chats.close_conversation",
    nameAr: "إغلاق المحادثة",
    descriptionAr: "يسمح بإغلاق المحادثات عند انتهاء المتابعة.",
    category: "chats"
  },
  {
    key: "customers.view_assigned",
    nameAr: "عرض العملاء المسندين",
    descriptionAr: "يسمح بعرض العملاء المسندين مباشرة للمستخدم.",
    category: "customers"
  },
  {
    key: "customers.view_team",
    nameAr: "عرض عملاء الفريق",
    descriptionAr: "يسمح للمشرف بعرض عملائه وعملاء الموظفين التابعين له.",
    category: "customers"
  },
  {
    key: "customers.create",
    nameAr: "إنشاء عميل",
    descriptionAr: "يسمح بإضافة عميل جديد.",
    category: "customers"
  },
  {
    key: "customers.edit",
    nameAr: "تعديل بيانات العميل",
    descriptionAr: "يسمح بتعديل بيانات العملاء ضمن نطاق الوصول.",
    category: "customers"
  },
  {
    key: "customers.import_csv",
    nameAr: "استيراد CSV",
    descriptionAr: "يسمح باستيراد العملاء من ملف CSV.",
    category: "customers"
  },
  {
    key: "customers.assign",
    nameAr: "إسناد العملاء",
    descriptionAr: "يسمح بتغيير الموظف أو المشرف المسند للعميل.",
    category: "customers"
  },
  {
    key: "employees.view_team",
    nameAr: "عرض فريق الموظفين",
    descriptionAr: "يسمح للمشرف بعرض الموظفين التابعين له، وللمدير بعرض كل الموظفين.",
    category: "employees"
  },
  {
    key: "employees.create",
    nameAr: "إنشاء موظف",
    descriptionAr: "يسمح بإنشاء حساب مشرف أو موظف.",
    category: "employees"
  },
  {
    key: "employees.edit",
    nameAr: "تعديل موظف",
    descriptionAr: "يسمح بتحديث بيانات حسابات الموظفين.",
    category: "employees"
  },
  {
    key: "employees.activate_deactivate",
    nameAr: "تفعيل وتعطيل الموظفين",
    descriptionAr: "يسمح بتفعيل الحسابات أو تعطيلها.",
    category: "employees"
  },
  {
    key: "campaigns.view",
    nameAr: "عرض الحملات",
    descriptionAr: "يسمح بفتح صفحة الحملات الجماعية.",
    category: "campaigns"
  },
  {
    key: "campaigns.create",
    nameAr: "إنشاء حملة",
    descriptionAr: "يسمح بتجهيز حملة واتساب جديدة.",
    category: "campaigns"
  },
  {
    key: "campaigns.send",
    nameAr: "إرسال حملة",
    descriptionAr: "يسمح بوضع رسائل الحملة في قائمة الإرسال.",
    category: "campaigns"
  },
  {
    key: "campaigns.view_reports",
    nameAr: "عرض تقارير الحملات",
    descriptionAr: "يسمح بمراجعة نتائج الحملات.",
    category: "campaigns"
  },
  {
    key: "templates.view",
    nameAr: "عرض القوالب",
    descriptionAr: "يسمح بعرض قوالب واتساب.",
    category: "templates"
  },
  {
    key: "templates.manage",
    nameAr: "إدارة القوالب",
    descriptionAr: "يسمح بإدارة إعدادات القوالب عند توفر واجهتها.",
    category: "templates"
  },
  {
    key: "reports.view",
    nameAr: "عرض التقارير",
    descriptionAr: "يسمح بفتح صفحات التقارير والتحليلات.",
    category: "reports"
  },
  {
    key: "settings.view",
    nameAr: "عرض الإعدادات",
    descriptionAr: "يسمح بفتح صفحات الإعدادات.",
    category: "settings"
  },
  {
    key: "settings.manage_permissions",
    nameAr: "إدارة الصلاحيات",
    descriptionAr: "يسمح بتعديل صلاحيات المشرفين والموظفين.",
    category: "settings"
  }
];

const DEFAULT_ROLE_PERMISSIONS = {
  SUPERVISOR: [
    "chats.view_team",
    "chats.send_message",
    "chats.send_media",
    "chats.mark_read",
    "chats.change_status",
    "chats.change_priority",
    "customers.view_team",
    "customers.create",
    "customers.edit",
    "customers.assign",
    "employees.view_team",
    "campaigns.view",
    "reports.view"
  ],
  EMPLOYEE: [
    "chats.view_assigned",
    "chats.send_message",
    "chats.send_media",
    "chats.mark_read",
    "customers.view_assigned"
  ]
};

const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);

module.exports = {
  PERMISSION_CATEGORIES,
  PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEYS
};
