const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { sanitizeUser } = require("./auth.service");
const { getPresenceForUserIds, isUserOnline } = require("./presence.service");
const ApiError = require("../utils/apiError");
const getPagination = require("../utils/pagination");

const staffRoles = ["SUPERVISOR", "EMPLOYEE"];

const staffSelect = {
  id: true,
  email: true,
  employeeCode: true,
  name: true,
  role: true,
  supervisorId: true,
  supervisor: {
    select: {
      id: true,
      email: true,
      employeeCode: true,
      name: true,
      role: true,
      isActive: true
    }
  },
  isActive: true,
  lastLoginAt: true,
  lastActivityAt: true,
  lastSeenAt: true,
  lastActivityType: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      assignedCustomers: true,
      assignedConversations: true,
      directReports: true
    }
  }
};

function normalizeEmployeeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeOptionalEmail(value) {
  const email = String(value || "").trim();
  return email ? email.toLowerCase() : null;
}

function normalizeRequiredEmail(value) {
  const email = normalizeOptionalEmail(value);

  if (!email) {
    throw new ApiError(400, "البريد الإلكتروني مطلوب");
  }

  return email;
}

function normalizeName(data) {
  return String(data.employeeName || data.supervisorName || data.name || "").trim();
}

function parseBooleanFilter(value) {
  if (value === true || value === "true" || value === "1") {
    return true;
  }

  if (value === false || value === "false" || value === "0") {
    return false;
  }

  return undefined;
}

function sanitizeStaff(user) {
  const safeUser = sanitizeUser(user);

  if (!safeUser) {
    return null;
  }

  return {
    ...safeUser,
    fullName: user.name,
    supervisorId: user.supervisorId || null,
    supervisor: user.supervisor || null,
    supervisorName: user.role === "SUPERVISOR" ? null : user.supervisor ? user.supervisor.name : null,
    employeeCode: user.employeeCode || null,
    directReportsCount: user._count ? user._count.directReports : 0,
    assignedCustomersCount: user.teamAssignedCustomersCount !== undefined
      ? user.teamAssignedCustomersCount
      : user._count ? user._count.assignedCustomers : 0,
    openConversationsCount: user.openConversationsCount || 0,
    unreadMessagesCount: user.unreadMessagesCount || 0,
    lastLoginAt: user.lastLoginAt || null,
    lastActivityAt: user.lastActivityAt || null,
    lastSeenAt: user.lastSeenAt || null,
    isOnline: Boolean(user.isOnline !== undefined ? user.isOnline : isUserOnline(user.id)),
    lastActivityType: user.lastActivityType || "NONE",
    _count: user._count
  };
}

function toTime(value) {
  return value ? new Date(value).getTime() : 0;
}

function resolveLastActivity(user, latestOutboundAt) {
  const candidates = [];

  if (user.lastActivityAt) {
    candidates.push({
      at: user.lastActivityAt,
      type: user.lastActivityType || "NONE",
      priority: 4
    });
  }

  if (user.lastLoginAt) {
    candidates.push({
      at: user.lastLoginAt,
      type: "LOGIN",
      priority: 3
    });
  }

  if (latestOutboundAt) {
    candidates.push({
      at: latestOutboundAt,
      type: "SENT_MESSAGE",
      priority: 2
    });
  }

  if (user.updatedAt) {
    candidates.push({
      at: user.updatedAt,
      type: "NONE",
      priority: 1
    });
  }

  if (!candidates.length) {
    return {
      lastActivityAt: null,
      lastActivityType: "NONE"
    };
  }

  const latest = candidates.sort((left, right) => {
    const timeDiff = toTime(right.at) - toTime(left.at);
    return timeDiff || right.priority - left.priority;
  })[0];

  return {
    lastActivityAt: latest.at,
    lastActivityType: latest.type
  };
}

async function buildEmployeeMetrics(userIds) {
  if (!userIds.length) {
    return new Map();
  }

  const [openConversationCounts, unreadConversationSums, latestOutboundMessages] = await Promise.all([
    prisma.conversation.groupBy({
      by: ["assignedEmployeeId"],
      where: {
        assignedEmployeeId: { in: userIds },
        status: "OPEN"
      },
      _count: {
        _all: true
      }
    }),
    prisma.conversation.groupBy({
      by: ["assignedEmployeeId"],
      where: {
        assignedEmployeeId: { in: userIds }
      },
      _sum: {
        unreadCount: true
      }
    }),
    prisma.message.groupBy({
      by: ["sentByUserId"],
      where: {
        sentByUserId: { in: userIds },
        direction: "OUTBOUND"
      },
      _max: {
        createdAt: true
      }
    })
  ]);

  const metrics = new Map(userIds.map((id) => [id, {
    openConversationsCount: 0,
    unreadMessagesCount: 0,
    latestOutboundMessageAt: null
  }]));

  for (const item of openConversationCounts) {
    if (!item.assignedEmployeeId || !metrics.has(item.assignedEmployeeId)) {
      continue;
    }

    metrics.get(item.assignedEmployeeId).openConversationsCount = item._count._all || 0;
  }

  for (const item of unreadConversationSums) {
    if (!item.assignedEmployeeId || !metrics.has(item.assignedEmployeeId)) {
      continue;
    }

    metrics.get(item.assignedEmployeeId).unreadMessagesCount = item._sum.unreadCount || 0;
  }

  for (const item of latestOutboundMessages) {
    if (!item.sentByUserId || !metrics.has(item.sentByUserId)) {
      continue;
    }

    metrics.get(item.sentByUserId).latestOutboundMessageAt = item._max.createdAt || null;
  }

  return metrics;
}

