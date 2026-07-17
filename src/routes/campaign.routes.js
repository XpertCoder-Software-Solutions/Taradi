const express = require("express");
const controller = require("../controllers/campaign.controller");
const authenticate = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");

const router = express.Router();
router.use(authenticate);
router.post("/:id/start", requirePermission("campaigns.send"), controller.start);
router.post("/:id/pause", requirePermission("campaigns.send"), controller.pause);
router.post("/:id/resume", requirePermission("campaigns.send"), controller.resume);
router.post("/:id/cancel", requirePermission("campaigns.send"), controller.cancel);
router.get("/:id/progress", requirePermission("campaigns.view"), controller.progress);
router.get("/:id/skipped-recipients", requirePermission("campaigns.view"), controller.skipped);
router.get("/:id/failures", requirePermission("campaigns.view"), controller.failures);
module.exports = router;
