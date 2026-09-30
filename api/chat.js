export const config = { regions: ['hkg1'], maxDuration: 60 };

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

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeSseError(res, message, extra = {}) {
  writeSse(res, {
    type: 'error',
    error: {
      message,
      ...extra,
    },
  });
}

function collectText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join('\n\n');
  if (typeof value === 'object') {
    return collectText(value.text || value.content || value.message || value.output_text || value.summary);
  }
  return '';
}

function normalizeContentBlocks(payload) {
  if (Array.isArray(payload?.content)) return payload.content;
  const directText = collectText(payload?.content || payload?.text || payload?.output_text);
  if (directText) return [{ type: 'text', text: directText }];

  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const choiceText = collectText(choice?.message?.content || choice?.delta?.content || choice?.text);
  if (choiceText) return [{ type: 'text', text: choiceText }];

  const outputItems = Array.isArray(payload?.output) ? payload.output : [];
  const outputText = outputItems
    .map(item => collectText(item?.content || item?.text || item))
    .filter(Boolean)
    .join('\n\n');
  if (outputText) return [{ type: 'text', text: outputText }];

  return [];
}

function writeJsonAsSse(res, payload) {
  if (payload?.error) {
    writeSseError(res, payload.error.message || '上游请求失败', payload.error);
    return;
  }
  if (payload?.message && (payload?.code || payload?.type || payload?.status)) {
    writeSseError(res, payload.message, {
      code: payload.code,
      type: payload.type,
      status: payload.status,
    });
    return;
  }
  const blocks = normalizeContentBlocks(payload);
  if (blocks.length === 0 && payload?.message) {
    writeSseError(res, payload.message, payload);
    return;
  }
  if (blocks.length === 0) {
    writeSseError(res, '上游返回了空内容', {
      upstream_shape: Object.keys(payload || {}).slice(0, 12).join(','),
    });
    return;
  }
  blocks.forEach((block, index) => {
    writeSse(res, {
      type: 'content_block_start',
      index,
      content_block: block,
    });
  });
  writeSse(res, { type: 'message_stop' });
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
    const startedAt = Date.now();

    if (!apiKey) {
      return sendJson(res, 401, { error: { message: '缺少 API Key' } });
    }

    const upstreamBody = { ...body };

    if (upstreamBody.stream) {
      const upstreamBodyForProvider = { ...upstreamBody };
      delete upstreamBodyForProvider.stream;

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.write(': connected\n\n');

      try {
        const upstream = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${String(apiKey)}`,
            'x-api-key': String(apiKey),
            'anthropic-version': String(req.headers['anthropic-version'] || '2023-06-01'),
          },
          body: JSON.stringify(upstreamBodyForProvider),
          signal: ctrl.signal,
        });

        const contentType = upstream.headers.get('Content-Type') || '';
        console.log(JSON.stringify({
          event: 'chat_upstream_response',
          stream: true,
          status: upstream.status,
          content_type: contentType,
          model: upstreamBodyForProvider.model,
          elapsed_ms: Date.now() - startedAt,
        }));
        if (upstream.body && contentType.includes('text/event-stream')) {
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          return res.end();
        }

        const text = await upstream.text();
        console.log(JSON.stringify({
          event: 'chat_upstream_body',
          stream: true,
          status: upstream.status,
          content_type: contentType,
          body_chars: text.length,
          elapsed_ms: Date.now() - startedAt,
        }));
        const trimmed = text.trim();
        const isJson = contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[');
        if (!isJson) {
          writeSseError(res, `上游返回了非 JSON 内容 (${upstream.status})：${cleanText(text) || '空响应'}`, {
            upstream_status: upstream.status,
            upstream_content_type: contentType,
          });
          return res.end();
        }

        try {
          writeJsonAsSse(res, JSON.parse(text));
        } catch {
          writeSseError(res, `返回内容不是 JSON：${cleanText(text) || '空响应'}`, {
            upstream_status: upstream.status,
            upstream_content_type: contentType,
          });
        }
        return res.end();
      } catch (e) {
        const message = e.name === 'AbortError'
          ? '请求超过 55 秒，上游没有返回'
          : e.message || '代理请求失败';
        console.log(JSON.stringify({
          event: 'chat_upstream_error',
          stream: true,
          name: e.name || '',
          message,
          elapsed_ms: Date.now() - startedAt,
        }));
        writeSseError(res, message);
        return res.end();
      }
    }

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
    console.log(JSON.stringify({
      event: 'chat_upstream_response',
      stream: false,
      status: upstream.status,
      content_type: contentType,
      model: upstreamBody.model,
      elapsed_ms: Date.now() - startedAt,
    }));

    const text = await upstream.text();
    console.log(JSON.stringify({
      event: 'chat_upstream_body',
      stream: false,
      status: upstream.status,
      content_type: contentType,
      body_chars: text.length,
      elapsed_ms: Date.now() - startedAt,
    }));
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
    console.log(JSON.stringify({
      event: 'chat_handler_error',
      name: e.name || '',
      message,
    }));
    return sendJson(res, 502, { error: { message } });
  } finally {
    clearTimeout(timer);
  }
}
