const prisma = require("../../config/prisma");
const env = require("../../config/env");
const logger = require("../../config/logger");
const whatsapp = require("../../services/whatsapp.service");
const messageService = require("../../services/message.service");
const getPagination = require("../../utils/pagination");
const {
  contactBlockMessage,
  getCustomerForUser,
  isCustomerContactBlocked
} = require("../../services/customer.service");
const ApiError = require("../../utils/apiError");
const normalizePhone = require("../../utils/normalizePhone");
const { friendlyWhatsAppFailureMessage } = require("../../utils/whatsappErrors");
const {
  applyDefaultMappingProfile,
  detectTemplateVariables
} = require("./templateMapping.service");

const TEMPLATE_NOT_APPROVED_MESSAGE = "هذا القالب غير معتمد أو تم تعطيله.";
const TEMPLATE_AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VARIABLE_PATTERN = /\{\{\s*(\d+)\s*\}\}/g;

let autoSyncInterval = null;
let initialSyncTimer = null;
let activeSyncPromise = null;

function normalizeTemplateStatus(status) {
  return String(status || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function findComponent(components, type) {
  return components.find((component) => upper(component.type) === type) || null;
}

function extractVariablesFromText(text, component, extra = {}) {
  if (!text) {
    return [];
  }

  const variables = [];
  const seen = new Set();
  let match;

  VARIABLE_PATTERN.lastIndex = 0;

  while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
    const index = Number(match[1]);

    if (!Number.isInteger(index) || index < 1) {
      continue;
    }

    const key = `${component}:${extra.buttonIndex ?? ""}:${index}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    variables.push({
      index,
      token: `{{${index}}}`,
      component,
      ...extra
    });
  }

  return variables;
}

function collectTemplateVariables(components) {
  const variables = [];

  for (const component of components) {
    const componentType = upper(component.type);

    if (["HEADER", "BODY", "FOOTER"].includes(componentType)) {
      variables.push(...extractVariablesFromText(component.text, componentType.toLowerCase()));
    }

    if (componentType === "BUTTONS" && Array.isArray(component.buttons)) {
      component.buttons.forEach((button, buttonIndex) => {
        variables.push(...extractVariablesFromText(button.url, "button", {
          buttonIndex,
          buttonType: upper(button.type) || null,
          source: "url"
        }));
      });
    }
  }

  return variables.sort((a, b) => {
    if (a.index !== b.index) {
      return a.index - b.index;
    }

    if (a.component !== b.component) {
      return a.component.localeCompare(b.component);
    }

    return (a.buttonIndex ?? -1) - (b.buttonIndex ?? -1);
  });
}

function normalizeMetaTemplate(metaTemplate) {
  const components = Array.isArray(metaTemplate.components) ? metaTemplate.components : [];
  const header = findComponent(components, "HEADER");
  const body = findComponent(components, "BODY");
  const footer = findComponent(components, "FOOTER");
  const buttons = findComponent(components, "BUTTONS");
  const headerType = header
    ? upper(header.format || (header.text ? "TEXT" : header.type))
    : null;

  return {
    metaTemplateId: normalizeNullableString(metaTemplate.id),
    name: normalizeNullableString(metaTemplate.name),
    language: normalizeNullableString(metaTemplate.language),
    category: normalizeNullableString(metaTemplate.category),
    status: normalizeTemplateStatus(metaTemplate.status),
    components,
    qualityScore: metaTemplate.quality_score || metaTemplate.qualityScore || null,
    rejectedReason: normalizeNullableString(metaTemplate.rejected_reason || metaTemplate.rejectedReason),
    headerType,
    headerText: normalizeNullableString(header && header.text),
    body: normalizeNullableString(body && body.text),
    footer: normalizeNullableString(footer && footer.text),
    buttons: buttons && Array.isArray(buttons.buttons) ? buttons.buttons : [],
    variables: collectTemplateVariables(components),
    rawMetaResponse: metaTemplate,
    isActive: true,
    lastSyncedAt: new Date()
  };
}

function formatTemplate(template) {
  if (!template) {
    return null;
  }

  return {
    id: template.id,
    metaTemplateId: template.metaTemplateId,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    components: Array.isArray(template.components) ? template.components : [],
    qualityScore: template.qualityScore || null,
    rejectedReason: template.rejectedReason || null,
    headerType: template.headerType,
    headerText: template.headerText,
    body: template.body,
    footer: template.footer,
    buttons: Array.isArray(template.buttons) ? template.buttons : [],
    variables: Array.isArray(template.variables) ? template.variables : [],
    rawMetaResponse: template.rawMetaResponse,
    isActive: template.isActive,
    lastSyncedAt: template.lastSyncedAt,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

async function upsertTemplateFromMeta(metaTemplate, db = prisma) {
  const data = normalizeMetaTemplate(metaTemplate);

  if (!data.name || !data.language) {
    logger.warn({ metaTemplate }, "Skipping WhatsApp template without name or language");
    return { action: "skipped", template: null };
  }

  const filters = [
    {
      name: data.name,
      language: data.language
    }
  ];

  if (data.metaTemplateId) {
    filters.unshift({ metaTemplateId: data.metaTemplateId });
  }

  const existing = await db.whatsappTemplate.findFirst({
    where: { OR: filters }
  });

  if (existing) {
    const template = await db.whatsappTemplate.update({
      where: { id: existing.id },
      data
    });

    await applyDefaultMappingProfile(template, db);
    return { action: "updated", template };
  }

  try {
    const template = await db.whatsappTemplate.create({ data });
    await applyDefaultMappingProfile(template, db);
    return { action: "created", template };
  } catch (error) {
    if (error.code !== "P2002") {
      throw error;
    }

    const template = await db.whatsappTemplate.update({
      where: {
        name_language: {
          name: data.name,
          language: data.language
        }
      },
      data
    });

    await applyDefaultMappingProfile(template, db);
    return { action: "updated", template };
  }
}

async function syncTemplatesFromMeta() {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    const metaResult = await whatsapp.fetchAllMessageTemplates();
    const metaTemplates = metaResult.templates;
    const summary = {
      fetched: metaTemplates.length,
      created: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      synced: 0,
      pages: metaResult.meta && metaResult.meta.pages ? metaResult.meta.pages : 0,
      meta: metaResult.meta
    };

    for (const metaTemplate of metaTemplates) {
      let result;

      try {
        result = await upsertTemplateFromMeta(metaTemplate);
      } catch (error) {
        summary.failed += 1;
        logger.error({
          err: error,
          metaTemplateId: metaTemplate && metaTemplate.id,
          templateName: metaTemplate && metaTemplate.name,
          language: metaTemplate && metaTemplate.language
        }, "Failed to upsert WhatsApp template from Meta");
        continue;
      }

      if (result.action === "created") {
        summary.created += 1;
        summary.synced += 1;
      } else if (result.action === "updated") {
        summary.updated += 1;
        summary.synced += 1;
      } else {
        summary.skipped += 1;
      }
    }

    logger.info({
      synced: summary.synced,
      created: summary.created,
      updated: summary.updated,
      failed: summary.failed,
      skipped: summary.skipped,
      fetched: summary.fetched,
      pages: summary.pages,
      tokenSource: summary.meta && summary.meta.tokenSource,
      tokenVariable: summary.meta && summary.meta.tokenVariable,
      tokenPreview: summary.meta && summary.meta.tokenPreview,
      wabaId: summary.meta && summary.meta.wabaId,
      graphApiVersion: summary.meta && summary.meta.graphApiVersion,
      graphApiEndpoint: summary.meta && summary.meta.graphApiEndpoint
    }, "WhatsApp templates synced from Meta");
    logger.debugStep("WhatsApp templates sync completed", {
      synced: summary.synced,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped
    });

    return summary;
  })().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}

function buildTemplateWhere(query = {}) {
  const where = {
    isActive: true
  };
  const requestedStatus = Object.prototype.hasOwnProperty.call(query, "status")
    ? normalizeNullableString(query.status)
    : null;
  const status = requestedStatus ? requestedStatus.toUpperCase() : null;

  if (status && status !== "ALL") {
    where.status = status;
  }

  if (query.category) {
    where.category = String(query.category).trim();
  }

  if (query.language) {
    where.language = String(query.language).trim();
  }

  if (query.search) {
    const search = String(query.search).trim();

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { body: { contains: search, mode: "insensitive" } },
        { headerText: { contains: search, mode: "insensitive" } }
      ];
    }
  }

  return where;
}

async function listTemplates(query = {}) {
  const { page, limit, skip } = getPagination(query);
  const where = buildTemplateWhere(query);
  const [templates, total] = await Promise.all([
    prisma.whatsappTemplate.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { status: "asc" },
        { lastSyncedAt: "desc" },
        { updatedAt: "desc" },
        { name: "asc" }
      ]
    }),
    prisma.whatsappTemplate.count({ where })
  ]);

  return {
    items: templates.map(formatTemplate),
    meta: {
      page,
      limit,
      total
    }
  };
}

function getTemplateVariables(template) {
  return Array.isArray(template.variables) ? template.variables : [];
}

function getUniqueParameterIndexes(template) {
  const indexes = new Set();

  for (const variable of getTemplateVariables(template)) {
    if (Number.isInteger(variable.index) && variable.index > 0) {
      indexes.add(variable.index);
    }
  }

  return [...indexes].sort((a, b) => a - b);
}

function normalizeTemplateParameters(parameters) {
  return Array.isArray(parameters)
    ? parameters.map((parameter) => String(parameter ?? "").trim())
    : [];
}

function assertTemplateParameters(template, parameters) {
  const missing = getUniqueParameterIndexes(template).filter((index) => !parameters[index - 1]);

  if (missing.length > 0) {
    throw new ApiError(400, "أكمل متغيرات القالب قبل الإرسال", missing.map((index) => ({
      index,
      parameter: `{{${index}}}`
    })));
  }
}

function parameterForIndex(parameters, index) {
  return {
    type: "text",
    text: parameters[index - 1]
  };
}

function uniqueVariablesForComponent(template, component) {
  const seen = new Set();

  return getTemplateVariables(template)
    .filter((variable) => variable.component === component)
    .filter((variable) => {
      const key = `${variable.buttonIndex ?? ""}:${variable.index}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => a.index - b.index);
}

function buildTemplateComponents(template, parameters) {
  const components = [];
  const headerVariables = uniqueVariablesForComponent(template, "header");
  const bodyVariables = uniqueVariablesForComponent(template, "body");
  const buttonVariables = uniqueVariablesForComponent(template, "button");

  if (headerVariables.length > 0) {
    components.push({
      type: "header",
      parameters: headerVariables.map((variable) => parameterForIndex(parameters, variable.index))
    });
  }

  if (bodyVariables.length > 0) {
    components.push({
      type: "body",
      parameters: bodyVariables.map((variable) => parameterForIndex(parameters, variable.index))
    });
  }

  const buttonGroups = new Map();

  for (const variable of buttonVariables) {
    const buttonIndex = Number.isInteger(variable.buttonIndex) ? variable.buttonIndex : 0;

    if (!buttonGroups.has(buttonIndex)) {
      buttonGroups.set(buttonIndex, []);
    }

    buttonGroups.get(buttonIndex).push(variable);
  }

  for (const [buttonIndex, variables] of buttonGroups.entries()) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(buttonIndex),
      parameters: variables
        .sort((a, b) => a.index - b.index)
        .map((variable) => parameterForIndex(parameters, variable.index))
    });
  }

  return components;
}

