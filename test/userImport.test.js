const test = require("node:test");
const assert = require("node:assert/strict");
const xlsx = require("xlsx");
const { parseWorkbook, validateRows } = require("../src/services/userImport.service");

function workbookFile(rows) {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), "Users");
  return { buffer: xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }), originalname: "users.xlsx" };
}

test("user import ignores empty rows and reads required columns", () => {
  const rows = parseWorkbook(workbookFile([{ name: "Ahmed", email: "a@example.com", phone: "0500000000", employeeCode: "E-1" }, { name: "", email: "", phone: "", employeeCode: "" }]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row, 2);
});

test("user import rejects duplicates inside the same file", () => {
  const result = validateRows([
    { row: 2, name: "A", email: "same@example.com", phone: "0500000000", employeeCode: "E-1" },
    { row: 3, name: "B", email: "same@example.com", phone: "0500000001", employeeCode: "E-2" }
  ]);
  assert.equal(result.valid.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /email مكرر داخل الملف/);
});

test("user import validates all mandatory fields", () => {
  const result = validateRows([{ row: 2, name: "", email: "bad", phone: "", employeeCode: "" }]);
  assert.equal(result.valid.length, 0);
  assert.match(result.errors[0].reason, /name مطلوب/);
  assert.match(result.errors[0].reason, /email غير صالح/);
  assert.match(result.errors[0].reason, /phone مطلوب/);
  assert.match(result.errors[0].reason, /employeeCode مطلوب/);
});
