require("dotenv").config();

const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSIONS
} = require("../src/constants/permissions");

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required for seeding");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      passwordHash,
      role: "ADMIN",
      supervisorId: null,
      isActive: true
    },
    create: {
      email: email.toLowerCase(),
      passwordHash,
      name: "Taradi Admin",
      role: "ADMIN",
      isActive: true
    }
  });

  console.log(`Seeded admin user: ${admin.email}`);

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

  for (const role of ["SUPERVISOR", "EMPLOYEE"]) {
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

  console.log("Seeded role permissions for SUPERVISOR and EMPLOYEE");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
