const { Prisma } = require("@prisma/client");
const prisma = require("../../config/prisma");
const { invoiceStatusLabels, collectionStatusLabels } = require("../../services/customer.service");
const ApiError = require("../../utils/apiError");
const { getDefaultMappingProfile, defaultMappingProfiles } = require("./defaultMappingProfiles");

const VARIABLE_PATTERN = /\{\{\s*(\d+)\s*\}\}/g;
const componentOrder = {
  header: 1,
  body: 2,
  button: 3,
  footer: 4
};

const transformerDefinitions = [
  { key: "identity", labelAr: "كما هو" },
  { key: "identity_last4", labelAr: "آخر 4 أرقام" },
  { key: "year", labelAr: "السنة" },
  { key: "currency", labelAr: "عملة" },
  { key: "plainNumber", labelAr: "رقم فقط" },
  { key: "date", labelAr: "تاريخ" },
  { key: "trim", labelAr: "إزالة المسافات" },
  { key: "upper", labelAr: "أحرف كبيرة" },
  { key: "lower", labelAr: "أحرف صغيرة" }
];

const customerFieldDefinitions = [
  { key: "fullName", labelAr: "اسم العميل", sourceField: "fullName", type: "String" },
  { key: "name", labelAr: "الاسم المختصر", sourceField: "name", type: "String" },
  { key: "primaryPhone", labelAr: "رقم الهاتف الرئيسي", sourceField: "phone", type: "String" },
  { key: "phone", labelAr: "رقم الهاتف", sourceField: "phone", type: "String" },
  { key: "nationalId_last4", labelAr: "آخر 4 أرقام من الهوية", sourceField: "nationalId", type: "String", defaultTransformer: "identity_last4", sensitive: true },
  { key: "accountNumber", labelAr: "رقم الحساب", sourceField: "accountNumber", type: "String" },
  { key: "serviceNumber", labelAr: "رقم الخدمة", sourceField: "serviceNumber", type: "String" },
  { key: "debtAmount", labelAr: "المبلغ", sourceField: "debtAmount", type: "Decimal", defaultTransformer: "currency" },
  { key: "debtYear", labelAr: "سنة المديونية", sourceField: "debtYear", type: "Int", defaultTransformer: "plainNumber" },
  { key: "serviceActivationDate", labelAr: "تاريخ تفعيل الخدمة", sourceField: "serviceActivationDate", type: "DateTime", defaultTransformer: "date" },
  { key: "serviceTerminationDate", labelAr: "تاريخ الاستحقاق", sourceField: "serviceTerminationDate", type: "DateTime", defaultTransformer: "date" },
  { key: "projectName", labelAr: "اسم المشروع", sourceField: "projectName", type: "String" },
  { key: "projectNameRaw", labelAr: "اسم المشروع الأصلي", sourceField: "projectNameRaw", type: "String" },
  { key: "invoiceStatus", labelAr: "حالة الفاتورة", sourceField: "invoiceStatus", type: "Enum" },
  { key: "invoiceStatusLabel", labelAr: "حالة الفاتورة بالعربية", sourceField: "invoiceStatus", type: "Enum" },
  { key: "collectionStatus", labelAr: "حالة التحصيل", sourceField: "collectionStatus", type: "Enum" },
  { key: "collectionStatusLabel", labelAr: "حالة التحصيل بالعربية", sourceField: "collectionStatus", type: "Enum" },
  { key: "paidAt", labelAr: "تاريخ السداد", sourceField: "paidAt", type: "DateTime", defaultTransformer: "date" },
  { key: "paidAmount", labelAr: "المبلغ المسدد", sourceField: "paidAmount", type: "Decimal", defaultTransformer: "currency" },
  { key: "paymentReference", labelAr: "مرجع السداد", sourceField: "paymentReference", type: "String" },
  { key: "source", labelAr: "مصدر العميل", sourceField: "source", type: "String" },
  { key: "whatsappProfileName", labelAr: "اسم واتساب", sourceField: "whatsappProfileName", type: "String" },
  { key: "assignedEmployeeName", labelAr: "اسم المحصل", sourceField: "assignedToId", type: "String", virtual: true },
  { key: "createdAt", labelAr: "تاريخ إنشاء العميل", sourceField: "createdAt", type: "DateTime", defaultTransformer: "date" },
  { key: "updatedAt", labelAr: "تاريخ آخر تحديث", sourceField: "updatedAt", type: "DateTime", defaultTransformer: "date" }
];

