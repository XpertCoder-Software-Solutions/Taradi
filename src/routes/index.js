const express = require("express");
const authRoutes = require("./auth.routes");
const employeeRoutes = require("./employee.routes");
const customerRoutes = require("./customer.routes");
const chatRoutes = require("./chat.routes");
const inboxRoutes = require("./inbox.routes");
const whatsappRoutes = require("./whatsapp.routes");
const settingsRoutes = require("./settings.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/employees", employeeRoutes);
router.use("/customers", customerRoutes);
router.use("/chats", chatRoutes);
router.use("/inbox", inboxRoutes);
router.use("/whatsapp", whatsappRoutes);
router.use("/settings", settingsRoutes);

module.exports = router;
