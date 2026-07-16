const prisma = require("../config/prisma");
const logger = require("../config/logger");
const { assertAssignableStaff } = require("./employee.service");
const conversationService = require("./conversation.service");
const ApiError = require("../utils/apiError");
const getPagination = require("../utils/pagination");
const normalizePhone = require("../utils/normalizePhone");
const { hasPermission } = require("./permission.service");
const { safeRecordEmployeeActivity } = require("./employeeActivity.service");
const {
  getPhoneLookupVariants,
  safeNormalizePhone
} = require("../utils/normalizePhone");

const invoiceStatuses = ["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"];
const invoiceStatusLabels = {
  UNPAID: "غير مدفوعة",
  PAID: "مدفوعة",
  SCHEDULED: "مجدولة",
  DISPUTED: "متنازع عليها",
  CANCELLED: "ملغية"
};
const invoiceStatusValues = {
  "غير مدفوعة": "UNPAID",
  "مدفوعة": "PAID",
  "مجدولة": "SCHEDULED",
  "متنازع عليها": "DISPUTED",
  "ملغية": "CANCELLED"
};
const collectionStatuses = [
  "ACTIVE_DEBT",
  "PAID",
  "PARTIALLY_PAID",
  "PROMISED_TO_PAY",
  "DISPUTED",
  "DO_NOT_CONTACT"
];
const collectionStatusLabels = {
  ACTIVE_DEBT: "مديونية قائمة",
  PAID: "تم السداد",
  PARTIALLY_PAID: "سداد جزئي",
  PROMISED_TO_PAY: "وعد بالسداد",
  DISPUTED: "متنازع عليها",
  DO_NOT_CONTACT: "ممنوع التواصل"
};
const collectionStatusValues = {
  "مديونية قائمة": "ACTIVE_DEBT",
  "مديونية قائمه": "ACTIVE_DEBT",
  "تم السداد": "PAID",
  "مسدد": "PAID",
  "مدفوعة": "PAID",
  "مدفوعه": "PAID",
  "سداد جزئي": "PARTIALLY_PAID",
  "وعد بالسداد": "PROMISED_TO_PAY",
  "متنازع عليها": "DISPUTED",
  "ممنوع التواصل": "DO_NOT_CONTACT",
  "لا يتم التواصل": "DO_NOT_CONTACT"
};
const blockedCollectionStatuses = ["PAID", "DO_NOT_CONTACT"];
const contactBlockMessage = "لا يمكن التواصل مع هذا العميل لأن حالة التحصيل تمنع التواصل";

const assignedUserSelect = {
  id: true,
  email: true,
  employeeCode: true,
  name: true,
  role: true,
  supervisorId: true,
  supervisor: {
    select: {
      id: true,
      email: true,
      employeeCode: true,
      name: true,
      role: true,
      supervisorId: true,
      isActive: true
    }
  },
  isActive: true
};

function customerInclude() {
  return {
    assignedTo: {
      select: assignedUserSelect
    },
    createdBy: {
      select: assignedUserSelect
    },
    phones: {
      orderBy: [
        { isPrimary: "desc" },
        { position: "asc" },
        { createdAt: "asc" }
      ]
    },
    debts: { orderBy: [{ isActive: "desc" }, { debtYear: "desc" }, { createdAt: "desc" }] }
  };
}

function scopedAssigneeIds(user, permissionArea = "customers") {
  if (user.role === "ADMIN") {
    return null;
  }

  if (user.role === "SUPERVISOR" && hasPermission(user, `${permissionArea}.view_team`)) {
    return [user.id, ...(user.teamMemberIds || [])];
  }

  return [user.id];
}

function customerAccessWhere(user, permissionArea = "customers") {
  const assigneeIds = scopedAssigneeIds(user, permissionArea);

  if (!assigneeIds) {
    return {};
  }

  return { assignedToId: { in: assigneeIds } };
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function normalizeFalseBoolean(value) {
  return value === false || value === "false" || value === "0";
}

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeRequiredText(value, message) {
  const text = normalizeText(value);

  if (!text) {
    throw new ApiError(400, message);
  }

  return text;
}

function normalizeProjectNameKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeProjectName(name) {
  const original = String(name || "").trim();
  const key = normalizeProjectNameKey(original);
  const map = {
    mobily: "Mobily",
    موبايلي: "Mobily",
    stc: "STC",
    استيسي: "STC",
    zain: "Zain",
    زين: "Zain"
  };

  return map[key] || original;
}

function normalizeInvoiceStatus(value) {
  const text = String(value || "").trim();
  const status = invoiceStatusValues[text] || text.toUpperCase();

  if (!invoiceStatuses.includes(status)) {
    throw new ApiError(400, "حالة الفاتورة غير صحيحة");
  }

  return status;
}

function normalizeCollectionStatus(value) {
  const text = String(value || "").trim();
  const status = collectionStatusValues[text] || text.toUpperCase();

  if (!collectionStatuses.includes(status)) {
    throw new ApiError(400, "حالة التحصيل غير صحيحة");
  }

  return status;
}

function isCustomerContactBlocked(customer) {
  return blockedCollectionStatuses.includes(customer && customer.collectionStatus);
}

function getCollectionStatusLabel(status) {
  return collectionStatusLabels[status] || status || collectionStatusLabels.ACTIVE_DEBT;
}

function parseDebtAmount(value) {
  if (value === null || value === undefined || value === "") {
    throw new ApiError(400, "مبلغ المديونية مطلوب");
  }

  const normalized = String(value).replace(/,/g, "").trim();
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(400, "مبلغ المديونية غير صحيح");
  }

  return normalized;
}

