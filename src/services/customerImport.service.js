const { parse } = require("csv-parse/sync");
const path = require("path");
const xlsx = require("xlsx");
const prisma = require("../config/prisma");
const ApiError = require("../utils/apiError");
const {
  createCustomer,
  customerAccessWhere,
  normalizeProjectName,
  updateCustomer
} = require("./customer.service");
const { assertAssignableStaff } = require("./employee.service");
const { createDebt } = require("./customerDebt.service");

const headerAliases = {
  fullName: ["fullName", "name", "الاسم", "اسم العميل", "العميل"],
  nationalId: ["nationalId", "رقم الهوية", "الهوية"],
  accountNumber: ["accountNumber", "رقم الحساب"],
  projectName: ["projectName", "project", "الجهة", "اسم المشروع", "المشروع"],
  debtAmount: ["debtAmount", "amount", "مبلغ المديونية", "مبلغ الميدونية", "المديونية"],
  serviceNumber: ["serviceNumber", "رقم الخدمة", "MSISDN"],
  serviceActivationDate: ["serviceActivationDate", "تاريخ تفعيل الخدمة", "تأريخ تفعيل الخدمة", "CREATED_DATE"],
  serviceTerminationDate: ["serviceTerminationDate", "تاريخ إنتهاء الخدمة", "تاريخ انتهاء الخدمة", "تاريخ إنهاء الخدمة", "تاريخ انهاء الخدمة", "STATUS_DATE"],
  invoiceStatus: ["invoiceStatus", "حالة الفاتورة", "SERVICE_STATUS"],
  collectionStatus: ["collectionstatus", "حالةالتحصيل"],
  paidAt: ["paidat", "paymentdate", "تاريخالسداد"],
  paidAmount: ["paidamount", "amountpaid", "المبلغالمسدد"],
  paymentReference: ["paymentreference", "paymentref", "رقممرجعالسداد", "مرجعالسداد"],
  paymentNotes: ["paymentnotes", "ملاحظاتالسداد"],
  debtYear: ["debtYear", "سنة المديونية", "تأريخ سنة المديونية", "تاريخ سنة المديونية"],
  primaryPhone: ["primaryPhone", "phone", "رقم الهاتف الرئيسي", "رقم الهاتف", "الجوال", "رقم الجوال", "الرقم الرئيسي"],
  notes: ["notes", "ملاحظات"],
  collectorName: ["collectorName", "assignee", "اسم المحصل", "المحصل", "اسم الموظف"],
  sourceUsername: ["sourceUsername", "username", "اسم المستخدم"],
  followUpStatus: ["followUpStatus", "المتابعة"],
  assignedEmployeeCode: ["assignedemployeecode", "كودالموظف"],
  assignedEmployeeEmail: ["assignedemployeeemail", "ايميلالموظف", "بريدالموظف"],
  assignedEmployeeId: ["assignedemployeeid", "معرفالموظف", "رقمالموظف"]
};

const invoiceStatusImportValues = {
  "غيرمدفوعه": "UNPAID",
  "غيرمدفوعة": "UNPAID",
  unpaid: "UNPAID",
  open: "UNPAID",
  "closedn": "UNPAID",
  "مدفوعه": "PAID",
  "مدفوعة": "PAID",
  paid: "PAID",
  scheduled: "SCHEDULED",
  "مجدوله": "SCHEDULED",
  "مجدولة": "SCHEDULED",
  disputed: "DISPUTED",
  "متنازععليها": "DISPUTED",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  "ملغيه": "CANCELLED",
  "ملغية": "CANCELLED"
};

function normalizeArabicDigits(value) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";

  return String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    if (arabicIndex !== -1) {
      return String(arabicIndex);
    }

    return String(persian.indexOf(digit));
  });
}

function normalizeHeader(value) {
  return normalizeArabicDigits(value)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeImportKey(value) {
  return normalizeHeader(value);
}

function isSecondaryPhoneHeader(header) {
  return header.startsWith("رقمالهاتفالفرعي") ||
    header.startsWith("رقمالفرعي") ||
    header.startsWith("secondaryphone") ||
    header.startsWith("additionalphone");
}

function isEmptyRow(row) {
  return row.every((value) => String(value || "").trim() === "");
}

function createHeaderMap(headers) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const map = {
    secondaryPhoneIndexes: []
  };

  for (const [field, aliases] of Object.entries(headerAliases)) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const index = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));
    if (index !== -1) {
      map[field] = index;
    }
  }

  normalizedHeaders.forEach((header, index) => {
    if (isSecondaryPhoneHeader(header)) {
      map.secondaryPhoneIndexes.push(index);
    }
  });

  return map;
}

