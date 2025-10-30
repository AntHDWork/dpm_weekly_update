// api/combine.js
// Minimal working version to confirm your Vercel API endpoint works correctly.
// It will respond to GET and POST with predictable JSON.

module.exports = async (req, res) => {
  // Only allow POST for real use, but respond to GET so you can test in browser.
  if (req.method === 'GET') {
    res.status(200).json({
      message: 'Combine endpoint reachable',
      instructions: 'Send a POST with { run_metadata, submissions[] } to get combined summary output.'
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { run_metadata = {}, submissions = [] } = body || {};

    const week = run_metadata.week_ending || 'UNKNOWN';
    const projectCount = submissions.length;

    // Dummy combined output for now
    const executive_summary_md = `**Executive Summary — ${week}**\nReceived ${projectCount} project updates.`;
    const combined_update_md = submissions
      .map((s, i) => `**${i + 1}. ${s.project_key || 'Unknown Project'}** — ${s.dpm || 'Unknown DPM'}`)
      .join('\n');

    res.status(200).json({ executive_summary_md, combined_update_md });
  } catch (err) {
    res.status(400).json({ error: 'Bad request', detail: String(err.message || err) });
  }
};
