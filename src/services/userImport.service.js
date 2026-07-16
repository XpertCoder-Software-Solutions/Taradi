const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const xlsx = require("xlsx");
const prisma = require("../config/prisma");
const ApiError = require("../utils/apiError");
const normalizePhone = require("../utils/normalizePhone");

const REQUIRED_COLUMNS = ["name", "email", "phone", "employeeCode"];

function temporaryPassword() {
  return `${crypto.randomBytes(12).toString("base64url")}Aa1!`;
}

function parseWorkbook(file) {
  if (!file?.buffer) throw new ApiError(400, "ملف Excel مطلوب");
  let workbook;
  try { workbook = xlsx.read(file.buffer, { type: "buffer", raw: false }); }
  catch { throw new ApiError(400, "تعذر قراءة ملف Excel"); }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new ApiError(400, "ملف Excel لا يحتوي على أوراق");
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const headers = (matrix[0] || []).map((value) => String(value).trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new ApiError(400, `الأعمدة المطلوبة غير موجودة: ${missing.join(", ")}`);
  const indexes = Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, headers.indexOf(column)]));
  const rows = matrix.slice(1).map((values, index) => ({
    row: index + 2,
    name: String(values[indexes.name] || "").trim(),
    email: String(values[indexes.email] || "").trim().toLowerCase(),
    phone: String(values[indexes.phone] || "").trim(),
    employeeCode: String(values[indexes.employeeCode] || "").trim().toUpperCase()
  })).filter((row) => row.name || row.email || row.phone || row.employeeCode);
  return rows;
}

function validateRows(rows) {
  const errors = [];
  const valid = [];
  const seen = { email: new Set(), phone: new Set(), employeeCode: new Set() };
  for (const row of rows) {
    const reasons = [];
    let phone = null;
    if (!row.name) reasons.push("name مطلوب");
    if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) reasons.push("email غير صالح");
    if (!row.phone) reasons.push("phone مطلوب");
    else {
      try { phone = normalizePhone(row.phone); } catch { reasons.push("phone غير صالح"); }
    }
    if (!row.employeeCode) reasons.push("employeeCode مطلوب");
    for (const [field, value] of [["email", row.email], ["phone", phone], ["employeeCode", row.employeeCode]]) {
      if (!value) continue;
      if (seen[field].has(value)) reasons.push(`${field} مكرر داخل الملف`);
      else seen[field].add(value);
    }
    if (reasons.length) errors.push({ row: row.row, reason: reasons.join("، ") });
    else valid.push({ ...row, phone });
  }
  return { valid, errors };
}

async function importUsers(file, actor, role) {
  if (!actor || !["ADMIN", "SUPERVISOR"].includes(actor.role)) throw new ApiError(403, "لا تملك صلاحية استيراد المستخدمين");
  if (role === "SUPERVISOR" && actor.role !== "ADMIN") throw new ApiError(403, "استيراد المشرفين متاح للمدير فقط");
  const rows = parseWorkbook(file);
  const { valid, errors } = validateRows(rows);
  if (valid.length) {
    const existing = await prisma.user.findMany({
      where: { OR: [
        { email: { in: valid.map((row) => row.email) } },
        { phone: { in: valid.map((row) => row.phone) } },
        { employeeCode: { in: valid.map((row) => row.employeeCode) } }
      ] },
      select: { email: true, phone: true, employeeCode: true }
    });
    const existingValues = {
      email: new Set(existing.map((item) => item.email).filter(Boolean)),
      phone: new Set(existing.map((item) => item.phone).filter(Boolean)),
      employeeCode: new Set(existing.map((item) => item.employeeCode).filter(Boolean))
    };
    for (let index = valid.length - 1; index >= 0; index -= 1) {
      const row = valid[index];
      const duplicates = ["email", "phone", "employeeCode"].filter((field) => existingValues[field].has(row[field]));
      if (duplicates.length) {
        errors.push({ row: row.row, reason: `${duplicates.join("، ")} مستخدم بالفعل` });
        valid.splice(index, 1);
      }
    }
  }

  const prepared = await Promise.all(valid.map(async (row) => {
    const password = temporaryPassword();
    return { row, password, passwordHash: await bcrypt.hash(password, 12) };
  }));
  const action = role === "SUPERVISOR" ? "IMPORT_SUPERVISORS" : "IMPORT_EMPLOYEES";
  await prisma.$transaction(async (tx) => {
    for (const item of prepared) {
      await tx.user.create({ data: {
        name: item.row.name, email: item.row.email, phone: item.row.phone,
        employeeCode: item.row.employeeCode, passwordHash: item.passwordHash,
        mustChangePassword: true, role,
        supervisorId: role === "EMPLOYEE" && actor.role === "SUPERVISOR" ? actor.id : null,
        isActive: true
      } });
    }
    await tx.userImportAuditLog.create({ data: {
      action, actorUserId: actor.id, importedCount: prepared.length,
      failedCount: errors.length, fileName: String(file.originalname || "users.xlsx").slice(0, 255)
    } });
  });
  errors.sort((a, b) => a.row - b.row);
  return {
    totalRows: rows.length, imported: prepared.length, failed: errors.length,
    users: prepared.map((item) => ({ name: item.row.name, email: item.row.email, phone: item.row.phone, employeeCode: item.row.employeeCode, temporaryPassword: item.password })),
    errors
  };
}

function buildTemplate(role) {
  const worksheet = xlsx.utils.json_to_sheet([{ name: "", email: "", phone: "", employeeCode: "" }]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, role === "SUPERVISOR" ? "Supervisors" : "Employees");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
}

module.exports = { REQUIRED_COLUMNS, parseWorkbook, validateRows, importUsers, buildTemplate };