function renderTemplateText(text, parameters) {
  if (!text) {
    return "";
  }

  VARIABLE_PATTERN.lastIndex = 0;

  return text.replace(VARIABLE_PATTERN, (_, rawIndex) => {
    const index = Number(rawIndex);
    return parameters[index - 1] || `{{${index}}}`;
  });
}

function buildTemplatePreview(template, parameters) {
  return [
    renderTemplateText(template.headerText, parameters),
    renderTemplateText(template.body, parameters),
    renderTemplateText(template.footer, parameters)
  ].filter(Boolean).join("\n\n");
}

function isTemplateDisabledError(error) {
  const details = JSON.stringify(error && error.details ? error.details : {});
  const message = `${error && error.message ? error.message : ""} ${details}`.toLowerCase();

  return (
    message.includes("not approved") ||
    message.includes("not available") ||
    message.includes("not found") ||
    message.includes("disabled") ||
    message.includes("rejected") ||
    message.includes("paused")
  );
}

async function findApprovedTemplate(templateName, language) {
  const template = await prisma.whatsappTemplate.findFirst({
    where: {
      name: templateName,
      language,
      isActive: true
    }
  });

  if (!template || template.status !== "APPROVED") {
    throw new ApiError(400, TEMPLATE_NOT_APPROVED_MESSAGE);
  }

  return template;
}