function parseOptionalAmount(value, message) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(400, message);
  }

  return normalized;
}

function parseDebtYear(value) {
  const year = Number(value);
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
    throw new ApiError(400, "سنة المديونية يجب أن تكون بين 2000 والسنة الحالية.");
  }

  return year;
}

function parseDebtYearFilter(value) {
  const year = Number(value);

  if (!Number.isInteger(year)) {
    throw new ApiError(400, "سنة المديونية غير صحيحة");
  }

  return year;
}

function parseOptionalDate(value, message) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, message);
  }

  return date;
}

function getPrimaryPhone(customer) {
  const primary = customer.phones && customer.phones.find((phone) => phone.isPrimary);
  return primary ? primary.phoneNumber : customer.phone;
}

function getSecondaryPhones(customer) {
  return (customer.phones || [])
    .filter((phone) => !phone.isPrimary)
    .map((phone) => phone.phoneNumber);
}

function formatCustomerPhones(customer) {
  return (customer.phones || []).map((phone) => ({
    id: phone.id,
    customerId: phone.customerId,
    phoneNumber: phone.phoneNumber,
    isPrimary: phone.isPrimary,
    position: phone.position || 0,
    createdAt: phone.createdAt,
    updatedAt: phone.updatedAt || null
  }));
}

function formatCustomer(customer) {
  if (!customer) {
    return null;
  }

  const primaryPhone = getPrimaryPhone(customer);
  const fullName = customer.fullName || customer.name || customer.whatsappProfileName || primaryPhone;
  const secondaryPhones = getSecondaryPhones(customer);
  const phoneRecords = formatCustomerPhones(customer);
  const assignedUser = customer.assignedTo || null;
  const supervisorName = assignedUser
    ? assignedUser.role === "SUPERVISOR"
      ? assignedUser.name
      : assignedUser.supervisor ? assignedUser.supervisor.name : null
    : null;
  const debts = (customer.debts || []).map((debt) => ({
    ...debt,
    debtAmount: debt.debtAmount == null ? "0" : debt.debtAmount.toString(),
    paidAmount: debt.paidAmount == null ? null : debt.paidAmount.toString()
  }));
  const activeDebts = debts.filter((debt) => debt.isActive);
  const activeDebtTotal = activeDebts.reduce((sum, debt) => sum + Number(debt.debtAmount || 0), 0);
  const debtYears = activeDebts.map((debt) => debt.debtYear).filter(Number.isInteger);

  return {
    ...customer,
    fullName,
    name: customer.name || fullName,
    primaryPhone,
    phone: primaryPhone,
    phones: phoneRecords,
    secondaryPhones,
    secondaryPhoneDetails: phoneRecords.filter((phone) => !phone.isPrimary),
    phoneNumbersCount: 1 + secondaryPhones.length,
    invoiceStatusLabel: invoiceStatusLabels[customer.invoiceStatus] || customer.invoiceStatus,
    collectionStatus: customer.collectionStatus || "ACTIVE_DEBT",
    collectionStatusLabel: getCollectionStatusLabel(customer.collectionStatus || "ACTIVE_DEBT"),
    contactBlocked: isCustomerContactBlocked(customer),
    debtAmount: customer.debtAmount === null || customer.debtAmount === undefined
      ? "0"
      : customer.debtAmount.toString(),
    paidAmount: customer.paidAmount === null || customer.paidAmount === undefined
      ? null
      : customer.paidAmount.toString(),
    assignedEmployeeId: customer.assignedToId || null,
    assignedEmployee: assignedUser,
    assignedToId: customer.assignedToId || null,
    assignedTo: assignedUser,
    collectorName: assignedUser ? assignedUser.name : null,
    supervisorName,
    tags: customer.tags || []
    ,debts
    ,activeDebtsCount: activeDebts.length
    ,totalActiveDebtAmount: activeDebtTotal.toFixed(2)
    ,debtProjects: [...new Set(activeDebts.map((debt) => debt.projectName).filter(Boolean))]
    ,oldestDebtYear: debtYears.length ? Math.min(...debtYears) : null
    ,newestDebtYear: debtYears.length ? Math.max(...debtYears) : null
  };
}

