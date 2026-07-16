const express = require("express");
const chatController = require("../controllers/chat.controller");
const authenticate = require("../middleware/auth.middleware");
const { requireAnyPermission, requirePermission } = require("../middleware/permission.middleware");
const { mediaUploadLimiter, messageSendLimiter } = require("../middleware/rateLimit.middleware");
const { singleMediaUpload } = require("../middleware/upload.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/", requireAnyPermission("chats.view_assigned", "chats.view_team"), chatController.listChats);
router.post("/quick-send", requirePermission("chats.send_message"), messageSendLimiter, chatController.quickSend);
router.get("/:customerId/messages", requireAnyPermission("chats.view_assigned", "chats.view_team"), chatController.listMessages);
router.post("/:customerId/messages", requirePermission("chats.send_message"), messageSendLimiter, chatController.sendMessage);
router.post("/:customerId/messages/media", requirePermission("chats.send_media"), mediaUploadLimiter, singleMediaUpload, chatController.sendMediaMessage);
router.patch("/:customerId/read", requirePermission("chats.mark_read"), chatController.markRead);
router.patch("/:customerId/status", requireAnyPermission("chats.change_status", "chats.close_conversation"), chatController.updateStatus);
router.patch("/:customerId/priority", requirePermission("chats.change_priority"), chatController.updatePriority);

module.exports = router;
