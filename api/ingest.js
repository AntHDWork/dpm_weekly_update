// api/ingest.js
// Accepts POST { project_key, week_ending, dpm, raw_update, passcode? }
// Summarizes with your business LLM into your flat JSON shape,
// commits to data/<week>/<project>.json, and (optionally) dispatches combine.yml.
//
// Supported LLM setups (choose one via env):
//  A) OpenAI-compatible endpoint (Enterprise/Azure) via OPENAI_BASE_URL + OPENAI_API_KEY + OPENAI_MODEL
//  B) Custom internal LLM endpoint via INTERNAL_LLM_ENDPOINT + INTERNAL_LLM_KEY
//
// Required GitHub env: GH_TOKEN (repo scope), REPO_FULLNAME="AntHDWork/dpm_weekly_update", DEFAULT_BRANCH="main"
// Optional auth: PASSCODE (must match payload.passcode if set)
// Optional: DISPATCH_COMBINE="true" to trigger combine.yml after commit

// ----- helpers -----
async function readJson(req) {
  // Vercel sometimes parses body; normalize here.
  if (req.body && typeof req.body === 'object') return req.body;
  const text = await new Promise((resolve) => {
    let d=''; req.on('data', c => d += c); req.on('end', () => resolve(d));
  });
  return text ? JSON.parse(text) : {};
}

function bad(res, code, msg) {
  return res.status(code).json({ ok: false, error: msg });
}

function must(v) { return typeof v === 'string' && v.trim().length > 0; }

function flatTemplate({ project_key, week_ending, dpm, status='Green', delta='', milestones='', risks='', metrics='', next7='', asks='', notes='' }) {
  return {
    week_ending,
    project_key,
    dpm,
    status,
    delta,
    milestones,
    risks,
    metrics,
    next7,
    asks,
    notes,
    submitted_at: new Date().toISOString()
  };
}

// ----- LLM summarization -----
async function summarizeToFlat({ raw, project_key, week_ending, dpm }) {
  // Prefer OpenAI-compatible enterprise endpoint if configured
  const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;  // e.g. https://api.openai.com
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const OPENAI_ORG = process.env.OPENAI_ORG_ID || '';     // optional
  const OPENAI_PROJECT = process.env.OPENAI_PROJECT_ID || ''; // optional
  // ...
  const r = await fetch(`${OPENAI_BASE_URL.replace(/\/+$/,'')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      ...(OPENAI_ORG ? { 'OpenAI-Organization': OPENAI_ORG } : {}),
      ...(OPENAI_PROJECT ? { 'OpenAI-Project': OPENAI_PROJECT } : {})
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2
    })
  });
  
  const system = [
    'You convert raw weekly project updates into a strict JSON object.',
    'Output ONLY JSON. No markdown, no code fences.',
    'Fields: {',
    '  "week_ending": "YYYY-MM-DD",',
    '  "project_key": "catalogue|fulfilment|shopify_eu|shopify_us|d365|zendesk",',
    '  "dpm": "Name",',
    '  "status": "Green|Amber|Red",',
    '  "delta": "1–3 sentences of key change",',
    '  "milestones": "Milestone — YYYY-MM-DD",',
    '  "risks": "Concise risk summary or None identified.",',
    '  "metrics": "Key KPI or n/a",',
    '  "next7": "What happens next 7 days",',
    '  "asks": "Help/decisions required or None.",',
    '  "notes": "Extra context or n/a"',
    '}',
    'If a field is missing in the raw text, fill a concise best-effort from context; otherwise set a sensible short default (e.g., "None.", "n/a").',
    'Keep status to Green/Amber/Red only.'
  ].join('\n');

  const user = JSON.stringify({
    week_ending, project_key, dpm, raw_update: raw
  });

  // A) OpenAI-compatible enterprise endpoint
  if (OPENAI_BASE_URL && OPENAI_API_KEY) {
    const url = `${OPENAI_BASE_URL.replace(/\/+$/,'')}/v1/chat/completions`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: 'json_object' }, // many enterprise setups support this
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.2
      })
    });

    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok) {
      const errTxt = await r.text().catch(()=>'(no body)');
      throw new Error(`LLM error ${r.status} ${r.statusText} | ${ct} | ${errTxt.slice(0,500)}`);
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return JSON.parse(content);
  }

  // B) Custom internal LLM endpoint (you implement server-side)
  if (INTERNAL_LLM_ENDPOINT && INTERNAL_LLM_KEY) {
    const r = await fetch(INTERNAL_LLM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${INTERNAL_LLM_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ system, user })
    });
    const text = await r.text();
    // Accept either raw JSON or wrapper {result:"...json..."}
    let jsonStr = text;
    try {
      const parsed = JSON.parse(text);
      jsonStr = typeof parsed === 'string' ? parsed : (parsed.result || parsed.output || JSON.stringify(parsed));
    } catch { /* text might already be JSON string */ }
    return JSON.parse(jsonStr);
  }

  // Fallback heuristic if no LLM configured
  const fallback = flatTemplate({ project_key, week_ending, dpm });
  fallback.delta = raw?.slice(0, 240) || 'No delta provided.';
  fallback.risks = 'None identified.'; fallback.metrics = 'n/a'; fallback.next7 = 'n/a'; fallback.asks = 'None.';
  return fallback;
}

// ----- GitHub write helpers -----
async function upsertFile({ owner, repo, path, contentObj, token, branch='main' }) {
  const api = 'https://api.github.com';
  const url = `${api}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

  const content = Buffer.from(JSON.stringify(contentObj, null, 2)).toString('base64');

  // Check if file exists to include sha
  let sha = undefined;
  {
    const r = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    if (r.ok) {
      const j = await r.json();
      sha = j.sha;
    }
  }

  const body = {
    message: `chore: ingest ${contentObj.project_key} for ${contentObj.week_ending}`,
    content,
    branch
  };
  if (sha) body.sha = sha;

  const r2 = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    body: JSON.stringify(body)
  });

  if (!r2.ok) {
    const txt = await r2.text().catch(()=>'(no body)');
    throw new Error(`GitHub upsert failed: ${r2.status} ${r2.statusText}\n${txt}`);
  }

  return r2.json();
}

