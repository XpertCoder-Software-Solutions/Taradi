const { z } = require("zod");
const messageService = require("../services/message.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const campaignParamsSchema = z.object({
  campaignId: z.string().uuid()
});

const manualReplySchema = z.object({
  text: z.string().trim().min(1).max(4096)
});

const campaignFiltersSchema = z.object({
  search: z.string().trim().optional(),
  assignment: z.enum(["unassigned"]).optional(),
  assignmentStatus: z.enum(["assigned", "unassigned"]).optional(),
  assignedToId: z.string().uuid().optional(),
  assignedEmployeeId: z.string().uuid().optional(),
  supervisorId: z.string().uuid().optional(),
  projectName: z.string().trim().optional(),
  invoiceStatus: z.enum(["UNPAID", "PAID", "SCHEDULED", "DISPUTED", "CANCELLED"]).optional(),
  collectionStatus: z.enum([
    "ACTIVE_DEBT",
    "PAID",
    "PARTIALLY_PAID",
    "PROMISED_TO_PAY",
    "DISPUTED",
    "DO_NOT_CONTACT"
  ]).optional(),
  contactBlocked: z.boolean().optional(),
  paidOnly: z.boolean().optional(),
  debtYear: z.union([z.string().trim().min(1), z.number().int()]).optional(),
  sortBy: z.enum(["fullName", "debtAmount", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional()
}).optional().default({});

const bulkTemplateBaseSchema = z.object({
  templateId: z.string().uuid().optional(),
  templateName: z.string().trim().min(1).optional(),
  languageCode: z.string().trim().min(2).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  selectionMode: z.enum(["explicit", "all_matching"]).optional().default("explicit"),
  customerIds: z.array(z.string().uuid()).optional().default([]),
  recipients: z.array(z.object({ customerId: z.string().uuid(), debtId: z.string().uuid() })).optional().default([]),
  debtIds: z.array(z.string().uuid()).optional().default([]),
  excludedCustomerIds: z.array(z.string().uuid()).optional().default([]),
  excludedDebtIds: z.array(z.string().uuid()).optional().default([]),
  filters: campaignFiltersSchema
});

function refineBulkTemplateSchema(schema) {
  return schema.refine((value) => value.templateId || (value.templateName && value.languageCode), {
    message: "Template is required",
    path: ["templateId"]
  }).refine((value) => value.selectionMode === "all_matching" || value.recipients.length > 0 || value.debtIds.length > 0 || value.customerIds.length > 0, {
    message: "At least one debt is required",
    path: ["recipients"]
  });
}

const bulkTemplateSchema = refineBulkTemplateSchema(bulkTemplateBaseSchema);
const bulkTemplatePreviewSchema = refineBulkTemplateSchema(bulkTemplateBaseSchema.extend({
  limit: z.coerce.number().int().positive().max(5).optional().default(3)
}));

const getInbox = asyncHandler(async (req, res) => {
  const result = await messageService.getInbox(req.user, req.query);
  res.success(result);
});

const listMessages = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const result = await messageService.listMessages(id, req.user, req.query);

  res.success(result);
});

const markRead = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const readState = await messageService.markConversationRead(id, req.user);

  res.success({ readState });
});

const sendManualReply = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const { text } = parse(manualReplySchema, req.body);
  const result = await messageService.sendManualReply(id, req.user, text);

  res.success(result, 201);
});

const downloadMedia = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const result = await messageService.downloadMissingMedia(id);

  res.success(result);
});

const streamMedia = asyncHandler(async (req, res) => {
  const { id } = parse(idParamsSchema, req.params);
  const result = await messageService.getMessageMediaStream(id, req.user, req.headers.range);

  res.status(result.statusCode);

  for (const [key, value] of Object.entries(result.headers)) {
    res.setHeader(key, value);
  }

  if (!result.stream) {
    res.end();
    return;
  }

  result.stream.on("error", (error) => {
    req.log?.error({ err: error, messageId: id }, "Failed to stream message media");
    if (!res.headersSent) {
      res.status(500).end();
      return;
    }
    res.destroy(error);
  });
  result.stream.pipe(res);
});

const previewBulkTemplate = asyncHandler(async (req, res) => {
  const data = parse(bulkTemplatePreviewSchema, req.body);
  const result = await messageService.previewBulkTemplate(req.user, data);

  res.success(result);
});

const getCampaignProgress = asyncHandler(async (req, res) => {
  const { campaignId } = parse(campaignParamsSchema, req.params);
  const result = await messageService.getCampaignProgress(req.user, campaignId);

  res.success(result);
});

const sendBulkTemplate = asyncHandler(async (req, res) => {
  const data = parse(bulkTemplateSchema, req.body);
  const result = await messageService.sendBulkTemplate(req.user, {
    ...data,
    idempotencyKey: req.get("Idempotency-Key") || data.idempotencyKey || null
  });

  res.success(result, 202);
});

module.exports = {
  getInbox,
  listMessages,
  markRead,
  sendManualReply,
  downloadMedia,
  streamMedia,
  previewBulkTemplate,
  getCampaignProgress,
  sendBulkTemplate
};
