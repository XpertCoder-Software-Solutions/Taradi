const { z } = require("zod");
const messageService = require("../services/message.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const manualReplySchema = z.object({
  text: z.string().trim().min(1).max(4096)
});

const bulkTemplateSchema = z.object({
  customerIds: z.array(z.string().uuid()).min(1).max(500),
  templateName: z.string().trim().min(1),
  languageCode: z.string().trim().min(2).default("en_US"),
  components: z.array(z.any()).optional()
});

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

const sendBulkTemplate = asyncHandler(async (req, res) => {
  const data = parse(bulkTemplateSchema, req.body);
  const result = await messageService.sendBulkTemplate(req.user, data);

  res.success(result, 201);
});

module.exports = {
  getInbox,
  listMessages,
  markRead,
  sendManualReply,
  sendBulkTemplate
};
