// api/combine.js
// This function accepts a POST payload with run_metadata and submissions[],
// then returns a stubbed executive summary and combined update in Markdown format.

function label(key) {
  switch (key) {
    case 'catalogue': return 'Product Catalogue';
    case 'fulfilment': return 'Fulfilment service';
    case 'shopify_eu': return 'Shopify EU';
    case 'shopify_us': return 'Shopify US';
    case 'd365': return 'Dynamics365';
    case 'zendesk': return 'Zendesk';
    default: return key;
  }
}

function emoji(status) {
  const s = String(status || '').toLowerCase();
  if (s.startsWith('green')) return '🟢';
  if (s.startsWith('amber')) return '🟠';
  if (s.startsWith('red')) return '🔴';
  return '⬜';
}

function coalesceStatus(a, b) {
  const priority = { red: 3, amber: 2, green: 1 };
  const norm = (v) => String(v || '').toLowerCase();
  const pa = priority[norm(a)] || 0;
  const pb = priority[norm(b)] || 0;
  return pa >= pb ? a : b;
}

function fallback(v) {
  return v && String(v).trim() ? v : '[Flag: No detail provided]';
}

const get = (obj, key, def = '') => (obj && obj[key]) ? String(obj[key]) : def;

// ✅ The serverless function export (must be CommonJS for Vercel)
module.exports = async (req, res) => {
  // Allow only POSTs (GETs will return an error)
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    // Parse incoming body safely
    const bodyRaw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(bodyRaw || '{}');
    const { run_metadata = {}, submissions = [] } = body || {};
    const week = run_metadata.week_ending || 'UNKNOWN';

    const requiredKeys = ['catalogue','fulfilment','shopify_eu','shopify_us','d365','zendesk'];
    const byKey = {};
    for (const s of submissions) {
      if (s && s.project_key) byKey[s.project_key] = s;
    }

    const missing = requiredKeys.filter(k => !byKey[k]);
    if (missing.length) {
      res.status(200).json({
        executive_summary_md: `**Executive Summary (Draft) — ${week}**\n[Flag: Awaiting input from: ${missing.join(', ')}]\n`,
        combined_update_md: `**Combined Update — ${week}**\nNot all submissions present. Missing: ${missing.join(', ')}\n`
      });
      return;
    }

    // Extract project submissions
    const cat = byKey['catalogue'];
    const ful = byKey['fulfilment'];
    const eu  = byKey['shopify_eu'];
    const us  = byKey['shopify_us'];
    const d3  = byKey['d365'];
    const zen = byKey['zendesk'];

    // Count RAG statuses
    const statuses = requiredKeys.map(k => get(byKey[k], 'status', 'Unknown'));
    const greens = statuses.filter(s => /^green$/i.test(s)).length;
    const ambers = statuses.filter(s => /^amber$/i.test(s)).length;
    const reds   = statuses.filter(s => /^red$/i.test(s)).length;

    // Basic “notables” for the executive summary
    const notable = [];
    for (const k of requiredKeys) {
      const s = byKey[k];
      const d = get(s, 'delta').toLowerCase();
      if (!d) continue;
      if (d.includes('risk') || d.includes('block')) notable.push(`⚠️ ${label(k)} — risk/blocker mentioned`);
      if (d.includes('slip') || d.includes('delay')) notable.push(`⏳ ${label(k)} — timeline movement`);
      if (d.includes('launch') || d.includes('go live') || d.includes('deployed')) notable.push(`🚀 ${label(k)} — launch/progress`);
    }

    const execLines = [
      `**Executive Summary — ${week}**`,
      `• Status snapshot: 🟢 ${greens} | 🟠 ${ambers} | 🔴 ${reds}`,
      `• Shopify covered by EU (${get(eu,'dpm')}) and US (${get(us,'dpm')}); merged view below.`,
      `• Product Catalogue & Fulfilment reported by ${get(cat,'dpm')} (split in output).`,
      ...(notable.length ? notable.slice(0, 4).map(n => `• ${n}`) : ['• No notable deltas auto-detected in stub.'])
    ].join('\n');

    const section =