async function sendTemplateMessage(user, data) {
  const template = await findApprovedTemplate(data.templateName, data.language);
  const parameters = normalizeTemplateParameters(data.parameters);

  assertTemplateParameters(template, parameters);

  const customer = await getCustomerForUser(data.customerId, user);

  if (isCustomerContactBlocked(customer)) {
    throw new ApiError(403, contactBlockMessage);
  }

  const to = normalizePhone(customer.phone);
  const components = buildTemplateComponents(template, parameters);
  const preview = buildTemplatePreview(template, parameters) || template.name;
  let response;

  try {
    response = await whatsapp.sendTemplateMessage(to, template.name, template.language, components);
  } catch (error) {
    if (isTemplateDisabledError(error)) {
      throw new ApiError(400, TEMPLATE_NOT_APPROVED_MESSAGE, error.details ? [error.details] : []);
    }

    throw new ApiError(
      error.status || 502,
      friendlyWhatsAppFailureMessage(error, "تعذر إرسال قالب واتساب"),
      error.details ? [error.details] : []
    );
  }

  const whatsappMessageId = whatsapp.extractMessageId(response);
  const message = await messageService.recordSentTemplateMessage(customer, user, {
    templateName: template.name,
    languageCode: template.language,
    components,
    parameters,
    preview,
    whatsappMessageId,
    metaResponse: response,
    templateId: template.id
  });

  logger.info({
    userId: user.id,
    customerId: customer.id,
    templateName: template.name,
    language: template.language,
    whatsappMessageId
  }, "WhatsApp template message sent");

  return {
    message,
    whatsappMessageId,
    template: formatTemplate(template)
  };
}