async function dispatchCombine({ owner, repo, week, token, branch='main' }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/combine.yml/dispatches`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    body: JSON.stringify({ ref: branch, inputs: { week } })
  });
  if (!r.ok) {
    const txt = await r.text().catch(()=>'(no body)');
    throw new Error(`Dispatch failed: ${r.status} ${r.statusText}\n${txt}`);
  }
}

// ----- handler -----
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(200).json({ ok: true, info: 'POST JSON to create/update a weekly file.' });
    }

    const body = await readJson(req);
    const { project_key, week_ending, dpm, raw_update, passcode } = body || {};

    // Simple auth
    const REQ_PASS = process.env.PASSCODE || '';
    if (REQ_PASS && passcode !== REQ_PASS) {
      return bad(res, 401, 'Unauthorized (bad passcode)');
    }

    // Basic validation
    const allowed = new Set(['catalogue','fulfilment','shopify_eu','shopify_us','d365','zendesk']);
    if (!allowed.has(project_key)) return bad(res, 400, 'Invalid project_key');
    if (!must(week_ending) || !/^\d{4}-\d{2}-\d{2}$/.test(week_ending)) return bad(res, 400, 'Invalid week_ending');
    if (!must(dpm)) return bad(res, 400, 'Missing dpm');
    if (!must(raw_update)) return bad(res, 400, 'raw_update required');

    // Summarize into flat schema
    const flat = await summarizeToFlat({ raw: raw_update, project_key, week_ending, dpm });

    // Ensure mandatory fields + our extras
    const merged = flatTemplate({ ...flat, project_key, week_ending, dpm });

    // Write to GitHub
    const REPO_FULLNAME = process.env.REPO_FULLNAME || 'AntHDWork/dpm_weekly_update';
    const [owner, repo] = REPO_FULLNAME.split('/');
    const GH_TOKEN = process.env.GH_TOKEN;
    const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || 'main';
    if (!GH_TOKEN) return bad(res, 500, 'Server misconfigured: missing GH_TOKEN');

    const path = `data/${week_ending}/${project_key}.json`;
    await upsertFile({ owner, repo, path, contentObj: merged, token: GH_TOKEN, branch: DEFAULT_BRANCH });

    // Optionally trigger combine
    if ((process.env.DISPATCH_COMBINE || '').toLowerCase() === 'true') {
      await dispatchCombine({ owner, repo, week: week_ending, token: GH_TOKEN, branch: DEFAULT_BRANCH });
    }

    return res.status(200).json({ ok: true, info: `Saved ${path}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
