const { parse } = require("csv-parse/sync");
const prisma = require("../config/prisma");
const ApiError = require("../utils/apiError");
const normalizePhone = require("../utils/normalizePhone");
const {
  createCustomer,
  customerAccessWhere,
  updateCustomer
} = require("./customer.service");
const { assertAssignableStaff } = require("./employee.service");

const headerAliases = {
  fullName: ["fullname", "name", "الاسم", "اسمالعميل"],
  nationalId: ["nationalid", "رقمالهوية", "الهوية"],
  accountNumber: ["accountnumber", "رقمالحساب"],
  projectName: ["projectname", "project", "الجهة", "اسمالمشروع", "المشروع"],
  debtAmount: ["debtamount", "amount", "مبلغالمديونية", "المديونية"],
  serviceNumber: ["servicenumber", "رقمالخدمة"],
  serviceActivationDate: ["serviceactivationdate", "تاريختفعيلالخدمة", "تاريخالتفعيل"],
  serviceTerminationDate: ["serviceterminationdate", "تاريخإنهاءالخدمة", "تاريخانهاءالخدمة", "تاريخالإنهاء", "تاريخالانهاء"],
  invoiceStatus: ["invoicestatus", "حالةالفاتورة"],
  collectionStatus: ["collectionstatus", "حالةالتحصيل"],
  paidAt: ["paidat", "paymentdate", "تاريخالسداد"],
  paidAmount: ["paidamount", "amountpaid", "المبلغالمسدد"],
  paymentReference: ["paymentreference", "paymentref", "رقممرجعالسداد", "مرجعالسداد"],
  paymentNotes: ["paymentnotes", "ملاحظاتالسداد"],
  debtYear: ["debtyear", "سنةالمديونية"],
  primaryPhone: ["primaryphone", "phone", "رقمالهاتفالرئيسي", "رقمالهاتف", "الجوال", "رقمالجوال"],
  notes: ["notes", "ملاحظات"],
  collectorName: ["collectorname", "assignee", "اسمالمحصل", "المحصل", "اسمالموظف"],
  assignedEmployeeCode: ["assignedemployeecode", "كودالموظف"],
  assignedEmployeeEmail: ["assignedemployeeemail", "ايميلالموظف", "بريدالموظف"],
  assignedEmployeeId: ["assignedemployeeid", "معرفالموظف", "رقمالموظف"]
};

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "");
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
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
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
    try {
      const phone = normalizePhone(rowData.primaryPhone);
      if (phone.length < 6) {
        errors.push("رقم الهاتف الرئيسي غير صالح");
      }
    } catch (error) {
      errors.push("رقم الهاتف الرئيسي غير صالح");
    }
  }

  for (const phoneInput of rowData.secondaryPhones) {
    try {
      const phone = normalizePhone(phoneInput);
      if (phone.length < 6) {
        errors.push(`رقم هاتف فرعي غير صالح: ${phoneInput}`);
      }
    } catch (error) {
      errors.push(`رقم هاتف فرعي غير صالح: ${phoneInput}`);
    }
  }

  return errors;
}

async function findExistingCustomer(user, rowData, primaryPhone) {
  const where = {
    ...customerAccessWhere(user),
    OR: [
      { accountNumber: rowData.accountNumber },
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

async function importCustomersFromCsv(file, user) {
  if (!file) {
    throw new ApiError(400, "ملف CSV مطلوب");
  }

  const records = parseCsv(file.buffer);
  const firstDataRowIndex = records.findIndex((row) => Array.isArray(row) && !isEmptyRow(row));

  if (firstDataRowIndex === -1) {
    throw new ApiError(400, "ملف CSV فارغ");
  }

  const headers = records[firstDataRowIndex];
  const headerMap = createHeaderMap(headers);

  if (headerMap.fullName === undefined || headerMap.primaryPhone === undefined) {
    throw new ApiError(400, "يجب أن يحتوي ملف CSV على أعمدة اسم العميل ورقم الهاتف الرئيسي");
  }

  const summary = {
    totalRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    assigned: 0,
    errors: []
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
      summary.skipped += 1;
      summary.errors.push({
        row: rowNumber,
        reason: "لم يتم العثور على المحصل المطلوب"
      });
      continue;
    }

    const primaryPhone = normalizePhone(rowData.primaryPhone);
    const payload = {
      fullName: rowData.fullName,
      nationalId: rowData.nationalId,
      accountNumber: rowData.accountNumber,
      projectName: rowData.projectName,
      debtAmount: rowData.debtAmount,
      serviceNumber: rowData.serviceNumber,
      serviceActivationDate: rowData.serviceActivationDate || null,
      serviceTerminationDate: rowData.serviceTerminationDate || null,
      invoiceStatus: rowData.invoiceStatus,
      collectionStatus: rowData.collectionStatus || undefined,
      paidAt: rowData.paidAt || undefined,
      paidAmount: rowData.paidAmount || undefined,
      paymentReference: rowData.paymentReference || undefined,
      paymentNotes: rowData.paymentNotes || undefined,
      debtYear: rowData.debtYear,
      primaryPhone,
      secondaryPhones: rowData.secondaryPhones,
      notes: rowData.notes || null,
      ...(employee ? { assignedEmployeeId: employee.id } : {})
    };

    try {
      const existing = await findExistingCustomer(user, rowData, primaryPhone);
      if (existing) {
        await updateCustomer(existing.id, user, payload);
        summary.updated += 1;
      } else {
        await createCustomer(user, payload);
        summary.created += 1;
      }

      if (employee) {
        summary.assigned += 1;
      }
    } catch (error) {
      summary.skipped += 1;
      summary.errors.push({
        row: rowNumber,
        reason: error.message || "تعذر حفظ العميل"
      });
    }
  }

  return summary;
}

module.exports = {
  importCustomersFromCsv
};
