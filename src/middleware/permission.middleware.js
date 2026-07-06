const ApiError = require("../utils/apiError");
const { hasAnyPermission, hasPermission } = require("../services/permission.service");

function requirePermission(permissionKey) {
  return function permissionMiddleware(req, res, next) {
    if (!hasPermission(req.user, permissionKey)) {
      throw new ApiError(403, "لا تملك صلاحية تنفيذ هذه العملية");
    }

    next();
  };
}

function requireAnyPermission(...permissionKeys) {
  return function anyPermissionMiddleware(req, res, next) {
    if (!hasAnyPermission(req.user, permissionKeys)) {
      throw new ApiError(403, "لا تملك صلاحية تنفيذ هذه العملية");
    }

    next();
  };
}

module.exports = {
  requirePermission,
  requireAnyPermission
};
