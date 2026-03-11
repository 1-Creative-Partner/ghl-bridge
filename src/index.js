/**
 * GHL Bridge MCP Server — Cloudflare Worker
 *
 * Endpoints:
 *   GET  /health  — health check
 *   POST /mcp     — MCP JSON-RPC (Claude tool calls)
 *
 * 15 GHL tools: contacts, conversations, opportunities, workflows, calendars
 * Version: 1.0.0 | Created: 2026-03-11
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

// ── TOOL DEFINITIONS ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'ghl_search_contacts',
    description: 'Search GHL contacts by name, email, phone, or tag',
    inputSchema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Search term' },
        locationId:  { type: 'string', description: 'GHL location ID (defaults to Creative Partner)' },
        limit:       { type: 'number', description: 'Max results (default 20)' },
        tag:         { type: 'string', description: 'Filter by tag' }
      }
    }
  },
  {
    name: 'ghl_get_contact',
    description: 'Get full contact record by ID',
    inputSchema: {
      type: 'object',
      properties: {
        contactId:  { type: 'string' },
        locationId: { type: 'string' }
      },
      required: ['contactId']
    }
  },
  {
    name: 'ghl_create_contact',
    description: 'Create a new GHL contact',
    inputSchema: {
      type: 'object',
      properties: {
        locationId: { type: 'string' },
        firstName:  { type: 'string' },
        lastName:   { type: 'string' },
        email:      { type: 'string' },
        phone:      { type: 'string' },
        tags:       { type: 'array', items: { type: 'string' } },
        customFields: { type: 'object' }
      },
      required: ['firstName']
    }
  },
  {
    name: 'ghl_update_contact',
    description: 'Update an existing GHL contact',
    inputSchema: {
      type: 'object',
      properties: {
        contactId:  { type: 'string' },
        locationId: { type: 'string' },
        firstName:  { type: 'string' },
        lastName:   { type: 'string' },
        email:      { type: 'string' },
        phone:      { type: 'string' },
        tags:       { type: 'array', items: { type: 'string' } },
        customFields: { type: 'object' }
      },
      required: ['contactId']
    }
  },
  {
    name: 'ghl_add_contact_note',
    description: 'Add a note to a GHL contact',
    inputSchema: {
      type: 'object',
      properties: {
        contactId:  { type: 'string' },
        locationId: { type: 'string' },
        body:       { type: 'string' }
      },
      required: ['contactId', 'body']
    }
  },
  {
    name: 'ghl_add_contact_tags',
    description: 'Add tags to a GHL contact',
    inputSchema: {
      type: 'object',
      properties: {
        contactId:  { type: 'string' },
        locationId: { type: 'string' },
        tags:       { type: 'array', items: { type: 'string' } }
      },
      required: ['contactId', 'tags']
    }
  },
  {
    name: 'ghl_get_conversations',
    description: 'Get conversations for a contact or location',
    inputSchema: {
      type: 'object',
      properties: {
        locationId:  { type: 'string' },
        contactId:   { type: 'string' },
        status:      { type: 'string', enum: ['open', 'closed', 'all'] },
        limit:       { type: 'number' }
      }
    }
  },
  {
    name: 'ghl_send_message',
    description: 'Send SMS, email, or WhatsApp message via GHL',
    inputSchema: {
      type: 'object',
      properties: {
        locationId:     { type: 'string' },
        contactId:      { type: 'string' },
        type:           { type: 'string', enum: ['SMS', 'Email', 'WhatsApp'] },
        message:        { type: 'string' },
        subject:        { type: 'string' },
        emailFrom:      { type: 'string' },
        emailTo:        { type: 'string' }
      },
      required: ['contactId', 'type', 'message']
    }
  },
  {
    name: 'ghl_search_opportunities',
    description: 'Search pipeline opportunities',
    inputSchema: {
      type: 'object',
      properties: {
        locationId:  { type: 'string' },
        query:       { type: 'string' },
        pipelineId:  { type: 'string' },
        status:      { type: 'string', enum: ['open', 'won', 'lost', 'abandoned', 'all'] },
        limit:       { type: 'number' }
      }
    }
  },
  {
    name: 'ghl_create_opportunity',
    description: 'Create a pipeline opportunity',
    inputSchema: {
      type: 'object',
      properties: {
        locationId:      { type: 'string' },
        pipelineId:      { type: 'string' },
        pipelineStageId: { type: 'string' },
        contactId:       { type: 'string' },
        name:            { type: 'string' },
        monetaryValue:   { type: 'number' },
        status:          { type: 'string' }
      },
      required: ['pipelineId', 'contactId', 'name']
    }
  },
  {
    name: 'ghl_update_opportunity',
    description: 'Update opportunity stage or status',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityId:   { type: 'string' },
        locationId:      { type: 'string' },
        pipelineStageId: { type: 'string' },
        status:          { type: 'string', enum: ['open', 'won', 'lost', 'abandoned'] },
        monetaryValue:   { type: 'number' }
      },
      required: ['opportunityId']
    }
  },
  {
    name: 'ghl_get_workflows',
    description: 'List all GHL automation workflows',
    inputSchema: {
      type: 'object',
      properties: { locationId: { type: 'string' } }
    }
  },
  {
    name: 'ghl_add_contact_to_workflow',
    description: 'Enroll a contact in a GHL workflow',
    inputSchema: {
      type: 'object',
      properties: {
        contactId:  { type: 'string' },
        workflowId: { type: 'string' },
        locationId: { type: 'string' }
      },
      required: ['contactId', 'workflowId']
    }
  },
  {
    name: 'ghl_get_calendars',
    description: 'List all GHL calendars',
    inputSchema: {
      type: 'object',
      properties: { locationId: { type: 'string' } }
    }
  },
  {
    name: 'ghl_get_appointments',
    description: 'Get appointments for a calendar or contact',
    inputSchema: {
      type: 'object',
      properties: {
        locationId:  { type: 'string' },
        calendarId:  { type: 'string' },
        contactId:   { type: 'string' },
        startTime:   { type: 'string' },
        endTime:     { type: 'string' }
      }
    }
  }
];

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getPIT(env, locationId) {
  if (!locationId || locationId === env.GHL_CP_LOCATION_ID) return env.GHL_CP_PIT;
  if (locationId === env.GHL_JUMPSTART_LOC_ID) return env.GHL_JUMPSTART_PIT;
  if (locationId === env.GHL_BAILEY_LOC_ID) return env.GHL_BAILEY_PIT;
  return env.GHL_AGENCY_PIT;
}

async function ghlRequest(env, method, path, locationId, body) {
  const token = getPIT(env, locationId);
  const res = await fetch(`${GHL_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Version':       '2021-07-28'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GHL ${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// ── TOOL EXECUTOR ─────────────────────────────────────────────────────────────
async function executeTool(name, args, env) {
  const loc = args.locationId || env.GHL_CP_LOCATION_ID;

  switch (name) {
    case 'ghl_search_contacts': {
      const params = new URLSearchParams({ locationId: loc, limit: args.limit || 20 });
      if (args.query) params.set('query', args.query);
      if (args.tag)   params.set('tags', args.tag);
      return ghlRequest(env, 'GET', `/contacts/?${params}`, loc);
    }
    case 'ghl_get_contact':
      return ghlRequest(env, 'GET', `/contacts/${args.contactId}`, loc);
    case 'ghl_create_contact':
      return ghlRequest(env, 'POST', '/contacts/', loc, { ...args, locationId: loc });
    case 'ghl_update_contact':
      return ghlRequest(env, 'PUT', `/contacts/${args.contactId}`, loc, args);
    case 'ghl_add_contact_note':
      return ghlRequest(env, 'POST', `/contacts/${args.contactId}/notes`, loc, { body: args.body, userId: '' });
    case 'ghl_add_contact_tags':
      return ghlRequest(env, 'POST', `/contacts/${args.contactId}/tags`, loc, { tags: args.tags });
    case 'ghl_get_conversations': {
      const p = new URLSearchParams({ locationId: loc });
      if (args.contactId) p.set('contactId', args.contactId);
      if (args.status && args.status !== 'all') p.set('status', args.status);
      if (args.limit) p.set('limit', args.limit);
      return ghlRequest(env, 'GET', `/conversations/?${p}`, loc);
    }
    case 'ghl_send_message':
      return ghlRequest(env, 'POST', '/conversations/messages', loc, args);
    case 'ghl_search_opportunities': {
      const p = new URLSearchParams({ location_id: loc });
      if (args.query)      p.set('q', args.query);
      if (args.pipelineId) p.set('pipeline_id', args.pipelineId);
      if (args.status && args.status !== 'all') p.set('status', args.status);
      if (args.limit)      p.set('limit', args.limit);
      return ghlRequest(env, 'GET', `/opportunities/search?${p}`, loc);
    }
    case 'ghl_create_opportunity':
      return ghlRequest(env, 'POST', '/opportunities/', loc, args);
    case 'ghl_update_opportunity':
      return ghlRequest(env, 'PUT', `/opportunities/${args.opportunityId}`, loc, args);
    case 'ghl_get_workflows':
      return ghlRequest(env, 'GET', `/workflows/?locationId=${loc}`, loc);
    case 'ghl_add_contact_to_workflow':
      return ghlRequest(env, 'POST', `/contacts/${args.contactId}/workflow/${args.workflowId}`, loc, { eventStartTime: new Date().toISOString() });
    case 'ghl_get_calendars':
      return ghlRequest(env, 'GET', `/calendars/?locationId=${loc}`, loc);
    case 'ghl_get_appointments': {
      const p = new URLSearchParams({ locationId: loc });
      if (args.calendarId) p.set('calendarId', args.calendarId);
      if (args.contactId)  p.set('contactId', args.contactId);
      if (args.startTime)  p.set('startTime', args.startTime);
      if (args.endTime)    p.set('endTime', args.endTime);
      return ghlRequest(env, 'GET', `/calendars/events?${p}`, loc);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP JSON-RPC HANDLER ──────────────────────────────────────────────────────
async function handleMCP(req, env) {
  const body = await req.json();
  const { id, method, params } = body;

  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ghl-bridge', version: '1.0.0' }
    }};
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const result = await executeTool(name, args || {}, env);
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      };
    } catch (err) {
      return {
        jsonrpc: '2.0', id,
        error: { code: -32603, message: err.message }
      };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ── MAIN FETCH HANDLER ────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'ghl-bridge',
        version: '1.0.0',
        tools: TOOLS.length,
        timestamp: new Date().toISOString()
      }), { headers: CORS });
    }

    if (url.pathname === '/mcp' && req.method === 'POST') {
      const result = await handleMCP(req, env);
      return new Response(JSON.stringify(result), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS });
  }
};