function normalizePhoneList(primaryPhoneInput, secondaryPhoneInputs = []) {
  const primaryPhone = normalizePhone(primaryPhoneInput);
  const secondaryPhones = [];
  const seen = new Set([primaryPhone]);

  for (const phoneInput of secondaryPhoneInputs || []) {
    const raw = typeof phoneInput === "string" ? phoneInput : phoneInput && phoneInput.phoneNumber;

    if (!raw) {
      continue;
    }

    const phone = normalizePhone(raw);

    if (seen.has(phone)) {
      continue;
    }

    seen.add(phone);
    secondaryPhones.push(phone);
  }

  return {
    primaryPhone,
    secondaryPhones
  };
}

function buildPhoneCreateRows(customerId, primaryPhone, secondaryPhones) {
  return [
    {
      customerId,
      phoneNumber: primaryPhone,
      isPrimary: true,
      position: 0
    },
    ...secondaryPhones.map((phoneNumber, index) => ({
      customerId,
      phoneNumber,
      isPrimary: false,
      position: index + 1
    }))
  ];
}

async function replaceCustomerPhones(tx, customerId, primaryPhone, secondaryPhones) {
  await tx.customerPhone.deleteMany({
    where: { customerId }
  });

  await tx.customerPhone.createMany({
    data: buildPhoneCreateRows(customerId, primaryPhone, secondaryPhones)
  });
}

function buildCustomerSearchWhere(search) {
  const normalizedSearch = safeNormalizePhone(search);
  const terms = [search, normalizedSearch].filter(Boolean);
  const phoneFilters = [...new Set(terms)].flatMap((term) => [
    { phone: { contains: term } },
    { phones: { some: { phoneNumber: { contains: term } } } }
  ]);

  return [
    { fullName: { contains: search, mode: "insensitive" } },
    { name: { contains: search, mode: "insensitive" } },
    { accountNumber: { contains: search, mode: "insensitive" } },
    { projectName: { contains: search, mode: "insensitive" } },
    { serviceNumber: { contains: search, mode: "insensitive" } },
    { debts: { some: { OR: [
      { accountNumber: { contains: search, mode: "insensitive" } },
      { serviceNumber: { contains: search, mode: "insensitive" } },
      { projectName: { contains: search, mode: "insensitive" } }
    ] } } },
    ...phoneFilters,
    { nationalId: { contains: search, mode: "insensitive" } },
    { notes: { contains: search, mode: "insensitive" } }
  ];
}

function buildCustomerOrderBy(query) {
  const sortOrder = String(query.sortOrder || "desc").toLowerCase() === "asc" ? "asc" : "desc";

  switch (query.sortBy) {
    case "fullName":
    case "name":
      return [{ fullName: sortOrder }, { createdAt: "desc" }];
    case "debtAmount":
      return [{ debtAmount: sortOrder }, { createdAt: "desc" }];
    case "createdAt":
    default:
      return [{ createdAt: sortOrder }];
  }
}

async function normalizeStoredCustomerPhone(customer, normalizedPhone, include = customerInclude()) {
  if (!customer || !normalizedPhone || customer.phone === normalizedPhone) {
    return customer;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { phone: normalizedPhone }
      });

      await tx.customerPhone.upsert({
        where: { phoneNumber: normalizedPhone },
        update: {
          customerId: customer.id,
          isPrimary: true,
          position: 0
        },
        create: {
          customerId: customer.id,
          phoneNumber: normalizedPhone,
          isPrimary: true,
          position: 0
        }
      });
    });

    return prisma.customer.findUnique({
      where: { id: customer.id },
      include
    });
  } catch (error) {
    if (error.code !== "P2002") {
      throw error;
    }

    return prisma.customer.findUnique({
      where: { phone: normalizedPhone },
      include
    });
  }
}

