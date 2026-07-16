const test = require("node:test");
const assert = require("node:assert/strict");
const xlsx = require("xlsx");
const { buildEmployeeImportTemplate, parseEmployeeImportRows } = require("../src/services/employee.service");

function workbookFile(rows) {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), "Sheet1");

  return { buffer: xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) };
}

test("employee import reads the Taradi Arabic workbook columns", () => {
  const parsed = parseEmployeeImportRows(workbookFile([{
    "الاسم": "عبدالعزيز محمد",
    "التحويلة": "237",
    "اسم المشرف": "ابراهيم الوليدي",
    "كلمة المرور": "Aa505050$$",
    "حالة الحساب": "نشط"
  }]));

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.failedRows.length, 0);
  assert.deepEqual(parsed.rows[0], {
    rowNumber: 2,
    employeeName: "عبدالعزيز محمد",
    employeeCode: "237",
    supervisorName: "ابراهيم الوليدي",
    password: "Aa505050$$",
    isActive: true
  });
});

test("employee import template uses the supported Arabic columns", () => {
  const workbook = xlsx.read(buildEmployeeImportTemplate(), { type: "buffer" });
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    defval: ""
  });

  assert.deepEqual(rows[0], ["الاسم", "التحويلة", "اسم المشرف", "كلمة المرور", "حالة الحساب"]);
});
