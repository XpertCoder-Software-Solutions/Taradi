const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const env = require("../config/env");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");
const { getPermissionKeysForUser } = require("../services/permission.service");

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    throw new ApiError(401, "رمز تسجيل الدخول مطلوب");
  }

  let payload;

  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (error) {
    throw new ApiError(401, "رمز تسجيل الدخول غير صالح أو منتهي");
  }

  const user = await prisma.user.findFirst({
    where: {
      id: payload.sub,
      isActive: true
    },
    select: {
      id: true,
      email: true,
      employeeCode: true,
      name: true,
      role: true,
      supervisorId: true,
      isActive: true,
      lastLoginAt: true,
      lastActivityAt: true,
      lastSeenAt: true,
      lastActivityType: true,
      createdAt: true,
      updatedAt: true,
      supervisor: {
        select: {
          id: true,
          name: true,
          email: true,
          employeeCode: true,
          role: true,
          isActive: true
        }
      },
      directReports: {
        where: {
          role: "EMPLOYEE",
          isActive: true
        },
        select: {
          id: true
        }
      }
    }
  });

  if (!user) {
    throw new ApiError(401, "انتهت الجلسة أو الحساب غير نشط");
  }

  const permissions = await getPermissionKeysForUser(user);

  req.user = {
    ...user,
    email: user.email || null,
    employeeCode: user.employeeCode || null,
    fullName: user.name,
    supervisorId: user.supervisorId || null,
    lastLoginAt: user.lastLoginAt || null,
    lastActivityAt: user.lastActivityAt || null,
    lastSeenAt: user.lastSeenAt || null,
    lastActivityType: user.lastActivityType || "NONE",
    teamMemberIds: user.directReports.map((employee) => employee.id),
    directReports: undefined,
    permissions
  };
  next();
});

module.exports = authenticate;
