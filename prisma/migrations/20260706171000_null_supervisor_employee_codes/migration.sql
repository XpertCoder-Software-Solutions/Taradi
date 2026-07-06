UPDATE "User"
SET "employeeCode" = NULL,
    "supervisorId" = NULL
WHERE "role" = 'SUPERVISOR';
