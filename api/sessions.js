export const config = { regions: ['hkg1'], maxDuration: 30 };

const SB_URL = process.env.SUPABASE_URL || 'https://xtyouprikflaumctggxs.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_7of0a388w-l2JV8rD3K8rg_3Jh3ZniY';

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

function sendCors(res) {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end();
}

function sbHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    ...extra,
  };
}

function normalizeMemoryMode(mode) {
  return ['normal', 'immersive', 'off'].includes(mode) ? mode : 'normal';
}

function safeSession(session) {
  return {
    id: session?.id,
    title: session?.title || '新对话',
    messages: Array.isArray(session?.messages) ? session.messages : [],
    created_at: Number(session?.created_at || session?.id || Date.now()),
    unread: Number(session?.unread || 0),
    last_read_at: Number(session?.last_read_at || 0),
    last_message_at: Number(session?.last_message_at || 0),
    summary: session?.summary || '',
    summary_message_count: Number(session?.summary_message_count || 0),
    memory_mode: normalizeMemoryMode(session?.memory_mode),
    memory_mode_updated_at: Number(session?.memory_mode_updated_at || 0),
  };
}

async function proxyError(upstream, res) {
  const text = await upstream.text().catch(() => '');
  sendJson(res, upstream.status || 502, {
    error: {
      message: '会话云同步失败',
      upstream_status: upstream.status,
      upstream_body: text.slice(0, 800),
    },
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCors(res);

  if (req.method === 'GET') {
    try {
      const upstream = await fetch(`${SB_URL}/rest/v1/sessions?select=*&order=created_at.desc`, {
        headers: sbHeaders(),
      });
      if (!upstream.ok) return proxyError(upstream, res);
      const data = await upstream.json();
      return sendJson(res, 200, Array.isArray(data) ? data : []);
    } catch (e) {
      return sendJson(res, 502, { error: { message: e.message || '会话云同步失败' } });
    }
  }

  if (req.method === 'POST') {
    const incoming = Array.isArray(req.body) ? req.body : [req.body];
    const payload = incoming.map(safeSession).filter(session => session.id);
    if (payload.length === 0) return sendJson(res, 400, { error: { message: '缺少会话 ID' } });

    try {
      const upstream = await fetch(`${SB_URL}/rest/v1/sessions`, {
        method: 'POST',
        headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(payload),
      });
      if (!upstream.ok) return proxyError(upstream, res);
      return sendJson(res, 200, { ok: true, count: payload.length });
    } catch (e) {
      return sendJson(res, 502, { error: { message: e.message || '会话云同步失败' } });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (!id) return sendJson(res, 400, { error: { message: '缺少会话 ID' } });

    try {
      const upstream = await fetch(`${SB_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: sbHeaders({ Prefer: 'return=minimal' }),
      });
      if (!upstream.ok) return proxyError(upstream, res);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 502, { error: { message: e.message || '会话云同步失败' } });
    }
  }

  return sendJson(res, 405, { error: { message: 'Method not allowed' } });
}
