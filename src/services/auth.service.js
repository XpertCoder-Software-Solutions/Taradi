const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const env = require("../config/env");
const ApiError = require("../utils/apiError");
const { getPermissionKeysForUser } = require("./permission.service");
const { safeRecordEmployeeActivity } = require("./employeeActivity.service");

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email || null,
    employeeCode: user.employeeCode || null,
    name: user.name,
    fullName: user.name,
    role: user.role,
    supervisorId: user.supervisorId || null,
    supervisor: user.supervisor || null,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt || null,
    lastActivityAt: user.lastActivityAt || null,
    lastSeenAt: user.lastSeenAt || null,
    lastActivityType: user.lastActivityType || "NONE",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      userId: user.id,
      role: user.role,
      employeeCode: user.employeeCode || null,
      supervisorId: user.supervisorId || null,
      fullName: user.name
    },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function login(credentials, password) {
  const email = String(credentials && credentials.email || "").trim().toLowerCase();
  const employeeCode = String(credentials && credentials.employeeCode || "").trim().toUpperCase();
  const lookup = email ? { email } : { employeeCode };

  const user = await prisma.user.findFirst({
    where: lookup,
    include: {
      supervisor: {
        select: {
          id: true,
          name: true,
          email: true,
          employeeCode: true,
          role: true,
          isActive: true
        }
      }
    }
  });

  if (!user || !user.isActive) {
    throw new ApiError(401, "بيانات الدخول غير صحيحة");
  }

  if (email && !["ADMIN", "SUPERVISOR"].includes(user.role)) {
    throw new ApiError(401, "بيانات الدخول غير صحيحة");
  }

  if (employeeCode && user.role !== "EMPLOYEE") {
    throw new ApiError(401, "بيانات الدخول غير صحيحة");
  }

  const matches = await bcrypt.compare(password, user.passwordHash);

  if (!matches) {
    throw new ApiError(401, "بيانات الدخول غير صحيحة");
  }

  const loginAt = new Date();
  await safeRecordEmployeeActivity(user, "LOGIN", loginAt);
  user.lastLoginAt = loginAt;
  user.lastActivityAt = loginAt;
  user.lastActivityType = "LOGIN";

  const permissions = await getPermissionKeysForUser(user);
  const safeUser = sanitizeUser(user);
  safeUser.permissions = permissions;

  return {
    token: signToken(user),
    user: safeUser,
    role: user.role,
    permissions
  };
}

module.exports = {
  login,
  sanitizeUser
};
