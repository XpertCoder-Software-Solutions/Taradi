const { z } = require("zod");
const employeeService = require("../services/employee.service");
const logger = require("../config/logger");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");
const ApiError = require("../utils/apiError");
const { hasPermission } = require("../services/permission.service");

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const optionalEmailSchema = z.preprocess(
  (value) => value === "" ? null : value,
  z.string().email().nullable().optional()
);

const supervisorIdSchema = z.preprocess(
  (value) => value === "" ? null : value,
  z.string().uuid().nullable().optional()
);

const employeeCodeSchema = z.preprocess(
  (value) => value === "" || value === null ? undefined : value,
  z.string().trim().min(1).optional()
);

const createEmployeeSchema = z.object({
  employeeName: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  supervisorName: z.string().trim().min(1).optional(),
  email: optionalEmailSchema,
  employeeCode: employeeCodeSchema,
  role: z.enum(["SUPERVISOR", "EMPLOYEE"]),
  supervisorId: supervisorIdSchema,
  password: z.string().min(8, "كلمة المرور يجب ألا تقل عن 8 أحرف"),
  isActive: z.boolean().optional()
});

const updateEmployeeSchema = z.object({
  employeeName: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  supervisorName: z.string().trim().min(1).optional(),
  email: optionalEmailSchema,
  employeeCode: employeeCodeSchema,
  role: z.enum(["SUPERVISOR", "EMPLOYEE"]).optional(),
  supervisorId: supervisorIdSchema,
  password: z.string().min(8, "كلمة المرور يجب ألا تقل عن 8 أحرف").optional().or(z.literal("")),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

const listEmployees = asyncHandler(async (req, res) => {
  const result = await employeeService.listEmployees(req.user, req.query);
  logger.debugStep("GET /api/employees returning employees", {
    roleFilter: req.query.role || "ALL",
    isActive: req.query.isActive === undefined ? "ALL" : req.query.isActive,
    supervisorId: req.query.supervisorId || null,
    userRole: req.user.role,
    count: result.items.length,
    total: result.meta.total
  });

  res.success(result);
});

const getPresence = asyncHandler(async (req, res) => {
  const result = await employeeService.getEmployeePresence(req.user);
  res.success(result);
});

const createEmployee = asyncHandler(async (req, res) => {
  const data = parse(createEmployeeSchema, req.body);
  const employee = await employeeService.createEmployee(req.user, data);

  res.success({ employee }, 201);
});

const importEmployees = asyncHandler(async (req, res) => {
  const result = await employeeService.importEmployeesFromExcel(req.file, req.user);

  res.success(result, 201);
});

const employeeImportTemplate = (req, res) => {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=employees-import-template.xlsx");
  res.send(employeeService.buildEmployeeImportTemplate());
};

const updateEmployee = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const data = parse(updateEmployeeSchema, req.body);

  if (data.isActive !== undefined && !hasPermission(req.user, "employees.activate_deactivate")) {
    throw new ApiError(403, "لا تملك صلاحية تفعيل أو تعطيل الموظفين");
  }

  const employee = await employeeService.updateEmployee(req.user, id, data);

  res.success({ employee });
});

const deactivateEmployee = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const employee = await employeeService.deactivateEmployee(req.user, id);

  res.success({
    employee,
    message: "تم تعطيل الحساب"
  });
});

const activateEmployee = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const employee = await employeeService.activateEmployee(req.user, id);

  res.success({
    employee,
    message: "تم تفعيل الحساب"
  });
});

module.exports = {
  listEmployees,
  getPresence,
  createEmployee,
  importEmployees,
  employeeImportTemplate,
  updateEmployee,
  deactivateEmployee,
  activateEmployee
};
