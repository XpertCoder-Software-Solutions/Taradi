const express = require("express");
const customerController = require("../controllers/customer.controller");
const customerDebtController = require("../controllers/customerDebt.controller");
const messageController = require("../controllers/message.controller");
const authenticate = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");
const { requireAnyPermission, requirePermission } = require("../middleware/permission.middleware");
const { importLimiter, messageSendLimiter } = require("../middleware/rateLimit.middleware");
const { singleCsvUpload, singleCustomerImportUpload } = require("../middleware/upload.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/", requireAnyPermission("customers.view_assigned", "customers.view_team"), customerController.listCustomers);
router.post("/", requirePermission("customers.create"), customerController.createCustomer);
router.post("/import-csv", requirePermission("customers.import_csv"), importLimiter, singleCsvUpload, customerController.importCustomersCsv);
router.post("/import-excel", requirePermission("customers.import_csv"), importLimiter, singleCustomerImportUpload, customerController.importCustomersExcel);
router.get("/:customerId/debts", requirePermission("debts.view"), customerDebtController.list);
router.post("/:customerId/debts", requirePermission("debts.create"), customerDebtController.create);
router.get("/:customerId/debts/:debtId", requirePermission("debts.view"), customerDebtController.get);
router.patch("/:customerId/debts/:debtId", requirePermission("debts.edit"), customerDebtController.update);
router.post("/:customerId/debts/:debtId/archive", requirePermission("debts.archive"), customerDebtController.archive);
router.get("/:id", requireAnyPermission("customers.view_assigned", "customers.view_team"), customerController.getCustomer);
router.patch("/:id", requirePermission("customers.edit"), customerController.updateCustomer);
router.patch("/:id/collection-status", requirePermission("customers.edit"), customerController.updateCollectionStatus);
router.patch("/:id/communication-preferences", requireRole("ADMIN"), customerController.updateCommunicationPreferences);
router.delete("/:id", requireRole("ADMIN"), customerController.deleteCustomer);
router.patch("/:id/assign", requirePermission("customers.assign"), customerController.assignCustomer);
router.get("/:id/messages", requireAnyPermission("chats.view_assigned", "chats.view_team"), messageController.listMessages);
router.post("/:id/messages", requirePermission("chats.send_message"), messageSendLimiter, messageController.sendManualReply);
router.post("/:id/messages/read", requirePermission("chats.mark_read"), messageController.markRead);

module.exports = router;
