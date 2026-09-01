export const config = { runtime: 'edge', regions: ['hkg1'], maxDuration: 60 };

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 800);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version, x-base-url',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const apiKey = req.headers.get('x-api-key');
    const baseUrl = req.headers.get('x-base-url') || 'https://ai.aiclick.cc';

    if (!apiKey) {
      return jsonResponse({ error: { message: '缺少 API Key' } }, 401);
    }

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const contentType = response.headers.get('Content-Type') || '';

    if (body.stream && response.ok && response.body && contentType.includes('text/event-stream')) {
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': contentType || 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const data = await response.text();
    const trimmed = data.trim();
    const isJson = contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[');
    if (!isJson) {
      return jsonResponse({
        error: {
          message: `上游返回了非 JSON 内容 (${response.status})：${cleanText(data) || '空响应'}`,
          upstream_status: response.status,
          upstream_content_type: contentType,
        },
      }, response.ok ? 502 : response.status);
    }

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return jsonResponse({ error: { message: e.message || '代理请求失败' } }, 500);
  }
}
