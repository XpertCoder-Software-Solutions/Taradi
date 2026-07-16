const express = require("express");
const authenticate = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");
const { importLimiter } = require("../middleware/rateLimit.middleware");
const { singleExcelUpload } = require("../middleware/upload.middleware");
const controller = require("../controllers/userImport.controller");

const router = express.Router();
router.use(authenticate);
router.post("/import/employees", requireRole("ADMIN", "SUPERVISOR"), importLimiter, singleExcelUpload, controller.importEmployees);
router.post("/import/supervisors", requireRole("ADMIN"), importLimiter, singleExcelUpload, controller.importSupervisors);
router.get("/import/employees/template", requireRole("ADMIN", "SUPERVISOR"), controller.employeeTemplate);
router.get("/import/supervisors/template", requireRole("ADMIN"), controller.supervisorTemplate);
module.exports = router;
