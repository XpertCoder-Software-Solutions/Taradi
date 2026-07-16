const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-with-at-least-32-chars";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-whatsapp-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone-number-id";
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "test-business-account-id";
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "test-verify-token";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

const {
  buildTemplateComponents,
  buildTemplatePreview,
  defaultMappingProfiles,
  detectTemplateVariables,
  resolveTemplateForCustomer,
  sanitizeCustomerSnapshot
} = require("../src/modules/templates/templateMapping.service");

function sampleTemplate() {
  return {
    id: "template-1",
    name: "dynamic_details",
    language: "ar",
    category: "UTILITY",
    headerText: "مرحبًا {{1}}",
    body: "حساب {{2}} عليه {{3}}",
    footer: null,
    variables: [],
    components: [
      { type: "HEADER", text: "مرحبًا {{1}}" },
      { type: "BODY", text: "حساب {{2}} عليه {{3}}" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "URL", text: "عرض", url: "https://example.test/pay/{{4}}" }
        ]
      }
    ]
  };
}

test("detects header, body, and button URL placeholders ordered numerically", () => {
  const variables = detectTemplateVariables(sampleTemplate());

  assert.deepEqual(
    variables.map((variable) => ({
      placeholderNumber: variable.placeholderNumber,
      componentType: variable.componentType,
      buttonIndex: variable.buttonIndex
    })),
    [
      { placeholderNumber: 1, componentType: "header", buttonIndex: null },
      { placeholderNumber: 2, componentType: "body", buttonIndex: null },
      { placeholderNumber: 3, componentType: "body", buttonIndex: null },
      { placeholderNumber: 4, componentType: "button", buttonIndex: 0 }
    ]
  );
});

test("resolves customer-specific variables without exposing full National ID", () => {
  const template = sampleTemplate();
  const variables = detectTemplateVariables(template);
  const byNumber = new Map(variables.map((variable) => [variable.placeholderNumber, variable]));
  const mappings = [
    { variableKey: byNumber.get(1).variableKey, fieldKey: "fullName", transformer: "trim" },
    { variableKey: byNumber.get(2).variableKey, fieldKey: "nationalId_last4", transformer: "identity_last4" },
    { variableKey: byNumber.get(3).variableKey, fieldKey: "debtAmount", transformer: "currency" },
    { variableKey: byNumber.get(4).variableKey, fieldKey: "accountNumber", transformer: "trim" }
  ];
  const customer = {
    id: "customer-1",
    fullName: "عميل الاختبار",
    phone: "966500000000",
    primaryPhone: "966500000000",
    nationalId: "1234567890123",
    accountNumber: "ACC-100",
    debtAmount: "1234.5",
    debtYear: 2025,
    invoiceStatus: "UNPAID",
    collectionStatus: "ACTIVE_DEBT",
    projectName: "Mobily",
    serviceNumber: "SVC-1"
  };

  const resolved = resolveTemplateForCustomer(template, mappings, customer);
  const snapshot = sanitizeCustomerSnapshot(customer);
  const serialized = JSON.stringify({ resolved, snapshot });

  assert.equal(resolved.resolvedVariables.find((item) => item.fieldKey === "nationalId_last4").value, "0123");
  assert.doesNotMatch(serialized, /1234567890123/);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "nationalId"), false);
});

test("builds separate Meta components for header, body, and button parameters", () => {
  const template = sampleTemplate();
  const variables = detectTemplateVariables(template);
  const valuesByKey = new Map(variables.map((variable) => [variable.variableKey, `value-${variable.placeholderNumber}`]));
  const components = buildTemplateComponents(template, valuesByKey);

  assert.deepEqual(components, [
    {
      type: "header",
      parameters: [{ type: "text", text: "value-1" }]
    },
    {
      type: "body",
      parameters: [
        { type: "text", text: "value-2" },
        { type: "text", text: "value-3" }
      ]
    },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "value-4" }]
    }
  ]);
});

test("renders preview from resolved variables", () => {
  const template = sampleTemplate();
  const variables = detectTemplateVariables(template);
  const valuesByKey = new Map(variables.map((variable) => [variable.variableKey, `قيمة-${variable.placeholderNumber}`]));

  assert.equal(
    buildTemplatePreview(template, valuesByKey),
    "مرحبًا قيمة-1\n\nحساب قيمة-2 عليه قيمة-3"
  );
});

test("registers default profiles outside the sending service", () => {
  assert.equal(defaultMappingProfiles.mobily_details[1].fieldKey, "nationalId_last4");
  assert.equal(defaultMappingProfiles.stc_details[1].fieldKey, "debtAmount");
});