const debtFieldKeys = new Set(["accountNumber", "serviceNumber", "projectName", "projectNameRaw", "debtAmount", "debtYear", "serviceActivationDate", "serviceTerminationDate", "invoiceStatus", "invoiceStatusLabel", "collectionStatus", "collectionStatusLabel", "paidAt", "paidAmount", "paymentReference"]);

function getCustomerScalarFields() {
  const models = Prisma.dmmf && Prisma.dmmf.datamodel && Array.isArray(Prisma.dmmf.datamodel.models)
    ? Prisma.dmmf.datamodel.models
    : [];
  const customerModel = models.find((model) => model.name === "Customer");

  if (!customerModel) {
    return new Set(customerFieldDefinitions.map((field) => field.sourceField));
  }

  return new Set(
    customerModel.fields
      .filter((field) => field.kind === "scalar" || field.kind === "enum")
      .map((field) => field.name)
  );
}

function getMappingFields() {
  const scalarFields = getCustomerScalarFields();

  return customerFieldDefinitions
    .filter((field) => field.virtual || scalarFields.has(field.sourceField))
    .map((field) => ({ ...field, sourceScope: debtFieldKeys.has(field.key) ? "debt" : "customer" }));
}

function getMappingField(fieldKey) {
  return getMappingFields().find((field) => field.key === fieldKey) || null;
}

function getTransformers() {
  return transformerDefinitions.map((transformer) => ({ ...transformer }));
}

function normalizeComponentType(value) {
  return String(value || "").trim().toLowerCase();
}

function buildVariableKey(variable) {
  return [
    normalizeComponentType(variable.componentType || variable.component),
    variable.buttonIndex ?? "",
    variable.source || "",
    variable.placeholderNumber || variable.index
  ].join(":");
}

function addVariablesFromText(variables, text, componentType, extra = {}) {
  if (typeof text !== "string") {
    return;
  }

  VARIABLE_PATTERN.lastIndex = 0;

  let match;
  while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
    const placeholderNumber = Number(match[1]);

    if (!Number.isInteger(placeholderNumber) || placeholderNumber < 1) {
      continue;
    }

    variables.push({
      placeholderNumber,
      index: placeholderNumber,
      token: `{{${placeholderNumber}}}`,
      componentType,
      component: componentType,
      ...extra
    });
  }
}

function variablesFromComponents(template) {
  const variables = [];
  const components = Array.isArray(template && template.components) ? template.components : [];

  for (const component of components) {
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      continue;
    }

    const type = String(component.type || "").trim().toUpperCase();

    if (["HEADER", "BODY", "FOOTER"].includes(type)) {
      addVariablesFromText(variables, component.text, type.toLowerCase());
    }

    if (type === "BUTTONS" && Array.isArray(component.buttons)) {
      component.buttons.forEach((button, buttonIndex) => {
        if (!button || typeof button !== "object" || Array.isArray(button)) {
          return;
        }

        addVariablesFromText(variables, button.url, "button", {
          buttonIndex,
          buttonType: String(button.type || "").trim().toUpperCase() || null,
          source: "url"
        });
      });
    }
  }

  return variables;
}