async function buildSupervisorAssignedCustomerCounts(supervisorIds) {
  if (!supervisorIds.length) {
    return new Map();
  }

  const [directSupervisorCounts, directReports] = await Promise.all([
    prisma.customer.groupBy({
      by: ["assignedToId"],
      where: {
        assignedToId: { in: supervisorIds }
      },
      _count: {
        _all: true
      }
    }),
    prisma.user.findMany({
      where: {
        role: "EMPLOYEE",
        supervisorId: { in: supervisorIds }
      },
      select: {
        supervisorId: true,
        _count: {
          select: {
            assignedCustomers: true
          }
        }
      }
    })
  ]);

  const counts = new Map(supervisorIds.map((id) => [id, 0]));

  for (const item of directSupervisorCounts) {
    if (!item.assignedToId || !counts.has(item.assignedToId)) {
      continue;
    }

    counts.set(item.assignedToId, counts.get(item.assignedToId) + (item._count._all || 0));
  }

  for (const report of directReports) {
    if (!report.supervisorId || !counts.has(report.supervisorId)) {
      continue;
    }

    counts.set(report.supervisorId, counts.get(report.supervisorId) + (report._count.assignedCustomers || 0));
  }

  return counts;
}

function attachEmployeeMetrics(user, metrics) {
  const userMetrics = metrics.get(user.id) || {
    openConversationsCount: 0,
    unreadMessagesCount: 0,
    latestOutboundMessageAt: null
  };
  const activity = resolveLastActivity(user, userMetrics.latestOutboundMessageAt);

  return {
    ...user,
    openConversationsCount: userMetrics.openConversationsCount,
    unreadMessagesCount: userMetrics.unreadMessagesCount,
    lastActivityAt: activity.lastActivityAt,
    lastActivityType: activity.lastActivityType
  };
}

function attachSupervisorTeamCounts(user, supervisorAssignedCustomerCounts) {
  if (user.role !== "SUPERVISOR") {
    return user;
  }

  return {
    ...user,
    teamAssignedCustomersCount: supervisorAssignedCustomerCounts.get(user.id) || 0
  };
}

function attachEmployeePresence(user, presence) {
  const onlineUserIds = new Set(presence.onlineUserIds || []);
  const lastSeenAt = presence.lastSeen ? presence.lastSeen[user.id] : user.lastSeenAt;

  return {
    ...user,
    isOnline: onlineUserIds.has(user.id),
    lastSeenAt: lastSeenAt || user.lastSeenAt || null
  };
}

async function getStaffById(id) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: staffSelect
  });

  if (!user) {
    return null;
  }

  const [metrics, presence] = await Promise.all([
    buildEmployeeMetrics([user.id]),
    getPresenceForUserIds([user.id])
  ]);
  const supervisorAssignedCustomerCounts = await buildSupervisorAssignedCustomerCounts(user.role === "SUPERVISOR" ? [user.id] : []);

  return sanitizeStaff(attachEmployeePresence(
    attachSupervisorTeamCounts(attachEmployeeMetrics(user, metrics), supervisorAssignedCustomerCounts),
    presence
  ));
}

async function assertUniqueEmployeeCode(employeeCode, ignoredUserId) {
  if (!employeeCode) {
    return;
  }

  const existing = await prisma.user.findUnique({
    where: { employeeCode }
  });

  if (existing && existing.id !== ignoredUserId) {
    throw new ApiError(409, "كود الموظف مستخدم بالفعل");
  }
}

async function assertUniqueEmail(email, ignoredUserId) {
  if (!email) {
    return;
  }

  const existing = await prisma.user.findUnique({
    where: { email }
  });

  if (existing && existing.id !== ignoredUserId) {
    throw new ApiError(409, "البريد الإلكتروني مستخدم بالفعل");
  }
}

