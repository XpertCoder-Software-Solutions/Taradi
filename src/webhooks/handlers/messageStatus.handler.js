const { processStatus } = require("../../services/webhook.service");

async function handleMessageStatuses({ value }) {
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];
  const results = [];
  let processed = 0;
  let ignored = 0;

  for (const status of statuses) {
    const result = await processStatus(status);
    results.push(result);

    if (result.updated) {
      processed += 1;
    } else {
      ignored += 1;
    }
  }

  return {
    processed,
    ignored,
    statuses: results
  };
}

module.exports = {
  handleMessageStatuses
};