async function findCustomerByPhone(phoneInput, options = {}) {
  const normalizedPhone = normalizePhone(phoneInput);
  const include = options.include || customerInclude();
  const exactPhone = await prisma.customerPhone.findUnique({
    where: { phoneNumber: normalizedPhone },
    include: {
      customer: {
        include
      }
    }
  });

  if (exactPhone) {
    return {
      customer: exactPhone.customer,
      normalizedPhone,
      matchedBy: exactPhone.isPrimary ? "primary_phone" : "secondary_phone"
    };
  }

  const exactLegacy = await prisma.customer.findUnique({
    where: { phone: normalizedPhone },
    include
  });

  if (exactLegacy) {
    return {
      customer: await normalizeStoredCustomerPhone(exactLegacy, normalizedPhone, include),
      normalizedPhone,
      matchedBy: "legacy_phone"
    };
  }

  const variants = getPhoneLookupVariants(phoneInput).filter((variant) => variant !== normalizedPhone);
  const variantPhone = variants.length > 0
    ? await prisma.customerPhone.findFirst({
        where: { phoneNumber: { in: variants } },
        include: {
          customer: {
            include
          }
        }
      })
    : null;

  if (variantPhone) {
    return {
      customer: variantPhone.isPrimary
        ? await normalizeStoredCustomerPhone(variantPhone.customer, normalizedPhone, include)
        : variantPhone.customer,
      normalizedPhone,
      matchedBy: variantPhone.isPrimary ? "primary_variant" : "secondary_variant"
    };
  }

  const variantLegacy = variants.length > 0
    ? await prisma.customer.findFirst({
        where: { phone: { in: variants } },
        include
      })
    : null;

  if (variantLegacy) {
    return {
      customer: await normalizeStoredCustomerPhone(variantLegacy, normalizedPhone, include),
      normalizedPhone,
      matchedBy: "legacy_variant"
    };
  }

  const suffix = normalizedPhone.slice(-4);
  const phoneCandidates = suffix
    ? await prisma.customerPhone.findMany({
        where: { phoneNumber: { contains: suffix } },
        take: 50,
        include: {
          customer: {
            include
          }
        }
      })
    : [];
  const normalizedPhoneMatch = phoneCandidates.find((candidate) => safeNormalizePhone(candidate.phoneNumber) === normalizedPhone);

  if (normalizedPhoneMatch) {
    return {
      customer: normalizedPhoneMatch.isPrimary
        ? await normalizeStoredCustomerPhone(normalizedPhoneMatch.customer, normalizedPhone, include)
        : normalizedPhoneMatch.customer,
      normalizedPhone,
      matchedBy: normalizedPhoneMatch.isPrimary ? "primary_normalized_legacy" : "secondary_normalized_legacy"
    };
  }

  const legacyCandidates = suffix
    ? await prisma.customer.findMany({
        where: { phone: { contains: suffix } },
        take: 50,
        include
      })
    : [];
  const legacyMatch = legacyCandidates.find((candidate) => safeNormalizePhone(candidate.phone) === normalizedPhone);

  if (legacyMatch) {
    return {
      customer: await normalizeStoredCustomerPhone(legacyMatch, normalizedPhone, include),
      normalizedPhone,
      matchedBy: "normalized_legacy"
    };
  }

  return {
    customer: null,
    normalizedPhone,
    matchedBy: null
  };
}

function buildCustomerWhere(user, query = {}) {
  const where = customerAccessWhere(user);

  if ((query.assignment === "unassigned" || query.assignmentStatus === "unassigned") && user.role === "ADMIN") {
    where.assignedToId = null;
  }

  if (query.assignmentStatus === "assigned" && where.assignedToId === undefined) {
    where.assignedToId = { not: null };
  }

  const assignedEmployeeId = query.assignedEmployeeId || query.assignedToId;

  if (assignedEmployeeId) {
    if (user.role === "ADMIN") {
      where.assignedToId = assignedEmployeeId;
    } else {
      const visibleIds = scopedAssigneeIds(user);

      if (visibleIds.includes(assignedEmployeeId)) {
        where.assignedToId = assignedEmployeeId;
      }
    }
  }

  if (query.search) {
    where.OR = buildCustomerSearchWhere(query.search);
  }

  if (query.projectName) {
    where.debts = { some: { ...(where.debts && where.debts.some), projectName: String(query.projectName).trim(), isActive: true } };
  }

  if (query.invoiceStatus) {
    where.debts = { some: { ...(where.debts && where.debts.some), invoiceStatus: normalizeInvoiceStatus(query.invoiceStatus), isActive: true } };
  }

  if (query.debtYear) {
    where.debts = { some: { ...(where.debts && where.debts.some), debtYear: parseDebtYearFilter(query.debtYear), isActive: true } };
  }

  if (query.collectionStatus) {
    where.debts = { some: { ...(where.debts && where.debts.some), collectionStatus: normalizeCollectionStatus(query.collectionStatus), isActive: true } };
  }

  if (query.minDebtAmount || query.maxDebtAmount) {
    where.debts = { some: { ...(where.debts && where.debts.some), isActive: true, debtAmount: {
      ...(query.minDebtAmount ? { gte: parseDebtAmount(query.minDebtAmount) } : {}),
      ...(query.maxDebtAmount ? { lte: parseDebtAmount(query.maxDebtAmount) } : {})
    } } };
  }

  if (normalizeBoolean(query.hasMultipleDebts)) {
    where.debts = { some: { ...(where.debts && where.debts.some), isActive: true } };
  }

  if (normalizeBoolean(query.paidOnly)) {
    where.collectionStatus = "PAID";
  }

  if (normalizeBoolean(query.contactBlocked)) {
    where.collectionStatus = { in: blockedCollectionStatuses };
  } else if (normalizeFalseBoolean(query.contactBlocked)) {
    where.collectionStatus = { notIn: blockedCollectionStatuses };
  }

  if (query.supervisorId) {
    where.assignedTo = {
      is: {
        OR: [
          { id: query.supervisorId, role: "SUPERVISOR" },
          { supervisorId: query.supervisorId }
        ]
      }
    };
  }

  return where;
}

