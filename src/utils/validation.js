const ApiError = require("./apiError");

function parse(schema, data) {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new ApiError(400, "Validation failed", result.error.flatten());
  }

  return result.data;
}

module.exports = parse;
