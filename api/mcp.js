/**
 * MCP (Model Context Protocol) Server - Basic Edition
 *
 * Endpoint: POST /api/mcp
 *
 * Supported methods:
 *   - tools/list   → returns available tools
 *   - tools/call   → executes a tool
 *
 * Available tools:
 *   - get_time       : 获取当前时间
 *   - (extensible)   : 搜索、日历、天气等
 */

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_time',
    description: '获取当前的日期和时间（服务器端时间）',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: '时区，例如 Asia/Shanghai（默认）或 UTC',
        },
      },
      required: [],
    },
  },
  // ── 后续可扩展的工具示例（暂未实现）──
  // {
  //   name: 'web_search',
  //   description: '搜索互联网获取最新信息',
  //   inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  // },
  // {
  //   name: 'get_weather',
  //   description: '获取指定城市的天气',
  //   inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
  // },
  // {
  //   name: 'calendar_today',
  //   description: '获取今日日历事项',
  //   inputSchema: { type: 'object', properties: {} }
  // },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleGetTime({ timezone = 'Asia/Shanghai' } = {}) {
  try {
    const now = new Date();
    const formatted = now.toLocaleString('zh-CN', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'long',
    });
    const ts = now.getTime();
    return { content: [{ type: 'text', text: `当前时间：${formatted}（时区：${timezone}，Unix时间戳：${ts}）` }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `获取时间失败：${e.message}` }], isError: true };
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  const { method, params = {} } = body;

  // ── tools/list ──
  if (method === 'tools/list') {
    return respond({ tools: TOOLS });
  }

  // ── tools/call ──
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;

    if (name === 'get_time') {
      return respond(handleGetTime(args));
    }

    return respond(
      { content: [{ type: 'text', text: `未知工具：${name}` }], isError: true },
      404
    );
  }

  return respond({ error: `Unknown method: ${method}` }, 400);
}