async function listCustomers(user, query) {
  const { page, limit, skip } = getPagination(query);
  const where = buildCustomerWhere(user, query);

  if (normalizeBoolean(query.hasMultipleDebts)) {
    const activeDebtOwners = await prisma.customerDebt.findMany({
      where: { isActive: true, customer: { is: customerAccessWhere(user) } },
      select: { customerId: true }
    });
    const counts = new Map();
    for (const row of activeDebtOwners) counts.set(row.customerId, (counts.get(row.customerId) || 0) + 1);
    const multipleIds = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    where.id = { ...(where.id || {}), in: multipleIds };
  }

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take: limit,
      orderBy: buildCustomerOrderBy(query),
      include: customerInclude()
    }),
    prisma.customer.count({ where })
  ]);

  return {
    items: items.map(formatCustomer),
    meta: { page, limit, total }
  };
}

async function getCustomerForUser(customerId, user) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      ...customerAccessWhere(user)
    },
    include: customerInclude()
  });

  if (!customer) {
    throw new ApiError(404, "Customer not found or not accessible");
  }

  return formatCustomer(customer);
}

async function resolveAssignment(user, data, defaultToCurrentUser = true) {
  const requestedAssignedEmployeeId = data.assignedEmployeeId !== undefined
    ? data.assignedEmployeeId
    : data.assignedToId;
  let assignedToId = null;

  if (user.role === "ADMIN") {
    if (requestedAssignedEmployeeId) {
      const assignee = await assertAssignableStaff(requestedAssignedEmployeeId, user);
      if (assignee.role !== "EMPLOYEE") {
        throw new ApiError(400, "اسم المحصل يجب أن يكون موظفًا نشطًا");
      }
      assignedToId = requestedAssignedEmployeeId;
    }

    return assignedToId;
  }

  if (requestedAssignedEmployeeId) {
    if (!hasPermission(user, "customers.assign")) {
      throw new ApiError(403, "لا تملك صلاحية إسناد العملاء");
    }

    const assignee = await assertAssignableStaff(requestedAssignedEmployeeId, user);
    if (assignee.role !== "EMPLOYEE") {
      throw new ApiError(400, "اسم المحصل يجب أن يكون موظفًا نشطًا");
    }
    assignedToId = requestedAssignedEmployeeId;
  } else if (defaultToCurrentUser && user.role === "EMPLOYEE") {
    assignedToId = user.id;
  } else if (defaultToCurrentUser && user.role === "SUPERVISOR") {
    throw new ApiError(400, "اسم المحصل مطلوب");
  }

  return assignedToId;
}

function buildCreateData(user, data, assignedToId, primaryPhone) {
  const fullName = normalizeRequiredText(data.fullName || data.name, "اسم العميل مطلوب");
  const projectNameInput = data.projectNameRaw === undefined || data.projectNameRaw === null || data.projectNameRaw === ""
    ? data.projectName
    : data.projectNameRaw;
  const projectNameRaw = normalizeRequiredText(projectNameInput, "الجهة مطلوبة");
  const collectionStatus = normalizeCollectionStatus(data.collectionStatus || "ACTIVE_DEBT");
  const paidAt = data.paidAt !== undefined
    ? parseOptionalDate(data.paidAt, "تاريخ السداد غير صحيح")
    : collectionStatus === "PAID" ? new Date() : null;
  const paidAmount = parseOptionalAmount(data.paidAmount, "المبلغ المسدد غير صحيح");

  return {
    phone: primaryPhone,
    name: fullName,
    fullName,
    nationalId: normalizeRequiredText(data.nationalId, "رقم الهوية مطلوب"),
    accountNumber: normalizeRequiredText(data.accountNumber, "رقم الحساب مطلوب"),
    projectName: normalizeProjectName(projectNameRaw),
    projectNameRaw,
    debtAmount: parseDebtAmount(data.debtAmount),
    serviceNumber: normalizeRequiredText(data.serviceNumber, "رقم الخدمة مطلوب"),
    serviceActivationDate: parseOptionalDate(data.serviceActivationDate, "تاريخ تفعيل الخدمة غير صحيح"),
    serviceTerminationDate: parseOptionalDate(data.serviceTerminationDate, "تاريخ إنهاء الخدمة غير صحيح"),
    invoiceStatus: normalizeInvoiceStatus(data.invoiceStatus),
    collectionStatus,
    paidAt: collectionStatus === "PAID" && !paidAt ? new Date() : paidAt,
    paidAmount: paidAmount === undefined ? null : paidAmount,
    paymentReference: data.paymentReference === undefined ? null : normalizeText(data.paymentReference),
    paymentNotes: data.paymentNotes === undefined ? null : normalizeText(data.paymentNotes),
    debtYear: parseDebtYear(data.debtYear),
    notes: data.notes === undefined ? null : normalizeText(data.notes),
    tags: data.tags || [],
    assignedToId,
    createdById: user.id
  };
}

