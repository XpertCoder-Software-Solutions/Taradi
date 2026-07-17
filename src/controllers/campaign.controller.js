const { z } = require("zod");
const service = require("../services/campaign-control.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");

const params = z.object({ id: z.string().uuid() });
const reasonBody = z.object({ reason: z.string().trim().max(1000).optional() }).default({});
const id = (req) => parse(params, req.params).id;

module.exports = {
  start: asyncHandler(async (req, res) => res.success(await service.startCampaign(req.user, id(req)))),
  pause: asyncHandler(async (req, res) => res.success(await service.pauseCampaign(req.user, id(req), parse(reasonBody, req.body || {}).reason))),
  resume: asyncHandler(async (req, res) => res.success(await service.resumeCampaign(req.user, id(req)))),
  cancel: asyncHandler(async (req, res) => res.success(await service.cancelCampaign(req.user, id(req), parse(reasonBody, req.body || {}).reason))),
  progress: asyncHandler(async (req, res) => res.success(await service.getProgress(req.user, id(req)))),
  skipped: asyncHandler(async (req, res) => res.success(await service.listRecipients(req.user, id(req), "skipped", req.query))),
  failures: asyncHandler(async (req, res) => res.success(await service.listRecipients(req.user, id(req), "failed", req.query)))
};
