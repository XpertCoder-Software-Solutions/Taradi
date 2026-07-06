const { z } = require("zod");
const employeeService = require("../services/employee.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");

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
  password: z.string().min(6),
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
  password: z.string().min(6).optional().or(z.literal("")),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

const listEmployees = asyncHandler(async (req, res) => {
  const result = await employeeService.listEmployees(req.user, req.query);
  res.success(result);
});

const getPresence = asyncHandler(async (req, res) => {
  const result = await employeeService.getEmployeePresence(req.user);
  res.success(result);
});

const createEmployee = asyncHandler(async (req, res) => {
  const data = parse(createEmployeeSchema, req.body);
  const employee = await employeeService.createEmployee(data);

  res.success({ employee }, 201);
});

const updateEmployee = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const data = parse(updateEmployeeSchema, req.body);
  const employee = await employeeService.updateEmployee(id, data);

  res.success({ employee });
});

const deactivateEmployee = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const employee = await employeeService.deactivateEmployee(id);

  res.success({
    employee,
    message: "تم تعطيل الحساب"
  });
});

const activateEmployee = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const employee = await employeeService.activateEmployee(id);

  res.success({
    employee,
    message: "تم تفعيل الحساب"
  });
});

module.exports = {
  listEmployees,
  getPresence,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  activateEmployee
};