function normalizeStoredVariable(variable) {
  const placeholderNumber = Number(variable.placeholderNumber || variable.index);
  const componentType = normalizeComponentType(variable.componentType || variable.component);

  return {
    placeholderNumber,
    index: placeholderNumber,
    token: variable.token || `{{${placeholderNumber}}}`,
    componentType,
    component: componentType,
    buttonIndex: Number.isInteger(variable.buttonIndex) ? variable.buttonIndex : null,
    buttonType: variable.buttonType || null,
    source: variable.source || null
  };
}

function detectTemplateVariables(template) {
  const combined = [
    ...(Array.isArray(template && template.variables) ? template.variables.map(normalizeStoredVariable) : []),
    ...variablesFromComponents(template)
  ];
  const seen = new Set();

  return combined
    .filter((variable) => Number.isInteger(variable.placeholderNumber) && variable.placeholderNumber > 0 && variable.componentType)
    .filter((variable) => {
      const key = buildVariableKey(variable);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((variable) => ({
      ...variable,
      buttonIndex: Number.isInteger(variable.buttonIndex) ? variable.buttonIndex : null,
      source: variable.source || null,
      variableKey: buildVariableKey(variable)
    }))
    .sort((a, b) => {
      if (a.placeholderNumber !== b.placeholderNumber) {
        return a.placeholderNumber - b.placeholderNumber;
      }

      if ((componentOrder[a.componentType] || 99) !== (componentOrder[b.componentType] || 99)) {
        return (componentOrder[a.componentType] || 99) - (componentOrder[b.componentType] || 99);
      }

      return (a.buttonIndex ?? -1) - (b.buttonIndex ?? -1);
    });
}

function normalizeMappingRow(row) {
  return {
    id: row.id,
    templateId: row.templateId,
    language: row.language,
    variableKey: row.variableKey,
    placeholderNumber: row.placeholderNumber,
    componentType: row.componentType,
    buttonIndex: row.buttonIndex,
    source: row.source,
    sourceScope: row.sourceScope || (debtFieldKeys.has(row.fieldKey) ? "debt" : "customer"),
    fieldKey: row.fieldKey,
    transformer: row.transformer || null,
    fallbackValue: row.fallbackValue || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function listTemplateMappings(templateId, db = prisma) {
  return db.whatsappTemplateVariableMapping.findMany({
    where: { templateId },
    orderBy: [
      { placeholderNumber: "asc" },
      { componentType: "asc" },
      { buttonIndex: "asc" }
    ]
  });
}

function buildMappingStatus(template, rows) {
  const variables = detectTemplateVariables(template);
  const mappingsByKey = new Map(rows.map((row) => [row.variableKey, normalizeMappingRow(row)]));
  const missingVariables = variables.filter((variable) => !mappingsByKey.has(variable.variableKey));
  const mappingRows = rows.map(normalizeMappingRow);
  let message = null;

  if (variables.length > 0 && mappingRows.length === 0) {
    message = "يرجى ربط متغيرات هذا القالب لأول مرة.";
  } else if (missingVariables.length > 0) {
    message = "أكمل ربط متغيرات هذا القالب قبل تجهيز الحملة.";
  }

  return {
    variables,
    mappings: mappingRows,
    mappingsByKey,
    missingVariables,
    isComplete: missingVariables.length === 0,
    message
  };
}

async function getTemplateMapping(templateId, db = prisma) {
  const template = await db.whatsappTemplate.findUnique({
    where: { id: templateId }
  });

  if (!template) {
    throw new ApiError(404, "Template not found");
  }

  const rows = await listTemplateMappings(template.id, db);
  const status = buildMappingStatus(template, rows);

  return {
    template,
    variables: status.variables,
    mappings: status.mappings,
    missingVariables: status.missingVariables,
    isComplete: status.isComplete,
    message: status.message
  };
}

function validateFieldKey(fieldKey) {
  const field = getMappingField(fieldKey);

  if (!field) {
    throw new ApiError(400, "حقل الربط غير مدعوم", [{ fieldKey }]);
  }

  return field;
}

function validateTransformer(transformer) {
  if (!transformer) {
    return null;
  }

  const exists = transformerDefinitions.some((item) => item.key === transformer);

  if (!exists) {
    throw new ApiError(400, "محول القيمة غير مدعوم", [{ transformer }]);
  }

  return transformer;
}

async function saveTemplateMapping(templateId, mappings, db = prisma) {
  const template = await db.whatsappTemplate.findUnique({
    where: { id: templateId }
  });

  if (!template) {
    throw new ApiError(404, "Template not found");
  }

  const variables = detectTemplateVariables(template);
  const variablesByKey = new Map(variables.map((variable) => [variable.variableKey, variable]));
  const rows = [];

  for (const mapping of mappings || []) {
    const variable = variablesByKey.get(mapping.variableKey);

    if (!variable) {
      throw new ApiError(400, "متغير القالب غير موجود", [{ variableKey: mapping.variableKey }]);
    }

    const field = validateFieldKey(mapping.fieldKey);
    const transformer = validateTransformer(mapping.transformer || field.defaultTransformer || null);

    rows.push({
      templateId: template.id,
      language: template.language,
      variableKey: variable.variableKey,
      placeholderNumber: variable.placeholderNumber,
      componentType: variable.componentType,
      buttonIndex: Number.isInteger(variable.buttonIndex) ? variable.buttonIndex : null,
      source: variable.source || null,
      fieldKey: field.key,
      sourceScope: mapping.sourceScope || field.sourceScope || (debtFieldKeys.has(field.key) ? "debt" : "customer"),
      transformer,
      fallbackValue: mapping.fallbackValue ? String(mapping.fallbackValue).trim() : null
    });
  }

  await db.$transaction(async (tx) => {
    await tx.whatsappTemplateVariableMapping.deleteMany({
      where: {
        templateId: template.id,
        language: template.language
      }
    });

    if (rows.length > 0) {
      await tx.whatsappTemplateVariableMapping.createMany({
        data: rows
      });
    }
  });

  return getTemplateMapping(template.id, db);
}

async function applyDefaultMappingProfile(template, db = prisma) {
  if (!template || !db.whatsappTemplateVariableMapping) {
    return { applied: false, reason: "unsupported_db" };
  }

  const profile = getDefaultMappingProfile(template.name);

  if (!profile) {
    return { applied: false, reason: "no_profile" };
  }

  const existingCount = await db.whatsappTemplateVariableMapping.count({
    where: {
      templateId: template.id,
      language: template.language
    }
  });

  if (existingCount > 0) {
    return { applied: false, reason: "already_mapped" };
  }

  const profileByPlaceholder = new Map(profile.map((item) => [item.placeholderNumber, item]));
  const rows = detectTemplateVariables(template)
    .map((variable) => {
      const mapping = profileByPlaceholder.get(variable.placeholderNumber);

      if (!mapping) {
        return null;
      }

      const field = validateFieldKey(mapping.fieldKey);
      const transformer = validateTransformer(mapping.transformer || field.defaultTransformer || null);

      return {
        templateId: template.id,
        language: template.language,
        variableKey: variable.variableKey,
        placeholderNumber: variable.placeholderNumber,
        componentType: variable.componentType,
        buttonIndex: Number.isInteger(variable.buttonIndex) ? variable.buttonIndex : null,
        source: variable.source || null,
        fieldKey: field.key,
        sourceScope: field.sourceScope || (debtFieldKeys.has(field.key) ? "debt" : "customer"),
        transformer,
        fallbackValue: mapping.fallbackValue || null
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return { applied: false, reason: "no_matching_variables" };
  }

  await db.whatsappTemplateVariableMapping.createMany({
    data: rows,
    skipDuplicates: true
  });

  return { applied: true, rows: rows.length, profileName: template.name };
}

function stringifyValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object" && typeof value.toString === "function") {
    return value.toString();
  }

  return String(value);
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return stringifyValue(value);
  }

  return date.toISOString().slice(0, 10);
}

function applyTransformer(value, transformer) {
  const text = stringifyValue(value);

  switch (transformer || "identity") {
    case "identity_last4":
      return text.replace(/\D/g, "").slice(-4);
    case "year": {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? text.slice(0, 4) : String(date.getFullYear());
    }
    case "currency": {
      const number = toNumber(value);
      return number === null
        ? text
        : new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(number);
    }
    case "plainNumber": {
      const number = toNumber(value);
      return number === null ? text.replace(/[^\d.-]/g, "") : String(number);
    }
    case "date":
      return formatDate(value);
    case "trim":
      return text.trim();
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "identity":
    default:
      return text;
  }
}

function resolveRawCustomerValue(customer, fieldKey) {
  switch (fieldKey) {
    case "primaryPhone":
      return customer.primaryPhone || customer.phone;
    case "nationalId_last4":
      return customer.nationalId ? String(customer.nationalId).replace(/\D/g, "").slice(-4) : "";
    case "invoiceStatusLabel":
      return customer.invoiceStatusLabel || invoiceStatusLabels[customer.invoiceStatus] || customer.invoiceStatus;
    case "collectionStatusLabel":
      return customer.collectionStatusLabel || collectionStatusLabels[customer.collectionStatus] || customer.collectionStatus;
    case "assignedEmployeeName":
      return customer.assignedTo ? customer.assignedTo.name : customer.collectorName;
    default:
      return customer[fieldKey];
  }
}

function isMissingValue(value, mapping) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return true;
  }

  if (mapping.fieldKey === "debtAmount") {
    const amount = toNumber(value);
    return amount === null || amount <= 0;
  }

  return false;
}

function missingFieldReason(mapping) {
  const field = getMappingField(mapping.fieldKey);

  if (mapping.fieldKey === "debtAmount") {
    return "لا يوجد مبلغ مديونية";
  }

  return `الحقل المطلوب غير موجود: ${field ? field.labelAr : mapping.fieldKey}`;
}

function resolveMappingValue(customer, mapping, debt = null) {
  const scope = mapping.sourceScope || (debtFieldKeys.has(mapping.fieldKey) ? "debt" : "customer");
  const source = scope === "debt" ? (debt || customer) : customer;
  const rawValue = resolveRawCustomerValue(source || {}, mapping.fieldKey);
  const missing = isMissingValue(rawValue, mapping);
  const valueForTransform = missing && mapping.fallbackValue
    ? mapping.fallbackValue
    : rawValue;
  const resolved = applyTransformer(valueForTransform, mapping.transformer);

  return {
    value: resolved,
    rawMissing: missing && !mapping.fallbackValue,
    reason: missing && !mapping.fallbackValue ? missingFieldReason(mapping) : null
  };
}

function resolveTemplateForCustomer(template, mappings, customer, debt = null) {
  const variables = detectTemplateVariables(template);
  const mappingsByKey = new Map((mappings || []).map((mapping) => [mapping.variableKey, mapping]));
  const resolvedVariables = [];
  const missing = [];
  const valuesByKey = new Map();

  for (const variable of variables) {
    const mapping = mappingsByKey.get(variable.variableKey);

    if (!mapping) {
      missing.push({
        variable,
        reason: "لم يتم ربط متغير القالب"
      });
      continue;
    }

    const resolved = resolveMappingValue(customer, mapping, debt);

    if (resolved.rawMissing) {
      missing.push({
        variable,
        mapping,
        reason: resolved.reason
      });
    }

    const entry = {
      variableKey: variable.variableKey,
      token: variable.token,
      placeholderNumber: variable.placeholderNumber,
      componentType: variable.componentType,
      buttonIndex: variable.buttonIndex,
      fieldKey: mapping.fieldKey,
      sourceScope: mapping.sourceScope || (debtFieldKeys.has(mapping.fieldKey) ? "debt" : "customer"),
      transformer: mapping.transformer,
      fallbackValue: mapping.fallbackValue,
      value: resolved.value
    };

    resolvedVariables.push(entry);
    valuesByKey.set(variable.variableKey, resolved.value);
  }

  return {
    variables,
    resolvedVariables,
    valuesByKey,
    missing
  };
}

function valueForVariable(valuesByKey, componentType, placeholderNumber, buttonIndex = null, source = null) {
  const directKey = [componentType, buttonIndex ?? "", source || "", placeholderNumber].join(":");

  if (valuesByKey.has(directKey)) {
    return valuesByKey.get(directKey);
  }

  const fallbackEntry = [...valuesByKey.entries()].find(([key]) => (
    key.startsWith(`${componentType}:`) && key.endsWith(`:${placeholderNumber}`)
  ));

  return fallbackEntry ? fallbackEntry[1] : `{{${placeholderNumber}}}`;
}

function renderTemplateText(text, valuesByKey, componentType) {
  if (!text) {
    return "";
  }

  VARIABLE_PATTERN.lastIndex = 0;

  return text.replace(VARIABLE_PATTERN, (_, rawIndex) => {
    const placeholderNumber = Number(rawIndex);
    return valueForVariable(valuesByKey, componentType, placeholderNumber);
  });
}

function buildTemplatePreview(template, valuesByKey) {
  return [
    renderTemplateText(template.headerText, valuesByKey, "header"),
    renderTemplateText(template.body, valuesByKey, "body"),
    renderTemplateText(template.footer, valuesByKey, "footer")
  ].filter(Boolean).join("\n\n");
}

function parametersForComponent(variables, valuesByKey) {
  return variables
    .sort((a, b) => a.placeholderNumber - b.placeholderNumber)
    .map((variable) => ({
      type: "text",
      text: valueForVariable(
        valuesByKey,
        variable.componentType,
        variable.placeholderNumber,
        variable.buttonIndex,
        variable.source
      )
    }));
}

function buildTemplateComponents(template, valuesByKey) {
  const variables = detectTemplateVariables(template);
  const components = [];
  const headerVariables = variables.filter((variable) => variable.componentType === "header");
  const bodyVariables = variables.filter((variable) => variable.componentType === "body");
  const buttonVariables = variables.filter((variable) => variable.componentType === "button");

  if (headerVariables.length > 0) {
    components.push({
      type: "header",
      parameters: parametersForComponent(headerVariables, valuesByKey)
    });
  }

  if (bodyVariables.length > 0) {
    components.push({
      type: "body",
      parameters: parametersForComponent(bodyVariables, valuesByKey)
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

  for (const [buttonIndex, group] of buttonGroups.entries()) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(buttonIndex),
      parameters: parametersForComponent(group, valuesByKey)
    });
  }

  return components;
}

function sanitizeCustomerSnapshot(customer, debt = null) {
  return {
    id: customer.id,
    fullName: customer.fullName || customer.name || customer.whatsappProfileName || customer.phone,
    phone: customer.primaryPhone || customer.phone,
    debtId: debt && debt.id || null,
    accountNumber: debt && debt.accountNumber,
    serviceNumber: debt && debt.serviceNumber,
    projectName: debt && debt.projectName,
    debtAmount: stringifyValue(debt && debt.debtAmount),
    debtYear: debt && debt.debtYear,
    invoiceStatus: debt && debt.invoiceStatus,
    collectionStatus: debt && debt.collectionStatus
  };
}

module.exports = {
  VARIABLE_PATTERN,
  defaultMappingProfiles,
  getMappingFields,
  getMappingField,
  getTransformers,
  buildVariableKey,
  detectTemplateVariables,
  buildMappingStatus,
  getTemplateMapping,
  saveTemplateMapping,
  applyDefaultMappingProfile,
  applyTransformer,
  resolveMappingValue,
  resolveTemplateForCustomer,
  renderTemplateText,
  buildTemplatePreview,
  buildTemplateComponents,
  sanitizeCustomerSnapshot
};
