const express = require("express");
const templateController = require("./template.controller");
const authenticate = require("../../middleware/auth.middleware");
const { requireAnyPermission } = require("../../middleware/permission.middleware");
const { messageSendLimiter, templateSyncLimiter } = require("../../middleware/rateLimit.middleware");
const ApiError = require("../../utils/apiError");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    throw new ApiError(403, "هذه العملية متاحة للمدير فقط");
  }

  next();
}

router.use(authenticate);

router.get(
  "/templates",
  requireAnyPermission("templates.view", "templates.send", "chats.send_message"),
  templateController.listTemplates
);
router.get(
  "/templates/mapping-fields",
  requireAnyPermission("templates.view", "campaigns.view"),
  templateController.listMappingFields
);
router.get(
  "/templates/:templateId/mapping",
  requireAnyPermission("templates.view", "campaigns.view"),
  templateController.getTemplateMapping
);
router.put("/templates/:templateId/mapping", requireAdmin, templateController.saveTemplateMapping);
router.post("/templates/sync", requireAdmin, templateSyncLimiter, templateController.syncTemplates);
router.post(
  "/messages/template",
  requireAnyPermission("templates.send", "chats.send_message"),
  messageSendLimiter,
  templateController.sendTemplateMessage
);

module.exports = router;
