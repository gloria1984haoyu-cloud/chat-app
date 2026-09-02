export const config = { runtime: 'edge', regions: ['hkg1'], maxDuration: 60 };

const SB_URL = process.env.SUPABASE_URL || 'https://xtyouprikflaumctggxs.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_7of0a388w-l2JV8rD3K8rg_3Jh3ZniY';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
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

async function readRequestJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function proxyError(res) {
  const text = await res.text().catch(() => '');
  return jsonResponse({
    error: {
      message: '会话云同步失败',
      upstream_status: res.status,
      upstream_body: text.slice(0, 800),
    },
  }, res.status || 502);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsResponse();

  if (req.method === 'GET') {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/sessions?select=*&order=created_at.desc`, {
        headers: sbHeaders(),
      });
      if (!res.ok) return proxyError(res);
      const data = await res.json();
      return jsonResponse(Array.isArray(data) ? data : []);
    } catch (e) {
      return jsonResponse({ error: { message: e.message || '会话云同步失败' } }, 502);
    }
  }

  if (req.method === 'POST') {
    const body = await readRequestJson(req);
    const incoming = Array.isArray(body) ? body : [body];
    const payload = incoming.map(safeSession).filter(session => session.id);
    if (payload.length === 0) return jsonResponse({ error: { message: '缺少会话 ID' } }, 400);

    try {
      const res = await fetch(`${SB_URL}/rest/v1/sessions`, {
        method: 'POST',
        headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(payload),
      });
      if (!res.ok) return proxyError(res);
      return jsonResponse({ ok: true, count: payload.length });
    } catch (e) {
      return jsonResponse({ error: { message: e.message || '会话云同步失败' } }, 502);
    }
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: { message: '缺少会话 ID' } }, 400);

    try {
      const res = await fetch(`${SB_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: sbHeaders({ Prefer: 'return=minimal' }),
      });
      if (!res.ok) return proxyError(res);
      return jsonResponse({ ok: true });
    } catch (e) {
      return jsonResponse({ error: { message: e.message || '会话云同步失败' } }, 502);
    }
  }

  return jsonResponse({ error: { message: 'Method not allowed' } }, 405);
}