async function assertActiveSupervisor(supervisorId) {
  if (!supervisorId) {
    throw new ApiError(400, "اسم المشرف مطلوب للموظف");
  }

  const supervisor = await prisma.user.findFirst({
    where: {
      id: supervisorId,
      role: "SUPERVISOR",
      isActive: true
    },
    select: {
      id: true
    }
  });

  if (!supervisor) {
    throw new ApiError(400, "يجب اختيار مشرف نشط");
  }

  return supervisor;
}

function buildEmployeeWhere(user, query) {
  if (user.role === "EMPLOYEE") {
    throw new ApiError(403, "لا تملك صلاحية عرض الموظفين");
  }

  const where = {
    role: { in: staffRoles }
  };

  if (user.role === "SUPERVISOR") {
    where.role = "EMPLOYEE";
    where.supervisorId = user.id;
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { employeeCode: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } }
    ];
  }

  if (staffRoles.includes(query.role)) {
    where.role = query.role;
  }

  const isActive = parseBooleanFilter(query.isActive);
  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  if (query.supervisorId && user.role === "ADMIN") {
    where.supervisorId = query.supervisorId;
  }

  if (user.role === "SUPERVISOR") {
    where.role = "EMPLOYEE";
    where.supervisorId = user.id;
  }

  return where;
}

function buildEmployeeOrderBy(query) {
  const sortOrder = String(query.sortOrder || "desc").toLowerCase() === "asc" ? "asc" : "desc";

  switch (query.sortBy) {
    case "name":
    case "fullName":
      return { name: sortOrder };
    case "employeeCode":
      return { employeeCode: sortOrder };
    case "assignedCustomersCount":
    case "assignedCustomers":
      return { assignedCustomers: { _count: sortOrder } };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

async function listEmployees(user, query) {
  const { page, limit, skip } = getPagination(query);
  const where = buildEmployeeWhere(user, query);
  const orderBy = buildEmployeeOrderBy(query);

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: staffSelect
    }),
    prisma.user.count({ where })
  ]);
  const userIds = items.map((item) => item.id);
  const supervisorIds = items.filter((item) => item.role === "SUPERVISOR").map((item) => item.id);
  const [metrics, presence, supervisorAssignedCustomerCounts] = await Promise.all([
    buildEmployeeMetrics(userIds),
    getPresenceForUserIds(userIds),
    buildSupervisorAssignedCustomerCounts(supervisorIds)
  ]);

  return {
    items: items.map((item) => sanitizeStaff(attachEmployeePresence(
      attachSupervisorTeamCounts(attachEmployeeMetrics(item, metrics), supervisorAssignedCustomerCounts),
      presence
    ))),
    meta: { page, limit, total }
  };
}

async function getPresenceScopeUserIds(user) {
  if (user.role === "ADMIN") {
    const staff = await prisma.user.findMany({
      where: {
        role: { in: staffRoles }
      },
      select: { id: true }
    });

    return staff.map((item) => item.id);
  }

  if (user.role === "SUPERVISOR") {
    const directReports = await prisma.user.findMany({
      where: {
        supervisorId: user.id,
        role: "EMPLOYEE"
      },
      select: { id: true }
    });

    return [user.id, ...directReports.map((employee) => employee.id)];
  }

  return [user.id];
}

async function getEmployeePresence(user) {
  const userIds = await getPresenceScopeUserIds(user);
  return getPresenceForUserIds(userIds);
}