function buildUpdateData(data, primaryPhone, context = {}) {
  const updateData = {};

  if (primaryPhone) {
    updateData.phone = primaryPhone;
  }

  if (data.fullName !== undefined || data.name !== undefined) {
    const fullName = normalizeRequiredText(data.fullName || data.name, "اسم العميل مطلوب");
    updateData.fullName = fullName;
    updateData.name = fullName;
  }

  if (data.nationalId !== undefined) {
    updateData.nationalId = normalizeRequiredText(data.nationalId, "رقم الهوية مطلوب");
  }

  if (data.accountNumber !== undefined) {
    updateData.accountNumber = normalizeRequiredText(data.accountNumber, "رقم الحساب مطلوب");
  }

  if (data.projectName !== undefined) {
    const projectNameInput = data.projectNameRaw === undefined || data.projectNameRaw === null || data.projectNameRaw === ""
      ? data.projectName
      : data.projectNameRaw;
    const projectNameRaw = normalizeRequiredText(projectNameInput, "الجهة مطلوبة");
    updateData.projectName = normalizeProjectName(projectNameRaw);
    updateData.projectNameRaw = projectNameRaw;
  } else if (data.projectNameRaw !== undefined) {
    updateData.projectNameRaw = normalizeText(data.projectNameRaw);
  }

  if (data.debtAmount !== undefined) {
    updateData.debtAmount = parseDebtAmount(data.debtAmount);
  }

  if (data.serviceNumber !== undefined) {
    updateData.serviceNumber = normalizeRequiredText(data.serviceNumber, "رقم الخدمة مطلوب");
  }

  if (data.serviceActivationDate !== undefined) {
    updateData.serviceActivationDate = parseOptionalDate(data.serviceActivationDate, "تاريخ تفعيل الخدمة غير صحيح");
  }

  if (data.serviceTerminationDate !== undefined) {
    updateData.serviceTerminationDate = parseOptionalDate(data.serviceTerminationDate, "تاريخ إنهاء الخدمة غير صحيح");
  }

  if (data.invoiceStatus !== undefined) {
    updateData.invoiceStatus = normalizeInvoiceStatus(data.invoiceStatus);
  }

  if (data.collectionStatus !== undefined) {
    updateData.collectionStatus = normalizeCollectionStatus(data.collectionStatus);
  }

  if (data.paidAt !== undefined) {
    updateData.paidAt = parseOptionalDate(data.paidAt, "تاريخ السداد غير صحيح");
  }

  if (updateData.collectionStatus === "PAID" && !updateData.paidAt) {
    updateData.paidAt = new Date();
  }

  if (
    data.resetPayment === true &&
    updateData.collectionStatus === "ACTIVE_DEBT" &&
    context.existingCustomer &&
    context.existingCustomer.collectionStatus === "PAID"
  ) {
    if (!context.user || context.user.role !== "ADMIN") {
      throw new ApiError(403, "إعادة فتح مديونية مسددة تتطلب صلاحية مدير");
    }

    updateData.paidAt = null;
  }

  if (data.paidAmount !== undefined) {
    updateData.paidAmount = parseOptionalAmount(data.paidAmount, "المبلغ المسدد غير صحيح");
  }

  if (data.paymentReference !== undefined) {
    updateData.paymentReference = normalizeText(data.paymentReference);
  }

  if (data.paymentNotes !== undefined) {
    updateData.paymentNotes = normalizeText(data.paymentNotes);
  }

  if (data.debtYear !== undefined) {
    updateData.debtYear = parseDebtYear(data.debtYear);
  }

  if (data.notes !== undefined) {
    updateData.notes = normalizeText(data.notes);
  }

  if (data.tags !== undefined) {
    updateData.tags = data.tags || [];
  }

  return updateData;
}

