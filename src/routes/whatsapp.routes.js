const express = require("express");
const webhookController = require("../controllers/webhook.controller");
const messageController = require("../controllers/message.controller");
const authenticate = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const verifyMetaSignature = require("../middleware/metaSignature.middleware");

const router = express.Router();

router.get("/webhook", webhookController.verifyWebhook);
router.post("/webhook", verifyMetaSignature, webhookController.receiveWebhook);
router.post("/templates/bulk", authenticate, requirePermission("campaigns.send"), messageController.sendBulkTemplate);

module.exports = router;
