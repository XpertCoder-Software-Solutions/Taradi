const { z } = require("zod");
const authService = require("../services/auth.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");
const { getPermissionKeysForUser } = require("../services/permission.service");

const loginSchema = z.object({
  email: z.string().email("البريد الإلكتروني غير صحيح").optional(),
  employeeCode: z.string().trim().min(1, "كود الموظف مطلوب").optional(),
  password: z.string().min(1, "كلمة المرور مطلوبة")
}).refine((value) => Boolean(value.email || value.employeeCode), {
  message: "البريد الإلكتروني أو كود الموظف مطلوب"
});

const login = asyncHandler(async (req, res) => {
  const data = parse(loginSchema, req.body);
  const result = await authService.login({
    email: data.email,
    employeeCode: data.employeeCode
  }, data.password);

  res.success(result);
});

const me = asyncHandler(async (req, res) => {
  const permissions = req.user.permissions || await getPermissionKeysForUser(req.user);
  res.success({
    user: {
      ...req.user,
      permissions
    },
    role: req.user.role,
    permissions
  });
});

module.exports = {
  login,
  me
};
