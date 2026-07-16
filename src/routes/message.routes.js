const express = require("express");
const messageController = require("../controllers/message.controller");
const authenticate = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/:id/media", messageController.streamMedia);
router.post("/:id/download-media", requireRole("ADMIN"), messageController.downloadMedia);

module.exports = router;
