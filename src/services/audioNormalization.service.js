const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const logger = require("../config/logger");

const WEBM_AUDIO_TYPES = new Set(["audio/webm"]);
const PASSTHROUGH_AUDIO_TYPES = new Set([
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr"
]);

let ffmpegAvailable;
let ffmpegRunner = runFfmpegProcess;

function normalizeMimeType(mimeType) {
  return String(mimeType || "").split(";")[0].trim().toLowerCase() || null;
}

function safeOutputName() {
  return `${crypto.randomUUID()}.ogg`;
}

function mediaError(message, code, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = options.status || 400;
  error.permanent = options.permanent !== undefined ? options.permanent : true;
  error.retryable = Boolean(options.retryable);
  return error;
}

function temporaryFsError(error) {
  return ["EAGAIN", "EBUSY", "EMFILE", "ENFILE", "ENOSPC", "EIO"].includes(error && error.code);
}

function runFfmpegProcess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr });
        return;
      }

      const error = new Error("FFmpeg audio conversion failed");
      error.exitCode = code;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function ensureFfmpegAvailable() {
  if (ffmpegAvailable === true) {
    return;
  }

  try {
    await ffmpegRunner(["-version"]);
    ffmpegAvailable = true;
  } catch (error) {
    ffmpegAvailable = false;
    throw mediaError(
      "FFmpeg is required to send WebM voice notes. Install ffmpeg on the server.",
      "FFMPEG_UNAVAILABLE",
      { status: 400, permanent: true }
    );
  }
}

function buildConversionArgs(inputPath, outputPath) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "libopus",
    "-b:a",
    "32k",
    "-f",
    "ogg",
    outputPath
  ];
}

async function removePath(targetPath) {
  if (!targetPath) {
    return;
  }

  await fs.promises.rm(targetPath, {
    force: true,
    recursive: true
  });
}

async function cleanupNormalizedAudio(normalized) {
  if (!normalized || !normalized.converted) {
    return;
  }

  await removePath(normalized.tempDir || path.dirname(normalized.filePath));
}

async function normalizeOutboundAudio({ filePath, fileName, mimeType }) {
  const inputMimeType = normalizeMimeType(mimeType);

  if (!WEBM_AUDIO_TYPES.has(inputMimeType)) {
    if (!PASSTHROUGH_AUDIO_TYPES.has(inputMimeType)) {
      throw mediaError(
        `Unsupported outbound audio MIME type: ${inputMimeType || "unknown"}`,
        "OUTBOUND_AUDIO_UNSUPPORTED_TYPE",
        { status: 400, permanent: true }
      );
    }

    return {
      filePath,
      fileName: path.basename(String(fileName || "audio")),
      mimeType: inputMimeType || mimeType || "application/octet-stream",
      converted: false
    };
  }

  await ensureFfmpegAvailable();

  const inputPath = path.resolve(String(filePath || ""));
  let inputStat;

  try {
    inputStat = await fs.promises.stat(inputPath);
  } catch (error) {
    const retryable = temporaryFsError(error);
    throw mediaError(
      "Stored voice recording is not readable",
      "OUTBOUND_AUDIO_INPUT_UNREADABLE",
      { status: retryable ? 503 : 400, permanent: !retryable, retryable }
    );
  }

  if (!inputStat.isFile()) {
    throw mediaError("Stored voice recording is not a file", "OUTBOUND_AUDIO_INPUT_INVALID");
  }

  let tempDir;
  let outputPath;

  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "taradi-audio-"));
    outputPath = path.join(tempDir, safeOutputName());
  } catch (error) {
    const retryable = temporaryFsError(error);
    throw mediaError(
      "Could not allocate temporary audio conversion file",
      "OUTBOUND_AUDIO_TEMP_UNAVAILABLE",
      { status: retryable ? 503 : 400, permanent: !retryable, retryable }
    );
  }

  const startedAt = Date.now();

  try {
    await ffmpegRunner(buildConversionArgs(inputPath, outputPath));
    const outputStat = await fs.promises.stat(outputPath);

    logger.info({
      durationMs: Date.now() - startedAt,
      inputMimeType,
      inputSize: inputStat.size,
      outputMimeType: "audio/ogg",
      outputSize: outputStat.size,
      converted: true
    }, "Converted outbound voice note to OGG/Opus");

    return {
      filePath: outputPath,
      fileName: path.basename(outputPath),
      mimeType: "audio/ogg",
      fileSize: outputStat.size,
      converted: true,
      tempDir
    };
  } catch (error) {
    await removePath(tempDir);
    throw mediaError(
      "Could not convert WebM voice note to OGG/Opus",
      "OUTBOUND_AUDIO_CONVERSION_FAILED",
      { status: 400, permanent: true }
    );
  }
}

function _setFfmpegRunnerForTests(runner) {
  ffmpegRunner = runner || runFfmpegProcess;
  ffmpegAvailable = undefined;
}

function _resetFfmpegAvailabilityForTests() {
  ffmpegAvailable = undefined;
  ffmpegRunner = runFfmpegProcess;
}

module.exports = {
  PASSTHROUGH_AUDIO_TYPES,
  WEBM_AUDIO_TYPES,
  cleanupNormalizedAudio,
  normalizeMimeType,
  normalizeOutboundAudio,
  _buildConversionArgsForTests: buildConversionArgs,
  _setFfmpegRunnerForTests,
  _resetFfmpegAvailabilityForTests
};
