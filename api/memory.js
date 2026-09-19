export const config = { regions: ['iad1'], maxDuration: 30 };

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

function safeMemory(item) {
  return {
    id: item?.id,
    content: String(item?.content || '').trim(),
    importance: item?.importance === 'high' ? 'high' : 'low',
    created_at: Number(item?.created_at || Date.now()),
    last_mentioned: Number(item?.last_mentioned || Date.now()),
  };
}

async function proxyError(upstream, res) {
  const text = await upstream.text().catch(() => '');
  sendJson(res, upstream.status || 502, {
    error: {
      message: '记忆云同步失败',
      upstream_status: upstream.status,
      upstream_body: text.slice(0, 800),
    },
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCors(res);

  if (req.method === 'GET') {
    try {
      const upstream = await fetch(`${SB_URL}/rest/v1/memory?select=*&order=created_at.desc`, {
        headers: sbHeaders(),
      });
      if (!upstream.ok) return proxyError(upstream, res);
      const data = await upstream.json();
      return sendJson(res, 200, Array.isArray(data) ? data : []);
    } catch (e) {
      return sendJson(res, 502, { error: { message: e.message || '记忆云同步失败' } });
    }
  }

  if (req.method === 'POST') {
    const incoming = Array.isArray(req.body) ? req.body : [req.body];
    const payload = incoming.map(safeMemory).filter(item => item.id && item.content);
    if (payload.length === 0) return sendJson(res, 400, { error: { message: '缺少记忆内容' } });

    try {
      const upstream = await fetch(`${SB_URL}/rest/v1/memory`, {
        method: 'POST',
        headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(payload),
      });
      if (!upstream.ok) return proxyError(upstream, res);
      return sendJson(res, 200, { ok: true, count: payload.length });
    } catch (e) {
      return sendJson(res, 502, { error: { message: e.message || '记忆云同步失败' } });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (!id) return sendJson(res, 400, { error: { message: '缺少记忆 ID' } });

    try {
      const upstream = await fetch(`${SB_URL}/rest/v1/memory?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: sbHeaders({ Prefer: 'return=minimal' }),
      });
      if (!upstream.ok) return proxyError(upstream, res);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 502, { error: { message: e.message || '记忆云同步失败' } });
    }
  }

  return sendJson(res, 405, { error: { message: 'Method not allowed' } });
}
