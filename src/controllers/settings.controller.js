const { z } = require("zod");
const permissionService = require("../services/permission.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");

const updatePermissionsSchema = z.object({
  role: z.enum(["SUPERVISOR", "EMPLOYEE"]),
  permissions: z.record(z.boolean())
});

const getPermissions = asyncHandler(async (req, res) => {
  const matrix = await permissionService.getPermissionMatrix();
  res.success(matrix);
});

const updatePermissions = asyncHandler(async (req, res) => {
  const data = parse(updatePermissionsSchema, req.body);
  const matrix = await permissionService.updateRolePermissions(data.role, data.permissions);

  res.success(matrix);
});

module.exports = {
  getPermissions,
  updatePermissions
};