function getCell(row, headerMap, field) {
  const index = headerMap[field];

  if (index === undefined) {
    return "";
  }

  return String(row[index] || "").trim();
}

function parseCsv(buffer) {
  try {
    return parse(buffer.toString("utf8"), {
      bom: true,
      trim: true,
      relax_column_count: true,
      skip_empty_lines: false
    });
  } catch (error) {
    throw new ApiError(400, "تعذر قراءة ملف CSV", [
      { reason: error.message }
    ]);
  }
}

function parseExcel(buffer) {
  try {
    const workbook = xlsx.read(buffer, {
      type: "buffer",
      cellDates: true
    });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new Error("Workbook has no sheets");
    }

    return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      blankrows: true,
      raw: false,
      dateNF: "dd/mm/yyyy"
    });
  } catch (error) {
    throw new ApiError(400, "تعذر قراءة ملف Excel", [
      { reason: error.message }
    ]);
  }
}

function parseImportFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (extension === ".csv") {
    return parseCsv(file.buffer);
  }

  if (extension === ".xlsx" || extension === ".xls") {
    return parseExcel(file.buffer);
  }

  throw new ApiError(400, "يجب رفع ملف Excel أو CSV فقط");
}

function normalizeSaudiPhone(value) {
  let phone = normalizeArabicDigits(value).replace(/[^\d]/g, "");

  if (phone.startsWith("00")) {
    phone = phone.slice(2);
  }

  if (phone.startsWith("966")) {
    return phone;
  }

  if (phone.startsWith("0") && phone.length === 10) {
    return `966${phone.slice(1)}`;
  }

  if (phone.startsWith("5") && phone.length === 9) {
    return `966${phone}`;
  }

  return phone;
}

function parseImportDebtAmount(value) {
  const raw = normalizeArabicDigits(value)
    .replace(/ريال|ر\.س|sar/gi, "")
    .trim();
  let normalized = raw.replace(/\s+/g, "");

  if (/^\d+,\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(",", ".");
  } else {
    normalized = normalized.replace(/[٬,]/g, "");
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(400, "مبلغ المديونية غير صحيح");
  }

  return normalized;
}

function parseExcelSerialDate(value) {
  const serial = Number(value);

  if (!Number.isFinite(serial) || serial < 1) {
    return null;
  }

  const parsed = xlsx.SSF.parse_date_code(serial);

  if (!parsed || !parsed.y || !parsed.m || !parsed.d) {
    return null;
  }

  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
}

function parseImportDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = normalizeArabicDigits(value).trim();

  if (!text) {
    return null;
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const rawYear = Number(slashMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date;
    }

    return null;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serialDate = parseExcelSerialDate(text);
    if (serialDate) {
      return serialDate;
    }
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseImportDebtYear(value) {
  const text = normalizeArabicDigits(value).trim();

  const yearMatch = text.match(/\d{4}/);
  if (yearMatch) {
    return Number(yearMatch[0]);
  }

  const date = parseImportDate(text);

  if (date) {
    return date.getUTCFullYear();
  }

  return Number(text);
}

function normalizeInvoiceStatusForImport(value, summary, rowNumber) {
  const text = String(value || "").trim();

  if (!text) {
    return {
      status: "",
      raw: ""
    };
  }

  const key = normalizeImportKey(text);
  const status = invoiceStatusImportValues[key] || text.toUpperCase();

  if (["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"].includes(status)) {
    return {
      status,
      raw: text
    };
  }

  summary.warnings.push({
    row: rowNumber,
    reason: `حالة الفاتورة غير معروفة وتم حفظها في الملاحظات: ${text}`
  });

  return {
    status: "UNPAID",
    raw: text,
    unknown: true
  };
}

function buildImportNotes(rowData, invoiceInfo) {
  const lines = [];

  if (rowData.notes) {
    lines.push(rowData.notes);
  }

  if (rowData.followUpStatus) {
    lines.push(`المتابعة: ${rowData.followUpStatus}`);
  }

  if (rowData.sourceUsername) {
    lines.push(`اسم المستخدم: ${rowData.sourceUsername}`);
  }

  if (invoiceInfo.unknown && invoiceInfo.raw) {
    lines.push(`حالة الفاتورة الأصلية: ${invoiceInfo.raw}`);
  }

  return lines.length ? lines.join("\n") : null;
}

async function findAssignedEmployee({ collectorName, assignedEmployeeCode, assignedEmployeeId, assignedEmployeeEmail }, user) {
  let employee = null;

  if (assignedEmployeeCode) {
    employee = await prisma.user.findFirst({
      where: {
        employeeCode: assignedEmployeeCode.trim().toUpperCase(),
        role: "EMPLOYEE",
        isActive: true
      },
      select: { id: true, email: true, employeeCode: true, name: true, role: true, supervisorId: true }
    });
  }

  if (!employee && assignedEmployeeId) {
    employee = await prisma.user.findFirst({
      where: {
        id: assignedEmployeeId,
        role: "EMPLOYEE",
        isActive: true
      },
      select: { id: true, email: true, employeeCode: true, name: true, role: true, supervisorId: true }
    });
  }

  if (!employee && assignedEmployeeEmail) {
    employee = await prisma.user.findFirst({
      where: {
        email: { equals: assignedEmployeeEmail, mode: "insensitive" },
        role: "EMPLOYEE",
        isActive: true
      },
      select: { id: true, email: true, employeeCode: true, name: true, role: true, supervisorId: true }
    });
  }

  if (!employee && collectorName) {
    employee = await prisma.user.findFirst({
      where: {
        name: { equals: collectorName.trim(), mode: "insensitive" },
        role: "EMPLOYEE",
        isActive: true
      },
      select: { id: true, email: true, employeeCode: true, name: true, role: true, supervisorId: true }
    });
  }

  if (!employee && collectorName) {
    const normalizedCollectorName = normalizeImportKey(collectorName);
    const candidates = await prisma.user.findMany({
      where: {
        role: "EMPLOYEE",
        isActive: true
      },
      take: 500,
      select: { id: true, email: true, employeeCode: true, name: true, role: true, supervisorId: true }
    });

    employee = candidates.find((candidate) => normalizeImportKey(candidate.name) === normalizedCollectorName) || null;
  }

  if (!employee) {
    return null;
  }

  return assertAssignableStaff(employee.id, user);
}

function buildRowData(row, headerMap) {
  return {
    fullName: getCell(row, headerMap, "fullName"),
    nationalId: getCell(row, headerMap, "nationalId"),
    accountNumber: getCell(row, headerMap, "accountNumber"),
    projectName: getCell(row, headerMap, "projectName"),
    debtAmount: getCell(row, headerMap, "debtAmount"),
    serviceNumber: getCell(row, headerMap, "serviceNumber"),
    serviceActivationDate: getCell(row, headerMap, "serviceActivationDate"),
    serviceTerminationDate: getCell(row, headerMap, "serviceTerminationDate"),
    invoiceStatus: getCell(row, headerMap, "invoiceStatus"),
    collectionStatus: getCell(row, headerMap, "collectionStatus"),
    paidAt: getCell(row, headerMap, "paidAt"),
    paidAmount: getCell(row, headerMap, "paidAmount"),
    paymentReference: getCell(row, headerMap, "paymentReference"),
    paymentNotes: getCell(row, headerMap, "paymentNotes"),
    debtYear: getCell(row, headerMap, "debtYear"),
    primaryPhone: getCell(row, headerMap, "primaryPhone"),
    secondaryPhones: headerMap.secondaryPhoneIndexes
      .map((index) => String(row[index] || "").trim())
      .filter(Boolean),
    notes: getCell(row, headerMap, "notes"),
    collectorName: getCell(row, headerMap, "collectorName"),
    sourceUsername: getCell(row, headerMap, "sourceUsername"),
    followUpStatus: getCell(row, headerMap, "followUpStatus"),
    assignedEmployeeCode: getCell(row, headerMap, "assignedEmployeeCode"),
    assignedEmployeeEmail: getCell(row, headerMap, "assignedEmployeeEmail"),
    assignedEmployeeId: getCell(row, headerMap, "assignedEmployeeId")
  };
}

function validateRow(rowData) {
  const requiredFields = [
    ["fullName", "اسم العميل مطلوب"],
    ["nationalId", "رقم الهوية مطلوب"],
    ["accountNumber", "رقم الحساب مطلوب"],
    ["projectName", "الجهة مطلوبة"],
    ["debtAmount", "مبلغ المديونية مطلوب"],
    ["serviceNumber", "رقم الخدمة مطلوب"],
    ["invoiceStatus", "حالة الفاتورة مطلوبة"],
    ["debtYear", "سنة المديونية مطلوبة"],
    ["primaryPhone", "رقم الهاتف الرئيسي مطلوب"]
  ];
  const errors = [];

  for (const [field, message] of requiredFields) {
    if (!rowData[field]) {
      errors.push(message);
    }
  }

  if (rowData.primaryPhone) {
    const phone = normalizeSaudiPhone(rowData.primaryPhone);
    if (phone.length < 6) {
      errors.push("رقم الهاتف الرئيسي غير صالح");
    }
  }

  for (const phoneInput of rowData.secondaryPhones) {
    const phone = normalizeSaudiPhone(phoneInput);
    if (phone.length < 6) {
      errors.push(`رقم هاتف فرعي غير صالح: ${phoneInput}`);
    }
  }

  if (rowData.debtAmount) {
    try {
      parseImportDebtAmount(rowData.debtAmount);
    } catch (error) {
      errors.push(error.message || "مبلغ المديونية غير صحيح");
    }
  }

  for (const [field, message] of [
    ["serviceActivationDate", "تاريخ تفعيل الخدمة غير صحيح"],
    ["serviceTerminationDate", "تاريخ انتهاء الخدمة غير صحيح"]
  ]) {
    if (rowData[field] && !parseImportDate(rowData[field])) {
      errors.push(message);
    }
  }

  const importedYear = parseImportDebtYear(rowData.debtYear);
  if (rowData.debtYear && (!Number.isInteger(importedYear) || importedYear < 2000 || importedYear > new Date().getFullYear())) {
    errors.push("سنة المديونية يجب أن تكون بين 2000 والسنة الحالية.");
  }

  return errors;
}

async function findExistingCustomer(user, rowData, primaryPhone) {
  const where = {
    ...customerAccessWhere(user),
    OR: [
      { nationalId: rowData.nationalId },
      { phone: primaryPhone },
      { phones: { some: { phoneNumber: primaryPhone } } }
    ]
  };

  return prisma.customer.findFirst({
    where,
    select: { id: true }
  });
}

async function importCustomersFromFile(file, user) {
  if (!file) {
    throw new ApiError(400, "ملف العملاء مطلوب");
  }

  const records = parseImportFile(file);
  const firstDataRowIndex = records.findIndex((row) => Array.isArray(row) && !isEmptyRow(row));

  if (firstDataRowIndex === -1) {
    throw new ApiError(400, "ملف العملاء فارغ");
  }

  const headers = records[firstDataRowIndex];
  const headerMap = createHeaderMap(headers);

  if (headerMap.fullName === undefined || headerMap.primaryPhone === undefined) {
    throw new ApiError(400, "يجب أن يحتوي ملف العملاء على أعمدة اسم العميل والرقم الرئيسي");
  }

  const summary = {
    totalRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    assigned: 0,
    unassigned: 0,
    warnings: [],
    errors: []
    ,customersCreated: 0
    ,customersUpdated: 0
    ,debtsCreated: 0
    ,debtsUpdated: 0
    ,duplicateDebtRows: 0
    ,failedRows: 0
  };

  for (let index = firstDataRowIndex + 1; index < records.length; index += 1) {
    const row = records[index];
    const rowNumber = index + 1;

    if (!Array.isArray(row) || isEmptyRow(row)) {
      continue;
    }

    summary.totalRows += 1;

    const rowData = buildRowData(row, headerMap);
    const rowErrors = validateRow(rowData);

    if (rowErrors.length > 0) {
      summary.skipped += 1;
      for (const reason of rowErrors) {
        summary.errors.push({ row: rowNumber, reason });
      }
      continue;
    }

    const requestedAssignment = Boolean(
      rowData.collectorName ||
      rowData.assignedEmployeeCode ||
      rowData.assignedEmployeeId ||
      rowData.assignedEmployeeEmail
    );
    const employee = await findAssignedEmployee(rowData, user);

    if (requestedAssignment && !employee) {
      summary.warnings.push({
        row: rowNumber,
        reason: `لم يتم العثور على المحصل "${rowData.collectorName || rowData.assignedEmployeeCode || rowData.assignedEmployeeEmail || rowData.assignedEmployeeId}"، وتم استيراد العميل بدون إسناد`
      });
    }

    const primaryPhone = normalizeSaudiPhone(rowData.primaryPhone);
    const invoiceInfo = normalizeInvoiceStatusForImport(rowData.invoiceStatus, summary, rowNumber);
    const payload = {
      fullName: rowData.fullName,
      nationalId: rowData.nationalId,
      accountNumber: rowData.accountNumber,
      projectName: normalizeProjectName(rowData.projectName),
      projectNameRaw: rowData.projectName,
      debtAmount: parseImportDebtAmount(rowData.debtAmount),
      serviceNumber: rowData.serviceNumber,
      serviceActivationDate: parseImportDate(rowData.serviceActivationDate),
      serviceTerminationDate: parseImportDate(rowData.serviceTerminationDate),
      invoiceStatus: invoiceInfo.status,
      collectionStatus: rowData.collectionStatus || undefined,
      paidAt: rowData.paidAt || undefined,
      paidAmount: rowData.paidAmount || undefined,
      paymentReference: rowData.paymentReference || undefined,
      paymentNotes: rowData.paymentNotes || undefined,
      debtYear: parseImportDebtYear(rowData.debtYear),
      primaryPhone,
      secondaryPhones: rowData.secondaryPhones.map(normalizeSaudiPhone).filter(Boolean),
      notes: buildImportNotes(rowData, invoiceInfo),
      ...(employee ? { assignedEmployeeId: employee.id } : requestedAssignment ? { assignedEmployeeId: null } : {})
    };

    try {
      const existing = await findExistingCustomer(user, rowData, primaryPhone);
      let savedCustomer = null;

      if (existing) {
        const debtPayload = {
          projectName: payload.projectName, projectNameRaw: payload.projectNameRaw,
          accountNumber: payload.accountNumber, serviceNumber: payload.serviceNumber,
          debtYear: payload.debtYear, debtAmount: payload.debtAmount,
          invoiceStatus: payload.invoiceStatus, collectionStatus: payload.collectionStatus,
          serviceActivationDate: payload.serviceActivationDate, serviceTerminationDate: payload.serviceTerminationDate,
          paidAt: payload.paidAt, paidAmount: payload.paidAmount,
          paymentReference: payload.paymentReference, paymentNotes: payload.paymentNotes
        };
        try {
          await createDebt(existing.id, user, debtPayload);
          summary.debtsCreated += 1;
        } catch (error) {
          if (error.statusCode === 409 || error.status === 409) summary.duplicateDebtRows += 1;
          else throw error;
        }
        savedCustomer = await prisma.customer.findUnique({ where: { id: existing.id } });
        summary.updated += 1;
        summary.customersUpdated += 1;
      } else {
        savedCustomer = await createCustomer(user, payload);
        summary.created += 1;
        summary.customersCreated += 1;
        summary.debtsCreated += 1;
      }

      if (savedCustomer && (savedCustomer.assignedEmployeeId || savedCustomer.assignedToId)) {
        summary.assigned += 1;
      } else {
        summary.unassigned += 1;
      }
    } catch (error) {
      summary.skipped += 1;
      summary.failedRows += 1;
      summary.errors.push({
        row: rowNumber,
        reason: error.message || "تعذر حفظ العميل"
      });
    }
  }

  return summary;
}

async function importCustomersFromCsv(file, user) {
  return importCustomersFromFile(file, user);
}

module.exports = {
  importCustomersFromCsv,
  importCustomersFromFile
};