async function createEmployee(data) {
  const name = normalizeName(data);
  const role = data.role;

  if (!name) {
    throw new ApiError(400, role === "SUPERVISOR" ? "اسم المشرف مطلوب" : "اسم الموظف مطلوب");
  }

  if (!staffRoles.includes(role)) {
    throw new ApiError(400, "الدور يجب أن يكون مشرف أو موظف");
  }

  if (!data.password) {
    throw new ApiError(400, "كلمة المرور مطلوبة عند إنشاء الحساب");
  }

  let email = normalizeOptionalEmail(data.email);
  let employeeCode = null;
  let supervisorId = null;

  if (role === "SUPERVISOR") {
    email = normalizeRequiredEmail(data.email);
    await assertUniqueEmail(email);
  } else {
    email = null;
    employeeCode = normalizeEmployeeCode(data.employeeCode);

    if (!employeeCode) {
      throw new ApiError(400, "كود الموظف مطلوب");
    }

    await assertUniqueEmployeeCode(employeeCode);
    await assertActiveSupervisor(data.supervisorId);
    supervisorId = data.supervisorId;
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const employee = await prisma.user.create({
    data: {
      email,
      employeeCode,
      name,
      passwordHash,
      role,
      supervisorId,
      isActive: data.isActive === undefined ? true : Boolean(data.isActive)
    }
  });

  return getStaffById(employee.id);
}

async function updateEmployee(id, data) {
  const existing = await prisma.user.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          directReports: true
        }
      }
    }
  });

  if (!existing) {
    throw new ApiError(404, "الموظف غير موجود");
  }

  if (existing.role === "ADMIN") {
    throw new ApiError(400, "لا يمكن تعديل حساب المدير من مسار الموظفين");
  }

  const updateData = {};
  const nextRole = data.role || existing.role;

  if (!staffRoles.includes(nextRole)) {
    throw new ApiError(400, "الدور يجب أن يكون مشرف أو موظف");
  }

  if (data.employeeName !== undefined || data.name !== undefined) {
    const name = normalizeName(data);

    if (!name) {
      throw new ApiError(400, nextRole === "SUPERVISOR" ? "اسم المشرف مطلوب" : "اسم الموظف مطلوب");
    }

    updateData.name = name;
  }

  if (data.role !== undefined) {
    if (existing.role === "SUPERVISOR" && nextRole === "EMPLOYEE" && existing._count.directReports > 0) {
      throw new ApiError(400, "لا يمكن تحويل مشرف لديه موظفون تابعون قبل نقلهم إلى مشرف آخر");
    }

    updateData.role = nextRole;
  }

  if (nextRole === "SUPERVISOR") {
    const shouldValidateSupervisorEmail = data.email !== undefined ||
      data.role !== undefined ||
      data.employeeName !== undefined ||
      data.supervisorName !== undefined ||
      data.name !== undefined ||
      data.password !== undefined;
    const email = data.email !== undefined ? normalizeRequiredEmail(data.email) : normalizeOptionalEmail(existing.email);

    if (shouldValidateSupervisorEmail && !email) {
      throw new ApiError(400, "البريد الإلكتروني مطلوب");
    }

    if (email) {
      await assertUniqueEmail(email, id);
      updateData.email = email;
    }

    updateData.employeeCode = null;
    updateData.supervisorId = null;
  } else {
    const employeeCode = data.employeeCode !== undefined
      ? normalizeEmployeeCode(data.employeeCode)
      : normalizeEmployeeCode(existing.employeeCode);

    if (!employeeCode) {
      throw new ApiError(400, "كود الموظف مطلوب");
    }

    await assertUniqueEmployeeCode(employeeCode, id);
    updateData.employeeCode = employeeCode;

    if (data.email !== undefined) {
      const email = normalizeOptionalEmail(data.email);

      if (email) {
        await assertUniqueEmail(email, id);
      }

      updateData.email = email;
    }

    const supervisorId = data.supervisorId !== undefined ? data.supervisorId : existing.supervisorId;

    if (!supervisorId) {
      throw new ApiError(400, "اسم المشرف مطلوب للموظف");
    }

    if (supervisorId === id) {
      throw new ApiError(400, "لا يمكن أن يكون الموظف مشرفًا على نفسه");
    }

    if (supervisorId) {
      await assertActiveSupervisor(supervisorId);
      updateData.supervisorId = supervisorId;
    }
  }

  if (data.password) {
    updateData.passwordHash = await bcrypt.hash(data.password, 12);
  }

  if (data.isActive !== undefined) {
    updateData.isActive = data.isActive;
  }

  const employee = await prisma.user.update({
    where: { id },
    data: updateData
  });

  return getStaffById(employee.id);
}

async function deactivateEmployee(id) {
  const existing = await prisma.user.findUnique({
    where: { id },
    select: { role: true }
  });

  if (!existing) {
    throw new ApiError(404, "الموظف غير موجود");
  }

  if (existing.role === "ADMIN") {
    throw new ApiError(400, "لا يمكن تعطيل حساب المدير");
  }

  return updateEmployee(id, { isActive: false });
}

async function activateEmployee(id) {
  return updateEmployee(id, { isActive: true });
}

async function assertAssignableStaff(assigneeId, actor) {
  if (!assigneeId) {
    return null;
  }

  const assignee = await prisma.user.findFirst({
    where: {
      id: assigneeId,
      role: { in: staffRoles },
      isActive: true
    },
    select: {
      id: true,
      email: true,
      employeeCode: true,
      name: true,
      role: true,
      supervisorId: true,
      isActive: true
    }
  });

  if (!assignee) {
    throw new ApiError(400, "يجب اختيار مشرف أو موظف نشط للإسناد");
  }

  if (!actor || actor.role === "ADMIN") {
    return assignee;
  }

  if (actor.role === "SUPERVISOR") {
    const inScope = assignee.id === actor.id || (
      assignee.role === "EMPLOYEE" && assignee.supervisorId === actor.id
    );

    if (inScope) {
      return assignee;
    }
  }

  throw new ApiError(403, "لا تملك صلاحية الإسناد لهذا المستخدم");
}

async function assertEmployee(employeeId) {
  return assertAssignableStaff(employeeId);
}

module.exports = {
  listEmployees,
  getEmployeePresence,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  activateEmployee,
  assertEmployee,
  assertAssignableStaff,
  assertActiveSupervisor,
  staffRoles,
  staffSelect
};
