const express = require("express");
const employeeController = require("../controllers/employee.controller");
const authenticate = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");
const { requireAnyPermission, requirePermission } = require("../middleware/permission.middleware");
const { importLimiter } = require("../middleware/rateLimit.middleware");
const { singleExcelUpload } = require("../middleware/upload.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/", requirePermission("employees.view_team"), employeeController.listEmployees);
router.get("/presence", employeeController.getPresence);
router.get("/import/template", requireRole("ADMIN", "SUPERVISOR"), employeeController.employeeImportTemplate);
router.post("/import", requireRole("ADMIN", "SUPERVISOR"), importLimiter, singleExcelUpload, employeeController.importEmployees);
router.post("/", requireAnyPermission("employees.create", "employees.view_team"), employeeController.createEmployee);
router.patch("/:id/deactivate", requirePermission("employees.activate_deactivate"), employeeController.deactivateEmployee);
router.patch("/:id/activate", requirePermission("employees.activate_deactivate"), employeeController.activateEmployee);
router.patch("/:id", requirePermission("employees.edit"), employeeController.updateEmployee);
router.delete("/:id", requirePermission("employees.activate_deactivate"), employeeController.deactivateEmployee);

module.exports = router;
