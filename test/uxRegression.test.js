const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-with-at-least-32-chars";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-whatsapp-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone-number-id";
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "test-business-account-id";
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "test-verify-token";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("supervisors can reach employee creation through permissions but cannot create higher roles", () => {
  const { DEFAULT_ROLE_PERMISSIONS } = require("../src/constants/permissions");
  const employeeRoutes = read("src/routes/employee.routes.js");
  const employeeService = read("src/services/employee.service.js");
  const employeesPage = read("frontend/src/pages/EmployeesPage.tsx");

  assert.ok(DEFAULT_ROLE_PERMISSIONS.SUPERVISOR.includes("employees.create"));
  assert.match(employeeRoutes, /requireAnyPermission\("employees\.create", "employees\.view_team"\)/);
  assert.doesNotMatch(employeeRoutes, /router\.post\("\/", requireRole\("ADMIN"\)/);
  assert.match(employeeService, /actor\.role === "SUPERVISOR" && role !== "EMPLOYEE"/);
  assert.match(employeeService, /supervisorId = actor\.role === "SUPERVISOR" \? actor\.id : data\.supervisorId/);
  assert.match(employeesPage, /تمت إضافة الموظف بنجاح\./);
});

test("customers page keeps filters server-side with reset and stable loading", () => {
  const customersPage = read("frontend/src/pages/CustomersPage.tsx");

  assert.match(customersPage, /placeholderData: keepPreviousData/);
  assert.match(customersPage, /مسح الفلاتر/);
  assert.match(customersPage, /activeFiltersCount/);
  assert.doesNotMatch(customersPage, /overflow-x-auto/);
});

test("campaign builder supports paginated all-matching selection with exclusions", () => {
  const campaignsPage = read("frontend/src/pages/CampaignsPage.tsx");
  const customersApi = read("frontend/src/api/customers.api.ts");
  const messageController = read("src/controllers/message.controller.js");
  const customerService = read("src/services/customer.service.js");

  assert.match(campaignsPage, /placeholderData: keepPreviousData/);
  assert.match(campaignsPage, /setTimeout\(\(\) => \{/);
  assert.match(campaignsPage, /}, 450\)/);
  assert.match(campaignsPage, /excludedIds/);
  assert.match(campaignsPage, /تحديد كل نتائج البحث/);
  assert.match(campaignsPage, /إلغاء تحديد الكل/);
  assert.match(customersApi, /signal\?: AbortSignal/);
  assert.match(messageController, /assignmentStatus: z\.enum\(\["assigned", "unassigned"\]\)/);
  assert.match(customerService, /query\.assignmentStatus === "assigned"/);
});

test("chat media uses authenticated message media endpoint with Range-capable backend", () => {
  const app = read("src/app.js");
  const messageRoutes = read("src/routes/message.routes.js");
  const messageController = read("src/controllers/message.controller.js");
  const messageService = read("src/services/message.service.js");
  const messageBubble = read("frontend/src/components/inbox/MessageBubble.tsx");

  assert.match(app, /Media files are served through authenticated API endpoints/);
  assert.doesNotMatch(app, /express\.static\(path\.join\(process\.cwd\(\), "uploads"\)/);
  assert.match(messageRoutes, /router\.get\("\/:id\/media", messageController\.streamMedia\)/);
  assert.match(messageController, /getMessageMediaStream\(id, req\.user, req\.headers\.range\)/);
  assert.match(messageService, /statusCode: 206/);
  assert.match(messageService, /"Content-Range"/);
  assert.match(messageService, /"Accept-Ranges": "bytes"/);
  assert.match(messageBubble, /messageMediaEndpoint\(message\.id\)/);
  assert.match(messageBubble, /Authorization: `Bearer \$\{getStoredToken\(\)\}`/);
  assert.match(messageBubble, /URL\.createObjectURL\(blob\)/);
  assert.match(messageBubble, /جاري تحميل الوسائط/);
});
