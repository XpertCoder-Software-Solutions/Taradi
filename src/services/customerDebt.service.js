const prisma = require("../config/prisma");
const ApiError = require("../utils/apiError");
const { customerAccessWhere, normalizeProjectName } = require("./customer.service");

const YEAR_ERROR = "سنة المديونية يجب أن تكون بين 2000 والسنة الحالية.";
const invoiceStatuses = new Set(["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"]);
const collectionStatuses = new Set(["ACTIVE_DEBT", "PAID", "PARTIALLY_PAID", "PROMISED_TO_PAY", "DISPUTED", "DO_NOT_CONTACT"]);

function parseDebtYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear()) {
    throw new ApiError(400, YEAR_ERROR);
  }
  return year;
}

function amount(value, required = false) {
  if (value === undefined && !required) return undefined;
  if (value === null || value === "") {
    if (!required) return null;
    throw new ApiError(400, "مبلغ المديونية مطلوب");
  }
  const normalized = String(value).replace(/,/g, "").trim();
  if (!Number.isFinite(Number(normalized)) || Number(normalized) < 0) {
    throw new ApiError(400, "مبلغ المديونية غير صحيح");
  }
  return normalized;
}

function optionalDate(value, label) {
  if (value === undefined) return undefined;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${label} غير صحيح`);
  return date;
}

function cleanText(value, required, label) {
  if (value === undefined && !required) return undefined;
  const text = value === null ? "" : String(value).trim();
  if (!text && required) throw new ApiError(400, `${label} مطلوب`);
  return text || null;
}

function debtData(input, partial = false) {
  const data = {};
  const put = (key, value) => { if (value !== undefined) data[key] = value; };
  put("projectName", input.projectName === undefined ? undefined : normalizeProjectName(cleanText(input.projectName, false, "الجهة")));
  put("projectNameRaw", cleanText(input.projectNameRaw, false, "الجهة"));
  put("accountNumber", cleanText(input.accountNumber, !partial, "رقم الحساب"));
  put("serviceNumber", cleanText(input.serviceNumber, false, "رقم الخدمة"));
  put("debtYear", input.debtYear === undefined && partial ? undefined : parseDebtYear(input.debtYear));
  put("debtAmount", amount(input.debtAmount, !partial));
  if (input.invoiceStatus !== undefined) {
    if (!invoiceStatuses.has(input.invoiceStatus)) throw new ApiError(400, "حالة الفاتورة غير صحيحة");
    data.invoiceStatus = input.invoiceStatus;
  }
  if (input.collectionStatus !== undefined) {
    if (!collectionStatuses.has(input.collectionStatus)) throw new ApiError(400, "حالة التحصيل غير صحيحة");
    data.collectionStatus = input.collectionStatus;
  }
  put("serviceActivationDate", optionalDate(input.serviceActivationDate, "تاريخ تفعيل الخدمة"));
  put("serviceTerminationDate", optionalDate(input.serviceTerminationDate, "تاريخ إنهاء الخدمة"));
  put("paidAmount", amount(input.paidAmount));
  put("paidAt", optionalDate(input.paidAt, "تاريخ السداد"));
  put("paymentReference", cleanText(input.paymentReference, false, "مرجع السداد"));
  put("paymentNotes", cleanText(input.paymentNotes, false, "ملاحظات السداد"));
  return data;
}

function formatDebt(debt) {
  return {
    ...debt,
    debtAmount: debt.debtAmount == null ? null : debt.debtAmount.toString(),
    paidAmount: debt.paidAmount == null ? null : debt.paidAmount.toString()
  };
}

async function accessibleCustomer(customerId, user, db = prisma) {
  const customer = await db.customer.findFirst({ where: { id: customerId, ...customerAccessWhere(user) }, select: { id: true } });
  if (!customer) throw new ApiError(404, "العميل غير موجود أو غير متاح");
  return customer;
}

async function accessibleDebt(customerId, debtId, user, db = prisma) {
  await accessibleCustomer(customerId, user, db);
  const debt = await db.customerDebt.findFirst({ where: { id: debtId, customerId } });
  if (!debt) throw new ApiError(404, "المديونية غير موجودة أو لا تخص هذا العميل");
  return debt;
}

async function listDebts(customerId, user, query = {}) {
  await accessibleCustomer(customerId, user);
  const where = { customerId };
  if (query.isActive !== undefined) where.isActive = String(query.isActive) !== "false";
  if (query.projectName) where.projectName = String(query.projectName).trim();
  if (query.debtYear) where.debtYear = parseDebtYear(query.debtYear);
  if (query.collectionStatus) where.collectionStatus = query.collectionStatus;
  if (query.invoiceStatus) where.invoiceStatus = query.invoiceStatus;
  const debts = await prisma.customerDebt.findMany({ where, orderBy: [{ isActive: "desc" }, { debtYear: "desc" }, { createdAt: "desc" }] });
  return debts.map(formatDebt);
}

async function getDebt(customerId, debtId, user) {
  return formatDebt(await accessibleDebt(customerId, debtId, user));
}

async function createDebt(customerId, user, input) {
  await accessibleCustomer(customerId, user);
  try {
    const debt = await prisma.$transaction(async (tx) => {
      const created = await tx.customerDebt.create({ data: { customerId, ...debtData(input), invoiceStatus: input.invoiceStatus || "UNPAID", collectionStatus: input.collectionStatus || "ACTIVE_DEBT" } });
      await tx.debtAuditLog.create({ data: { debtId: created.id, customerId, actorId: user.id, action: "debt.created", changes: { debtId: created.id } } });
      return created;
    });
    return formatDebt(debt);
  } catch (error) {
    if (error.code === "P2002") throw new ApiError(409, "هذه المديونية مسجلة بالفعل للعميل");
    throw error;
  }
}

async function updateDebt(customerId, debtId, user, input) {
  const existing = await accessibleDebt(customerId, debtId, user);
  const update = debtData(input, true);
  if (Object.keys(update).length === 0) throw new ApiError(400, "لا توجد بيانات للتحديث");
  const paymentChanged = ["paidAmount", "paidAt", "collectionStatus"].some((key) => Object.hasOwn(update, key));
  const debt = await prisma.$transaction(async (tx) => {
    const changed = await tx.customerDebt.update({ where: { id: debtId }, data: update });
    await tx.debtAuditLog.create({ data: { debtId, customerId, actorId: user.id, action: paymentChanged ? "debt.payment_status_changed" : "debt.updated", changes: { fields: Object.keys(update), previousCollectionStatus: existing.collectionStatus, collectionStatus: changed.collectionStatus } } });
    return changed;
  });
  return formatDebt(debt);
}

async function archiveDebt(customerId, debtId, user) {
  await accessibleDebt(customerId, debtId, user);
  const debt = await prisma.$transaction(async (tx) => {
    const archived = await tx.customerDebt.update({ where: { id: debtId }, data: { isActive: false } });
    await tx.debtAuditLog.create({ data: { debtId, customerId, actorId: user.id, action: "debt.archived", changes: { isActive: false } } });
    return archived;
  });
  return formatDebt(debt);
}

module.exports = { YEAR_ERROR, parseDebtYear, formatDebt, accessibleDebt, listDebts, getDebt, createDebt, updateDebt, archiveDebt };
