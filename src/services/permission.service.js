const prisma = require("../config/prisma");
const ApiError = require("../utils/apiError");
const {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PERMISSION_KEYS,
  PERMISSIONS
} = require("../constants/permissions");

const configurableRoles = ["SUPERVISOR", "EMPLOYEE"];
let seedPromise = null;

function permissionSelect() {
  return {
    id: true,
    key: true,
    nameAr: true,
    descriptionAr: true,
    category: true,
    createdAt: true,
    updatedAt: true
  };
}

async function ensurePermissionsSeeded() {
  if (!seedPromise) {
    seedPromise = (async () => {
      for (const permission of PERMISSIONS) {
        await prisma.permission.upsert({
          where: { key: permission.key },
          update: {
            nameAr: permission.nameAr,
            descriptionAr: permission.descriptionAr,
            category: permission.category
          },
          create: permission
        });
      }

      for (const role of configurableRoles) {
        const enabledDefaults = new Set(DEFAULT_ROLE_PERMISSIONS[role] || []);

        for (const permissionKey of PERMISSION_KEYS) {
          await prisma.rolePermission.upsert({
            where: {
              role_permissionKey: {
                role,
                permissionKey
              }
            },
            update: {},
            create: {
              role,
              permissionKey,
              enabled: enabledDefaults.has(permissionKey)
            }
          });
        }
      }
    })().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }

  return seedPromise;
}

function groupPermissions(permissions) {
  return PERMISSION_CATEGORIES.map((category) => ({
    ...category,
    permissions: permissions.filter((permission) => permission.category === category.key)
  }));
}

async function getPermissionMatrix() {
  await ensurePermissionsSeeded();

  const [permissions, rolePermissions] = await Promise.all([
    prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
      select: permissionSelect()
    }),
    prisma.rolePermission.findMany({
      where: { role: { in: configurableRoles } },
      select: {
        role: true,
        permissionKey: true,
        enabled: true
      }
    })
  ]);

  const roles = {
    SUPERVISOR: {},
    EMPLOYEE: {}
  };

  for (const role of configurableRoles) {
    for (const permission of permissions) {
      roles[role][permission.key] = false;
    }
  }

  for (const row of rolePermissions) {
    roles[row.role][row.permissionKey] = row.enabled;
  }

  return {
    categories: groupPermissions(permissions),
    roles
  };
}

async function updateRolePermissions(role, permissions) {
  if (!configurableRoles.includes(role)) {
    throw new ApiError(400, "يمكن تعديل صلاحيات المشرف أو الموظف فقط");
  }

  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    throw new ApiError(400, "صيغة الصلاحيات غير صحيحة");
  }

  await ensurePermissionsSeeded();

  const sentKeys = Object.keys(permissions);
  const invalidKeys = sentKeys.filter((key) => !PERMISSION_KEYS.includes(key));

  if (invalidKeys.length > 0) {
    throw new ApiError(400, "توجد صلاحيات غير معروفة", invalidKeys.map((key) => ({ key })));
  }

  await prisma.$transaction(sentKeys.map((permissionKey) => prisma.rolePermission.upsert({
    where: {
      role_permissionKey: {
        role,
        permissionKey
      }
    },
    update: {
      enabled: Boolean(permissions[permissionKey])
    },
    create: {
      role,
      permissionKey,
      enabled: Boolean(permissions[permissionKey])
    }
  })));

  return getPermissionMatrix();
}

async function getPermissionKeysForUser(user) {
  if (!user) {
    return [];
  }

  if (user.role === "ADMIN") {
    return [...PERMISSION_KEYS];
  }

  await ensurePermissionsSeeded();

  const rolePermissions = await prisma.rolePermission.findMany({
    where: {
      role: user.role,
      enabled: true
    },
    select: {
      permissionKey: true
    }
  });

  return rolePermissions.map((permission) => permission.permissionKey);
}

function hasPermission(user, permissionKey) {
  if (!user) {
    return false;
  }

  if (user.role === "ADMIN") {
    return true;
  }

  return Array.isArray(user.permissions) && user.permissions.includes(permissionKey);
}

function hasAnyPermission(user, permissionKeys) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) {
    return true;
  }

  return permissionKeys.some((permissionKey) => hasPermission(user, permissionKey));
}

module.exports = {
  ensurePermissionsSeeded,
  getPermissionMatrix,
  updateRolePermissions,
  getPermissionKeysForUser,
  hasPermission,
  hasAnyPermission
};
