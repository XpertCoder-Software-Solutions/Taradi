function getPagination(query, defaults = {}) {
  const page = Math.max(Number(query.page || defaults.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || defaults.limit || 50), 1), defaults.max || 100);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

module.exports = getPagination;
