const { z } = require("zod");
const asyncHandler = require("../../utils/asyncHandler");
const parse = require("../../utils/validation");
const templateService = require("./template.service");
const templateMappingService = require("./templateMapping.service");

const listTemplatesSchema = z.object({
  status: z.string().trim().optional(),
  category: z.string().trim().optional(),
  language: z.string().trim().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

const sendTemplateSchema = z.object({
  customerId: z.string().uuid(),
  templateName: z.string().trim().min(1),
  language: z.string().trim().min(2),
  parameters: z.array(z.union([
    z.string(),
    z.number(),
    z.boolean()
  ])).optional().default([])
});

const templateIdParamsSchema = z.object({
  templateId: z.string().uuid()
});

const saveTemplateMappingSchema = z.object({
  mappings: z.array(z.object({
    variableKey: z.string().trim().min(1),
    fieldKey: z.string().trim().min(1),
    sourceScope: z.enum(["customer", "debt", "computed"]).optional(),
    transformer: z.string().trim().nullable().optional(),
    fallbackValue: z.string().trim().nullable().optional()
  })).default([])
});

const syncTemplates = asyncHandler(async (req, res) => {
  const result = await templateService.syncTemplatesFromMeta();
  res.success({
    fetched: result.fetched,
    synced: result.synced,
    created: result.created,
    updated: result.updated,
    failed: result.failed,
    skipped: result.skipped,
    pages: result.pages,
    meta: result.meta
  });
});

const listTemplates = asyncHandler(async (req, res) => {
  const query = parse(listTemplatesSchema, req.query);
  const result = await templateService.listTemplates(query);
  res.success(result);
});

const sendTemplateMessage = asyncHandler(async (req, res) => {
  const data = parse(sendTemplateSchema, req.body);
  const result = await templateService.sendTemplateMessage(req.user, data);
  res.success(result, 201);
});

const listMappingFields = asyncHandler(async (req, res) => {
  res.success({
    fields: templateMappingService.getMappingFields(),
    transformers: templateMappingService.getTransformers(),
    defaultProfiles: templateMappingService.defaultMappingProfiles
  });
});

const getTemplateMapping = asyncHandler(async (req, res) => {
  const { templateId } = parse(templateIdParamsSchema, req.params);
  const result = await templateMappingService.getTemplateMapping(templateId);
  res.success({
    ...result,
    template: templateService.formatTemplate(result.template)
  });
});

const saveTemplateMapping = asyncHandler(async (req, res) => {
  const { templateId } = parse(templateIdParamsSchema, req.params);
  const data = parse(saveTemplateMappingSchema, req.body);
  const result = await templateMappingService.saveTemplateMapping(templateId, data.mappings);
  res.success({
    ...result,
    template: templateService.formatTemplate(result.template)
  });
});

module.exports = {
  listTemplates,
  listMappingFields,
  getTemplateMapping,
  saveTemplateMapping,
  sendTemplateMessage,
  syncTemplates
};
