const multer = require("multer");
const path = require("path");
const ApiError = require("../utils/apiError");
const { allowedMimeTypes, maxUploadBytes } = require("../config/media");

const csvMaxUploadBytes = 5 * 1024 * 1024;
const excelMaxUploadBytes = 10 * 1024 * 1024;
const customerImportMaxUploadBytes = 10 * 1024 * 1024;

function normalizeMimeType(mimeType) {
  return String(mimeType || "").split(";")[0].trim().toLowerCase();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
    files: 1
  },
  fileFilter(req, file, cb) {
    if (!allowedMimeTypes.has(normalizeMimeType(file.mimetype))) {
      return cb(new ApiError(400, "Unsupported media type", [
        { mimeType: file.mimetype }
      ]));
    }

    return cb(null, true);
  }
});

function handleUploadError(error, req, res, next) {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return next(new ApiError(400, "Uploaded file is too large", [
      { maxBytes: maxUploadBytes }
    ]));
  }

  return next(error);
}

function singleMediaUpload(req, res, next) {
  upload.single("file")(req, res, (error) => handleUploadError(error, req, res, next));
}

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: csvMaxUploadBytes,
    files: 1
  },
  fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname || "").toLowerCase();

    if (extension !== ".csv") {
      return cb(new ApiError(400, "يجب رفع ملف CSV فقط", [
        { fileName: file.originalname }
      ]));
    }

    return cb(null, true);
  }
});

function handleCsvUploadError(error, req, res, next) {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return next(new ApiError(400, "ملف CSV أكبر من الحجم المسموح", [
      { maxBytes: csvMaxUploadBytes }
    ]));
  }

  return next(error);
}

function singleCsvUpload(req, res, next) {
  csvUpload.single("file")(req, res, (error) => handleCsvUploadError(error, req, res, next));
}

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: excelMaxUploadBytes,
    files: 1
  },
  fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const allowedExtensions = new Set([".xlsx", ".xls"]);

    if (!allowedExtensions.has(extension)) {
      return cb(new ApiError(400, "يجب رفع ملف Excel فقط", [
        { fileName: file.originalname }
      ]));
    }

    return cb(null, true);
  }
});

function handleExcelUploadError(error, req, res, next) {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return next(new ApiError(400, "ملف Excel أكبر من الحجم المسموح", [
      { maxBytes: excelMaxUploadBytes }
    ]));
  }

  return next(error);
}

function singleExcelUpload(req, res, next) {
  excelUpload.single("file")(req, res, (error) => handleExcelUploadError(error, req, res, next));
}

const customerImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: customerImportMaxUploadBytes,
    files: 1
  },
  fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const allowedExtensions = new Set([".csv", ".xlsx", ".xls"]);

    if (!allowedExtensions.has(extension)) {
      return cb(new ApiError(400, "يجب رفع ملف Excel أو CSV فقط", [
        { fileName: file.originalname }
      ]));
    }

    return cb(null, true);
  }
});

function handleCustomerImportUploadError(error, req, res, next) {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return next(new ApiError(400, "ملف العملاء أكبر من الحجم المسموح", [
      { maxBytes: customerImportMaxUploadBytes }
    ]));
  }

  return next(error);
}

function singleCustomerImportUpload(req, res, next) {
  customerImportUpload.single("file")(req, res, (error) => handleCustomerImportUploadError(error, req, res, next));
}

module.exports = {
  singleMediaUpload,
  singleCsvUpload,
  singleExcelUpload,
  singleCustomerImportUpload
};
