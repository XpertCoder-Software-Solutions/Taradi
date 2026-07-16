const { z } = require("zod");
const logger = require("../config/logger");
const conversationService = require("../services/conversation.service");
const messageService = require("../services/message.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");
const ApiError = require("../utils/apiError");
const { hasPermission } = require("../services/permission.service");

const customerIdParamsSchema = z.object({
  customerId: z.string().uuid()
});

const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4096)
});

const quickSendSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  message: z.string().trim().min(1).max(4096),
  assignedToId: z.string().uuid().optional().nullable()
});

const sendMediaSchema = z.object({
  type: z.enum(["image", "audio", "voice", "video", "document"]).optional(),
  caption: z.string().trim().max(1024).optional()
});

const statusSchema = z.object({
  status: z.enum(conversationService.validStatuses)
});

const prioritySchema = z.object({
  priority: z.enum(conversationService.validPriorities)
});

const listChats = asyncHandler(async (req, res) => {
  const result = await conversationService.listConversations(req.user, req.query);
  logger.debugStep("GET /api/chats", {
    userId: req.user && req.user.id,
    role: req.user && req.user.role,
    query: req.query,
    returnedConversations: result.items.length,
    totalConversations: result.meta.total
  });
  logger.debugStep(`Returning ${result.items.length} conversations.`, {
    route: "GET /api/chats",
    totalConversations: result.meta.total
  });
  res.success(result);
});

const listMessages = asyncHandler(async (req, res) => {
  const { customerId } = parse(customerIdParamsSchema, req.params);
  const result = await conversationService.listConversationMessages(customerId, req.user, req.query);

  logger.debugStep("GET /api/chats/:id/messages", {
    userId: req.user && req.user.id,
    role: req.user && req.user.role,
    customerId,
    conversationId: result.conversation && result.conversation.id,
    query: req.query,
    returnedMessages: result.items.length
  });
  logger.debugStep(`Returning ${result.items.length} messages.`, {
    route: "GET /api/chats/:id/messages",
    customerId,
    conversationId: result.conversation && result.conversation.id
  });

  res.success(result);
});

const sendMessage = asyncHandler(async (req, res) => {
  const { customerId } = parse(customerIdParamsSchema, req.params);
  const { text } = parse(sendMessageSchema, req.body);
  const result = await messageService.sendManualReply(customerId, req.user, text);

  res.success(result, 201);
});

const quickSend = asyncHandler(async (req, res) => {
  const data = parse(quickSendSchema, req.body);
  const result = await messageService.quickSend(req.user, data);

  res.success(result, 201);
});

const sendMediaMessage = asyncHandler(async (req, res) => {
  const { customerId } = parse(customerIdParamsSchema, req.params);
  const data = parse(sendMediaSchema, req.body);
  const result = await messageService.sendManualMedia(customerId, req.user, {
    ...data,
    file: req.file
  });

  res.success(result, 201);
});

const markRead = asyncHandler(async (req, res) => {
  const { customerId } = parse(customerIdParamsSchema, req.params);
  const result = await conversationService.markConversationRead(customerId, req.user);

  res.success(result);
});

const updateStatus = asyncHandler(async (req, res) => {
  const { customerId } = parse(customerIdParamsSchema, req.params);
  const { status } = parse(statusSchema, req.body);

  if (status === "CLOSED" && !hasPermission(req.user, "chats.close_conversation")) {
    throw new ApiError(403, "لا تملك صلاحية إغلاق المحادثة");
  }

  const conversation = await conversationService.updateConversationStatus(customerId, req.user, status);

  res.success({ conversation });
});

const updatePriority = asyncHandler(async (req, res) => {
  const { customerId } = parse(customerIdParamsSchema, req.params);
  const { priority } = parse(prioritySchema, req.body);
  const conversation = await conversationService.updateConversationPriority(customerId, req.user, priority);

  res.success({ conversation });
});

module.exports = {
  listChats,
  listMessages,
  sendMessage,
  quickSend,
  sendMediaMessage,
  markRead,
  updateStatus,
  updatePriority
};