function mapUniqueError(error) {
  if (error.code !== "P2002") {
    throw error;
  }

  const target = Array.isArray(error.meta && error.meta.target)
    ? error.meta.target.join(",")
    : String(error.meta && error.meta.target || "");

  if (target.includes("nationalId")) {
    throw new ApiError(409, "رقم الهوية مستخدم بالفعل");
  }

  if (target.includes("accountNumber")) {
    throw new ApiError(409, "رقم الحساب مستخدم بالفعل");
  }

  if (target.includes("phone") || target.includes("phoneNumber")) {
    throw new ApiError(409, "رقم الهاتف مستخدم بالفعل");
  }

  throw new ApiError(409, "بيانات العميل مستخدمة بالفعل");
}

function collectionStatusSystemMessage(status) {
  if (status === "PAID") {
    return "تم تحديث حالة العميل إلى تم السداد. تم إغلاق المحادثة ومنع التواصل.";
  }

  if (status === "DO_NOT_CONTACT") {
    return "تم منع التواصل مع هذا العميل.";
  }

  return null;
}

async function applyCollectionStatusSideEffects(customerId, user, collectionStatus) {
  const body = collectionStatusSystemMessage(collectionStatus);

  if (!body) {
    return;
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true, assignedToId: true }
    });

    if (!customer) {
      return;
    }

    const conversation = await tx.conversation.upsert({
      where: { activeKey: customerId },
      update: {
        status: "CLOSED",
        unreadCount: 0,
        assignedEmployeeId: customer.assignedToId || null
      },
      create: {
        customerId,
        activeKey: customerId,
        assignedEmployeeId: customer.assignedToId || null,
        status: "CLOSED",
        unreadCount: 0,
        lastMessageAt: now
      }
    });

    const message = await tx.message.create({
      data: {
        customerId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        type: "SYSTEM",
        content: body,
        body,
        status: "SENT",
        sentByUserId: user && user.id ? user.id : null,
        statusUpdatedAt: now,
        createdAt: now
      }
    });

    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "CLOSED",
        unreadCount: 0,
        lastMessageId: message.id,
        lastMessageAt: now
      }
    });
  });

  logger.info({
    customerId,
    collectionStatus,
    userId: user && user.id
  }, "Customer collection status blocked contact and closed conversation");
}

async function createCustomer(user, data) {
  const { primaryPhone, secondaryPhones } = normalizePhoneList(data.primaryPhone || data.phone, data.secondaryPhones);
  const assignedToId = await resolveAssignment(user, data);

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const createData = buildCreateData(user, data, assignedToId, primaryPhone);
      const created = await tx.customer.create({
        data: createData
      });

      await replaceCustomerPhones(tx, created.id, primaryPhone, secondaryPhones);
      await tx.customerDebt.create({
        data: {
          customerId: created.id,
          projectName: createData.projectName,
          projectNameRaw: createData.projectNameRaw,
          accountNumber: createData.accountNumber,
          serviceNumber: createData.serviceNumber,
          debtYear: createData.debtYear,
          debtAmount: createData.debtAmount,
          invoiceStatus: createData.invoiceStatus,
          collectionStatus: createData.collectionStatus,
          serviceActivationDate: createData.serviceActivationDate,
          serviceTerminationDate: createData.serviceTerminationDate,
          paidAmount: createData.paidAmount,
          paidAt: createData.paidAt,
          paymentReference: createData.paymentReference,
          paymentNotes: createData.paymentNotes
        }
      });

      return created;
    });

    await conversationService.syncConversationAssignment(customer.id, assignedToId);
    if (isCustomerContactBlocked(customer)) {
      await applyCollectionStatusSideEffects(customer.id, user, customer.collectionStatus);
    }

    const formattedCustomer = await getCustomerForUser(customer.id, {
      ...user,
      role: "ADMIN"
    });

    return formattedCustomer;
  } catch (error) {
    mapUniqueError(error);
  }
}

