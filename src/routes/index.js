const express = require("express");
const authRoutes = require("./auth.routes");
const employeeRoutes = require("./employee.routes");
const customerRoutes = require("./customer.routes");
const chatRoutes = require("./chat.routes");
const messageRoutes = require("./message.routes");
const inboxRoutes = require("./inbox.routes");
const whatsappRoutes = require("./whatsapp.routes");
const settingsRoutes = require("./settings.routes");
const userRoutes = require("./user.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/employees", employeeRoutes);
router.use("/customers", customerRoutes);
router.use("/chats", chatRoutes);
router.use("/messages", messageRoutes);
router.use("/inbox", inboxRoutes);
router.use("/whatsapp", whatsappRoutes);
router.use("/settings", settingsRoutes);
router.use("/users", userRoutes);

module.exports = router;
