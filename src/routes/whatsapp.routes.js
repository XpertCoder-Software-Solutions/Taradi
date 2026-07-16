const express = require("express");
const webhookController = require("../controllers/webhook.controller");
const messageController = require("../controllers/message.controller");
const templateRoutes = require("../modules/templates/template.routes");
const authenticate = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const verifyMetaSignature = require("../middleware/metaSignature.middleware");

const router = express.Router();

router.get("/webhook", webhookController.verifyWebhook);
router.post("/webhook", verifyMetaSignature, webhookController.receiveWebhook);
router.post("/templates/bulk/preview", authenticate, requirePermission("campaigns.send"), messageController.previewBulkTemplate);
router.get("/templates/bulk/:campaignId", authenticate, requirePermission("campaigns.view"), messageController.getCampaignProgress);
router.post("/templates/bulk", authenticate, requirePermission("campaigns.send"), messageController.sendBulkTemplate);
router.use("/", templateRoutes);

module.exports = router;
