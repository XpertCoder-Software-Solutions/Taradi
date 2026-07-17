const { z } = require("zod");
const customerService = require("../services/customer.service");
const customerImportService = require("../services/customerImport.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");
const communicationPreferences = require("../services/customer-communication-preferences.service");

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const invoiceStatusSchema = z.enum(["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"]);
const collectionStatusSchema = z.enum([
  "ACTIVE_DEBT",
  "PAID",
  "PARTIALLY_PAID",
  "PROMISED_TO_PAY",
  "DISPUTED",
  "DO_NOT_CONTACT"
]);
const optionalDateSchema = z.preprocess(
  (value) => value === "" ? null : value,
  z.string().nullable().optional()
);
const phoneListSchema = z.array(z.union([
  z.string().trim().min(1),
  z.object({
    phoneNumber: z.string().trim().min(1)
  })
])).optional();
const debtAmountSchema = z.union([
  z.string().trim().min(1),
  z.number().nonnegative()
]);
const debtYearSchema = z.union([
  z.string().trim().min(1),
  z.number().int()
]);

const createCustomerSchema = z.object({
  fullName: z.string().trim().min(1, "اسم العميل مطلوب"),
  nationalId: z.string().trim().min(1, "رقم الهوية مطلوب"),
  accountNumber: z.string().trim().min(1, "رقم الحساب مطلوب"),
  projectName: z.string().trim().min(1, "الجهة مطلوبة"),
  projectNameRaw: z.string().trim().nullable().optional(),
  debtAmount: debtAmountSchema,
  serviceNumber: z.string().trim().min(1, "رقم الخدمة مطلوب"),
  serviceActivationDate: optionalDateSchema,
  serviceTerminationDate: optionalDateSchema,
  invoiceStatus: invoiceStatusSchema,
  collectionStatus: collectionStatusSchema.optional(),
  paidAt: optionalDateSchema,
  paidAmount: debtAmountSchema.nullable().optional(),
  paymentReference: z.string().trim().nullable().optional(),
  paymentNotes: z.string().trim().nullable().optional(),
  debtYear: debtYearSchema,
  primaryPhone: z.string().trim().min(1, "رقم الهاتف الرئيسي مطلوب"),
  secondaryPhones: phoneListSchema,
  notes: z.string().nullable().optional(),
  assignedEmployeeId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  assignmentReason: z.string().trim().nullable().optional(),
  reassignmentReason: z.string().trim().nullable().optional(),
  phone: z.string().min(1).optional(),
  name: z.string().trim().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional()
});

const updateCustomerSchema = z.object({
  fullName: z.string().trim().min(1, "اسم العميل مطلوب").optional(),
  nationalId: z.string().trim().min(1).nullable().optional(),
  accountNumber: z.string().trim().min(1).optional(),
  projectName: z.string().trim().min(1).optional(),
  projectNameRaw: z.string().trim().nullable().optional(),
  debtAmount: debtAmountSchema.optional(),
  serviceNumber: z.string().trim().min(1).optional(),
  serviceActivationDate: optionalDateSchema,
  serviceTerminationDate: optionalDateSchema,
  invoiceStatus: invoiceStatusSchema.optional(),
  collectionStatus: collectionStatusSchema.optional(),
  paidAt: optionalDateSchema,
  paidAmount: debtAmountSchema.nullable().optional(),
  paymentReference: z.string().trim().nullable().optional(),
  paymentNotes: z.string().trim().nullable().optional(),
  resetPayment: z.boolean().optional(),
  debtYear: debtYearSchema.optional(),
  primaryPhone: z.string().trim().min(1).optional(),
  secondaryPhones: phoneListSchema,
  notes: z.string().nullable().optional(),
  assignedEmployeeId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  phone: z.string().min(1).optional(),
  name: z.string().trim().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

const assignCustomerSchema = z.object({
  employeeId: z.string().uuid().nullable(),
  reason: z.string().trim().nullable().optional()
});

const updateCollectionStatusSchema = z.object({
  collectionStatus: collectionStatusSchema,
  paidAt: optionalDateSchema,
  paidAmount: debtAmountSchema.nullable().optional(),
  paymentReference: z.string().trim().nullable().optional(),
  paymentNotes: z.string().trim().nullable().optional(),
  resetPayment: z.boolean().optional()
});

const communicationPreferencesSchema = z.object({
  whatsappOptIn: z.boolean(),
  source: z.string().trim().min(1).optional(),
  optInAt: z.string().datetime().optional(),
  reason: z.string().trim().max(1000).optional()
});

const listCustomers = asyncHandler(async (req, res) => {
  const result = await customerService.listCustomers(req.user, req.query);
  res.success(result);
});

const createCustomer = asyncHandler(async (req, res) => {
  const data = parse(createCustomerSchema, req.body);
  const customer = await customerService.createCustomer(req.user, data);

  res.success({ customer }, 201);
});

const importCustomersCsv = asyncHandler(async (req, res) => {
  const result = await customerImportService.importCustomersFromCsv(req.file, req.user);

  res.success(result);
});

const importCustomersExcel = asyncHandler(async (req, res) => {
  const result = await customerImportService.importCustomersFromFile(req.file, req.user);

  res.success(result);
});

const getCustomer = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const customer = await customerService.getCustomerForUser(id, req.user);

  res.success({ customer });
});

const updateCustomer = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const data = parse(updateCustomerSchema, req.body);
  const result = await customerService.updateCustomer(id, req.user, data);

  if (result && result.customer && result.reassignment) {
    res.success({
      customer: result.customer,
      ...result.reassignment
    });
    return;
  }

  res.success({ customer: result });
});

const assignCustomer = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const { employeeId, reason } = parse(assignCustomerSchema, req.body);
  const result = await customerService.assignCustomer(id, req.user, employeeId, { reason });

  res.success({
    customer: result.customer,
    ...result.reassignment
  });
});

const updateCollectionStatus = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const data = parse(updateCollectionStatusSchema, req.body);
  const customer = await customerService.updateCustomerCollectionStatus(id, req.user, data);

  res.success({ customer });
});

const deleteCustomer = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  await customerService.deleteCustomer(id);

  res.success({ deleted: true });
});

const updateCommunicationPreferences = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const data = parse(communicationPreferencesSchema, req.body);
  const customer = await communicationPreferences.updatePreferences(id, req.user, data);
  res.success({ customer });
});

module.exports = {
  listCustomers,
  createCustomer,
  importCustomersCsv,
  importCustomersExcel,
  getCustomer,
  updateCustomer,
  updateCollectionStatus,
  assignCustomer,
  deleteCustomer
  ,updateCommunicationPreferences
};
