// BRUTIIT chat proxy — Cloudflare Pages (_worker.js) — Google Gemini
// Needs one secret environment variable: GEMINI_API_KEY

const GEMINI_MODEL = 'gemini-2.5-flash'; // change here if you want another Gemini model

const ALLOWED_ORIGINS = [
  'https://brutiit.in',
  'https://www.brutiit.in'
];

const SYSTEM_PROMPT = `You are the website assistant for BRUTIIT (brutiit.in), a technology studio based in India.

BRUTIIT services: Web Development, App Development (Android & iOS), Software Development (custom systems, CRM, ERP, billing, inventory), Cybersecurity (vulnerability assessment, penetration testing, OWASP-aligned reviews), AI & Automation (chatbots, workflow automation, AI apps), Cloud & DevOps (deployment, CI/CD, monitoring, scaling).

Facts you can share:
- Typical timelines: websites 3-6 weeks, custom software/apps 6-12 weeks, confirmed after understanding requirements.
- Pricing depends on scope; a detailed quote is given after discussing requirements. Never invent prices.
- Ongoing maintenance and support available after launch.
- Clients get full source code ownership; NDA and data protection offered.
- Contact: WhatsApp +91 92072 71076, email hello@brutiit.in, or the "Start a Project" form on the site.

Rules:
- Be friendly, concise (2-4 short sentences), and plain-text only (no markdown, no asterisks).
- Reply in the same language the visitor writes in (English, Malayalam, Manglish, etc.).
- Only answer about BRUTIIT and its services or general tech questions relevant to a visitor's project. Politely redirect anything else.
- Never make up facts, clients, prices or guarantees. If unsure, suggest contacting the team on WhatsApp.
- When someone shows interest in a project, encourage them to tap "Start a Project" or WhatsApp the team.`;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Forbidden' }, 403, origin);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server not configured' }, 500, origin);
    }

    let payload;
    try { payload = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400, origin); }

    // sanitize: last 12 messages, valid roles, capped length
    let messages = Array.isArray(payload.messages) ? payload.messages : [];
    messages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));

    // conversation must start with and end on a user message
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return json({ error: 'No user message' }, 400, origin);
    }

    // convert to Gemini format (assistant -> model)
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': env.GEMINI_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: {
              maxOutputTokens: 400,
              temperature: 0.6,
              thinkingConfig: { thinkingBudget: 0 }
            }
          })
        }
      );
      if (!res.ok) return json({ error: 'Upstream error' }, 502, origin);

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const reply = parts.map(p => p.text || '').join('').trim();
      if (!reply) return json({ error: 'Empty reply' }, 502, origin);
      return json({ reply }, 200, origin);
    } catch (e) {
      return json({ error: 'Request failed' }, 500, origin);
    }
  }
};
