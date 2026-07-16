const prisma = require("../src/config/prisma");

async function main() {
  const [legacyCustomers, debtCustomers, debtRecords, reviewRequired] = await Promise.all([
    prisma.customer.count({ where: { accountNumber: { not: "" } } }),
    prisma.customer.count({ where: { debts: { some: {} } } }),
    prisma.customerDebt.count(),
    prisma.customerDebt.count({ where: { reviewRequired: true } })
  ]);
  const missing = await prisma.customer.count({ where: { accountNumber: { not: "" }, debts: { none: {} } } });
  process.stdout.write(`${JSON.stringify({ legacyCustomers, debtCustomers, debtRecords, missingLegacyCustomers: missing, reviewRequired, verified: missing === 0 }, null, 2)}\n`);
  if (missing > 0) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
