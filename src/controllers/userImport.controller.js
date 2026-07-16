const asyncHandler = require("../utils/asyncHandler");
const userImportService = require("../services/userImport.service");

const importEmployees = asyncHandler(async (req, res) => res.success(await userImportService.importUsers(req.file, req.user, "EMPLOYEE"), 201));
const importSupervisors = asyncHandler(async (req, res) => res.success(await userImportService.importUsers(req.file, req.user, "SUPERVISOR"), 201));

function sendTemplate(role) {
  return (req, res) => {
    const fileName = role === "SUPERVISOR" ? "supervisors-import-template.xlsx" : "employees-import-template.xlsx";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(userImportService.buildTemplate(role));
  };
}

module.exports = { importEmployees, importSupervisors, employeeTemplate: sendTemplate("EMPLOYEE"), supervisorTemplate: sendTemplate("SUPERVISOR") };
