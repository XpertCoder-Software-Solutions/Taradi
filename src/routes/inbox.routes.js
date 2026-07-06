const express = require("express");
const messageController = require("../controllers/message.controller");
const authenticate = require("../middleware/auth.middleware");
const { requireAnyPermission } = require("../middleware/permission.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/", requireAnyPermission("chats.view_assigned", "chats.view_team"), messageController.getInbox);

module.exports = router;
