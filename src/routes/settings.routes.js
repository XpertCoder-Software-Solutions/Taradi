const express = require("express");
const settingsController = require("../controllers/settings.controller");
const authenticate = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");

const router = express.Router();

router.use(authenticate);
router.use(requireRole("ADMIN"));

router.get("/permissions", settingsController.getPermissions);
router.patch("/permissions", settingsController.updatePermissions);
router.get("/campaign-safety", settingsController.getCampaignSafety);
router.patch("/campaign-safety", settingsController.updateCampaignSafety);

module.exports = router;