async function updateCustomer(customerId, user, data) {
  const existingCustomer = await getCustomerForUser(customerId, user);

  const hasPhoneUpdate = data.primaryPhone !== undefined || data.phone !== undefined || data.secondaryPhones !== undefined;
  const phoneList = hasPhoneUpdate
    ? normalizePhoneList(data.primaryPhone || data.phone || existingCustomer.primaryPhone, data.secondaryPhones)
    : null;
  const updateData = buildUpdateData(data, phoneList ? phoneList.primaryPhone : null, {
    existingCustomer,
    user
  });
  const requestedAssignedEmployeeId = data.assignedEmployeeId !== undefined
    ? data.assignedEmployeeId
    : data.assignedToId;
  const assignmentRequested = requestedAssignedEmployeeId !== undefined;
  const assignmentReason = normalizeText(data.assignmentReason || data.reassignmentReason);
  let nextAssignedToId;
  let nextAssignee = null;

  if (assignmentRequested) {
    if (!hasPermission(user, "customers.assign")) {
      throw new ApiError(403, "لا تملك صلاحية إسناد العملاء");
    }

    if (requestedAssignedEmployeeId) {
      const assignee = await assertAssignableStaff(requestedAssignedEmployeeId, user);
      if (assignee.role !== "EMPLOYEE") {
        throw new ApiError(400, "اسم المحصل يجب أن يكون موظفًا نشطًا");
      }
      nextAssignee = assignee;
    } else if (user.role !== "ADMIN") {
      throw new ApiError(403, "لا يمكن للمشرف إلغاء إسناد العميل");
    }

    nextAssignedToId = requestedAssignedEmployeeId || null;
  }

  try {
    let reassignment = null;
    const customer = await prisma.$transaction(async (tx) => {
      if (assignmentRequested) {
        await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
      }

      const updated = Object.keys(updateData).length > 0
        ? await tx.customer.update({
            where: { id: customerId },
            data: updateData,
            include: {
              assignedTo: { select: assignedUserSelect }
            }
          })
        : await tx.customer.findUnique({
            where: { id: customerId },
            include: {
              assignedTo: { select: assignedUserSelect }
            }
          });

      if (phoneList) {
        await replaceCustomerPhones(tx, customerId, phoneList.primaryPhone, phoneList.secondaryPhones);
      }

      if (assignmentRequested) {
        reassignment = await conversationService.reassignCustomerConversationInTransaction(tx, {
          customerId,
          newAssigneeId: nextAssignedToId,
          actor: user,
          reason: assignmentReason,
          preloadedCustomer: updated,
          newAssignee: nextAssignee
        });
      }

      return assignmentRequested
        ? tx.customer.findUnique({
            where: { id: customerId },
            include: customerInclude()
          })
        : updated;
    });

    if (
      Object.prototype.hasOwnProperty.call(updateData, "collectionStatus") &&
      updateData.collectionStatus !== existingCustomer.collectionStatus &&
      isCustomerContactBlocked(customer)
    ) {
      await applyCollectionStatusSideEffects(customer.id, user, customer.collectionStatus);
    }

    await safeRecordEmployeeActivity(
      user,
      assignmentRequested ? "ASSIGNED_CUSTOMER" : "UPDATED_CUSTOMER",
      new Date()
    );

    const formattedCustomer = await getCustomerForUser(customer.id, {
      ...user,
      role: "ADMIN"
    });

    return assignmentRequested && reassignment
      ? { customer: formattedCustomer, reassignment }
      : formattedCustomer;
  } catch (error) {
    mapUniqueError(error);
  }
}

async function assignCustomer(customerId, user, employeeId, options = {}) {
  await getCustomerForUser(customerId, user);
  let assignee = null;

  if (employeeId) {
    assignee = await assertAssignableStaff(employeeId, user);
    if (assignee.role !== "EMPLOYEE") {
      throw new ApiError(400, "اسم المحصل يجب أن يكون موظفًا نشطًا");
    }
  } else if (user.role !== "ADMIN") {
    throw new ApiError(403, "لا يمكن للمشرف إلغاء إسناد العميل");
  }

  const reassignment = await conversationService.reassignCustomerConversation(customerId, employeeId || null, user, {
    reason: options.reason || null,
    newAssignee: assignee
  });

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: customerInclude()
  });

  await safeRecordEmployeeActivity(user, "ASSIGNED_CUSTOMER", new Date());

  return {
    customer: formatCustomer(customer),
    reassignment
  };
}

async function updateCustomerCollectionStatus(customerId, user, data) {
  const customer = await updateCustomer(customerId, user, data);

  logger.info({
    customerId,
    userId: user && user.id,
    collectionStatus: customer.collectionStatus,
    contactBlocked: customer.contactBlocked
  }, "Customer collection status updated");

  return customer;
}

async function deleteCustomer(customerId) {
  await prisma.customer.delete({
    where: { id: customerId }
  });
}

module.exports = {
  assignedUserSelect,
  customerAccessWhere,
  customerInclude,
  buildCustomerWhere,
  buildCustomerOrderBy,
  buildCustomerSearchWhere,
  findCustomerByPhone,
  formatCustomer,
  invoiceStatuses,
  invoiceStatusLabels,
  collectionStatuses,
  collectionStatusLabels,
  blockedCollectionStatuses,
  contactBlockMessage,
  normalizeProjectName,
  normalizeCollectionStatus,
  isCustomerContactBlocked,
  getCollectionStatusLabel,
  listCustomers,
  getCustomerForUser,
  createCustomer,
  updateCustomer,
  updateCustomerCollectionStatus,
  assignCustomer,
  deleteCustomer
};
