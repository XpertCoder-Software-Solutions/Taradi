const ApiError = require("../utils/apiError");

function requireRole(...roles) {
  return function roleMiddleware(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ApiError(403, "لا تملك صلاحية تنفيذ هذه العملية");
    }

    next();
  };
}

module.exports = {
  requireRole
};