function runAutoSyncOnce(reason) {
  syncTemplatesFromMeta().catch((error) => {
    logger.warn({ err: error, reason }, "Automatic WhatsApp template sync failed");
  });
}

function startTemplateAutoSync() {
  if (env.NODE_ENV === "test" || autoSyncInterval) {
    return;
  }

  initialSyncTimer = setTimeout(() => {
    runAutoSyncOnce("startup");
    initialSyncTimer = null;
  }, 10 * 1000);
  initialSyncTimer.unref && initialSyncTimer.unref();

  autoSyncInterval = setInterval(() => {
    runAutoSyncOnce("interval");
  }, TEMPLATE_AUTO_SYNC_INTERVAL_MS);
  autoSyncInterval.unref && autoSyncInterval.unref();

  logger.info({ everyMs: TEMPLATE_AUTO_SYNC_INTERVAL_MS }, "WhatsApp template auto-sync scheduled");
}

function stopTemplateAutoSync() {
  if (initialSyncTimer) {
    clearTimeout(initialSyncTimer);
    initialSyncTimer = null;
  }

  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
}

module.exports = {
  TEMPLATE_NOT_APPROVED_MESSAGE,
  collectTemplateVariables,
  detectTemplateVariables,
  formatTemplate,
  normalizeMetaTemplate,
  upsertTemplateFromMeta,
  listTemplates,
  sendTemplateMessage,
  startTemplateAutoSync,
  stopTemplateAutoSync,
  syncTemplatesFromMeta
};
