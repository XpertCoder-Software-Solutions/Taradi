const { z } = require("zod");
const debtService = require("../services/customerDebt.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");

const paramsSchema = z.object({ customerId: z.string().uuid(), debtId: z.string().uuid().optional() });
const status = z.enum(["ACTIVE_DEBT", "PAID", "PARTIALLY_PAID", "PROMISED_TO_PAY", "DISPUTED", "DO_NOT_CONTACT"]);
const invoice = z.enum(["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"]);
const amount = z.union([z.string().trim().min(1), z.number().nonnegative()]);
const bodySchema = z.object({
  projectName: z.string().trim().nullable().optional(), projectNameRaw: z.string().trim().nullable().optional(),
  accountNumber: z.string().trim().min(1).optional(), serviceNumber: z.string().trim().nullable().optional(),
  debtYear: z.union([z.string().trim().min(1), z.number().int()]).optional(), debtAmount: amount.optional(),
  invoiceStatus: invoice.optional(), collectionStatus: status.optional(),
  serviceActivationDate: z.string().nullable().optional(), serviceTerminationDate: z.string().nullable().optional(),
  paidAmount: amount.nullable().optional(), paidAt: z.string().nullable().optional(),
  paymentReference: z.string().trim().nullable().optional(), paymentNotes: z.string().trim().nullable().optional()
});
const createSchema = bodySchema.extend({ accountNumber: z.string().trim().min(1), debtYear: z.union([z.string().trim().min(1), z.number().int()]), debtAmount: amount });

const list = asyncHandler(async (req, res) => { const { customerId } = parse(paramsSchema, req.params); res.success({ debts: await debtService.listDebts(customerId, req.user, req.query) }); });
const get = asyncHandler(async (req, res) => { const { customerId, debtId } = parse(paramsSchema, req.params); res.success({ debt: await debtService.getDebt(customerId, debtId, req.user) }); });
const create = asyncHandler(async (req, res) => { const { customerId } = parse(paramsSchema, req.params); res.success({ debt: await debtService.createDebt(customerId, req.user, parse(createSchema, req.body)) }, 201); });
const update = asyncHandler(async (req, res) => { const { customerId, debtId } = parse(paramsSchema, req.params); res.success({ debt: await debtService.updateDebt(customerId, debtId, req.user, parse(bodySchema, req.body)) }); });
const archive = asyncHandler(async (req, res) => { const { customerId, debtId } = parse(paramsSchema, req.params); res.success({ debt: await debtService.archiveDebt(customerId, debtId, req.user) }); });

module.exports = { list, get, create, update, archive };
