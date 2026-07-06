const multer = require("multer");
const path = require("path");
const ApiError = require("../utils/apiError");
const { allowedMimeTypes, maxUploadBytes } = require("../config/media");

const csvMaxUploadBytes = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
    files: 1
  },
  fileFilter(req, file, cb) {
    if (!allowedMimeTypes.has(file.mimetype)) {
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

module.exports = {
  singleMediaUpload,
  singleCsvUpload
};
