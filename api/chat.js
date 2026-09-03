export const config = { regions: ['iad1'], maxDuration: 60 };

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(payload));
}

function sendCors(res) {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version, x-base-url');
  res.end();
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 800);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

function normalizeBaseUrl(value) {
  const base = String(value || 'https://ai.aiclick.cc').trim().replace(/\/+$/, '');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('接口地址格式不对');
  return url.toString().replace(/\/+$/, '');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCors(res);

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: { message: 'Method not allowed' } });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);

  try {
    const body = await readJsonBody(req);
    const apiKey = req.headers['x-api-key'];
    const baseUrl = normalizeBaseUrl(req.headers['x-base-url']);

    if (!apiKey) {
      return sendJson(res, 401, { error: { message: '缺少 API Key' } });
    }

    const upstreamBody = { ...body };

    const upstream = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${String(apiKey)}`,
        'x-api-key': String(apiKey),
        'anthropic-version': String(req.headers['anthropic-version'] || '2023-06-01'),
      },
      body: JSON.stringify(upstreamBody),
      signal: ctrl.signal,
    });

    const contentType = upstream.headers.get('Content-Type') || '';

    if (upstreamBody.stream && upstream.body && contentType.includes('text/event-stream')) {
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    }

    const text = await upstream.text();
    const trimmed = text.trim();
    const isJson = contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[');

    if (!isJson) {
      return sendJson(res, upstream.ok ? 502 : upstream.status, {
        error: {
          message: `上游返回了非 JSON 内容 (${upstream.status})：${cleanText(text) || '空响应'}`,
          upstream_status: upstream.status,
          upstream_content_type: contentType,
        },
      });
    }

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end(text);
  } catch (e) {
    const message = e.name === 'AbortError'
      ? '请求超过 55 秒，上游没有返回'
      : e.message || '代理请求失败';
    return sendJson(res, 502, { error: { message } });
  } finally {
    clearTimeout(timer);
  }
}
