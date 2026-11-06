// Preloaded into the test server (node -r): search agents get fixed results from the JSON file in
// $FAKE_POLL ({ "<agent label>": [listing data …] }) instead of fetching real portals.
// Everything after the fetch – linking, duplicates, visibility, notifications – runs for real.
const fs = require('fs');
const poller = require('../../server/poller');

poller.pollSearchJob = async (job, exists, insert) => {
  const plan = JSON.parse(fs.readFileSync(process.env.FAKE_POLL, 'utf8'))[job.label] || [];
  let newCount = 0;
  for (const d of plan) {
    if (exists(d.url)) continue;
    insert({ status: 'active', images_json: '[]', tags_json: '[]', ...d });
    newCount++;
  }
  return { newCount, totalFound: plan.length };
};
