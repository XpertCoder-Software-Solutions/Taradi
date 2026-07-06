const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const swaggerUi = require("swagger-ui-express");
const path = require("path");
const routes = require("./routes");
const env = require("./config/env");
const logger = require("./config/logger");
const { uploadRoot } = require("./config/media");
const { getSwaggerSpecForRequest } = require("./config/swagger");
const sanitizeUrl = require("./utils/sanitizeUrl");
const { ensureUploadDirectory } = require("./utils/mediaStorage");
const { notFound, errorHandler } = require("./middleware/error.middleware");
const responseMiddleware = require("./middleware/response.middleware");
const {
  generalApiLimiter,
  authLimiter,
  webhookLimiter
} = require("./middleware/rateLimit.middleware");

const app = express();

app.set("trust proxy", 1);

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: sanitizeUrl(req.url),
        remoteAddress: req.remoteAddress,
        remotePort: req.remotePort
      };
    }
  }
}));
app.get("/api/docs.json", (req, res) => {
  res.json(getSwaggerSpecForRequest(req));
});
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(null, {
  explorer: true,
  customSiteTitle: "Taradi API Docs",
  swaggerOptions: {
    url: "/api/docs.json"
  }
}));

app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.json({
  limit: "2mb",
  verify(req, res, buffer) {
    if (req.method === "POST" && req.originalUrl.startsWith("/api/whatsapp/webhook")) {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));
ensureUploadDirectory();
app.use("/uploads", express.static(path.resolve(uploadRoot), {
  dotfiles: "deny",
  index: false,
  maxAge: "1h",
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'");
  }
}));
app.use(responseMiddleware);
app.use("/api/auth", authLimiter);
app.use("/api/whatsapp/webhook", webhookLimiter);
app.use("/api", generalApiLimiter);

app.get("/health", (req, res) => {
  res.success({
    status: "ok",
    service: "taradi-whatsapp-crm-backend"
  });
});

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
