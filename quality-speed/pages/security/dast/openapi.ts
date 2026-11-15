// SPDX-License-Identifier: Apache-2.0
// The API definitions ZAP imports, so its active scanner attacks every route and not just what its spider finds.
// The room's comes from the room's own route table (web/worker/room.ts roomRoutes), read in the job, so a new route is
// scanned the day it lands. legallas-mcp's OAuth endpoints and pages are listed here, because its library owns most of
// them; its tools come from ZAP's MCP add-on (plan.ts). Path ids come from the seeded room, so a request reaches a real
// row instead of stopping at 404.

export interface RouteLike {
  method: string;
  path: string;
}

const PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/** `/api/documents/:id` to OpenAPI's `/api/documents/{id}`. */
export const openApiPath = (path: string): string => path.replace(PARAM, '{$1}');

export const pathParams = (path: string): string[] => [...path.matchAll(PARAM)].map((match) => match[1] ?? '');

/**
 * A body for each write whose handler reads named fields, from the handlers in web/worker/routes/. Any other write
 * gets `{}`, which still reaches its handler's own checks. Invented values only.
 */
export const BODY_EXAMPLES: Readonly<Record<string, Record<string, string | number | boolean>>> = {
  'POST /api/ask': { question: 'What did the board approve?' },
  'POST /api/documents/:id/comments': { body: 'A comment from the scan.', page: 1 },
  'PATCH /api/comments/:id': { body: 'An edited comment from the scan.' },
  'POST /api/documents/:id/key': { key: true },
  'PUT /api/checklist/items/:id/applies': { applies: true },
  'POST /api/hold': { case_number: '2026CV1' },
  'POST /api/hold/custodians': { email: 'custodian@example.test', name: 'A Custodian' },
  'POST /api/hold/acknowledgments': { email: 'custodian@example.test' },
  'POST /api/hold/release': { reason: 'Released by the scan.' },
};

type Json = Record<string, unknown>;

function schemaOf(example: Record<string, string | number | boolean>): Json {
  const properties: Json = {};
  for (const [name, value] of Object.entries(example)) properties[name] = { type: typeof value === 'number' ? 'integer' : typeof value, example: value };
  return { type: 'object', properties, example };
}

const WRITES = new Set(['POST', 'PUT', 'PATCH']);

/** One operation id per method and path, in letters and digits only. */
const operationId = (method: string, path: string) => `${method.toLowerCase()}${path.replace(/[^A-Za-z0-9]+/g, '_')}`;

/** Rows from the seeded room, read in the job. A kind the fixture has none of stays absent. */
export interface Seeded {
  document?: string;
  comment?: string;
  proposal?: string;
  room?: string;
}

/** The value for each parameter of one route. `:id` is a comment or proposal on those routes, a document elsewhere. */
export function paramValues(path: string, seeded: Seeded): Record<string, string> {
  const id = path.startsWith('/api/comments/') ? seeded.comment : path.startsWith('/api/proposals/') ? seeded.proposal : seeded.document;
  return { id: id ?? 'scan', n: '1', room: seeded.room ?? 'scan' };
}

/** Each seeded value back to its parameter name, for reading paths in ZAP's alerts (findings.ts normalizePath). */
export function seededNames(seeded: Seeded): Map<string, string> {
  const names = new Map<string, string>();
  for (const id of [seeded.document, seeded.comment, seeded.proposal]) if (id) names.set(id, 'id');
  if (seeded.room) names.set(seeded.room, 'room');
  return names;
}

/** A route's path with its parameters filled. */
export const fillPath = (path: string, values: Readonly<Record<string, string>>): string =>
  path.replace(PARAM, (_, name: string) => encodeURIComponent(values[name] ?? 'scan'));

/**
 * OpenAPI 3.0 for the room's routes, each parameter filled from the seeded room (paramValues). HEAD is left out: ZAP
 * sends GET for the same path.
 */
export function roomOpenApi(routes: readonly RouteLike[], seeded: Seeded): Json {
  const paths: Record<string, Json> = {};
  for (const route of routes) {
    const method = route.method.toUpperCase();
    if (method === 'HEAD') continue;
    const operation: Json = { operationId: operationId(method, route.path), responses: { default: { description: 'Any answer' } } };
    const params = pathParams(route.path);
    const values = paramValues(route.path, seeded);
    if (params.length > 0) operation.parameters = params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string', example: values[name] ?? 'scan' } }));
    if (WRITES.has(method)) {
      operation.requestBody = { required: true, content: { 'application/json': { schema: schemaOf(BODY_EXAMPLES[`${method} ${route.path}`] ?? {}) } } };
    }
    const at = openApiPath(route.path);
    paths[at] = { ...paths[at], [method.toLowerCase()]: operation };
  }
  return { openapi: '3.0.3', info: { title: 'Legallas room (fictional sample room)', version: '1' }, servers: [{ url: 'http://localhost' }], paths };
}

/** What a member's AI client sends to legallas-mcp's OAuth endpoints, with the client the harness registered. */
export interface McpValues {
  clientId: string;
  redirectUri: string;
  /** The protected resource, `<origin>/mcp`. */
  resource: string;
}

const get = (id: string, parameters: Json[] = []): Json => ({ get: { operationId: id, parameters, responses: { default: { description: 'Any answer' } } } });
const query = (name: string, example: string): Json => ({ name, in: 'query', required: true, schema: { type: 'string', example } });

/**
 * OpenAPI 3.0 for legallas-mcp's routes other than /mcp itself (web/mcp/oauth.ts route(), the library's endpoints,
 * pro's Copilot package). /mcp is imported by ZAP's MCP add-on with a member's token.
 */
export function mcpOpenApi(values: McpValues): Json {
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const register = {
    redirect_uris: [values.redirectUri],
    client_name: 'Dynamic scan client',
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
  const token = { grant_type: 'authorization_code', code: 'scan-code', redirect_uri: values.redirectUri, client_id: values.clientId, code_verifier: 'scan-verifier-scan-verifier-scan-verifier-0123' };
  const property = (value: unknown) => ({ type: Array.isArray(value) ? 'array' : 'string', ...(Array.isArray(value) ? { items: { type: 'string' } } : {}), example: value });
  const body = (type: string, example: Record<string, unknown>) => ({
    required: true,
    content: { [type]: { schema: { type: 'object', properties: Object.fromEntries(Object.entries(example).map(([k, v]) => [k, property(v)])), example } } },
  });
  return {
    openapi: '3.0.3',
    info: { title: 'Legallas MCP server: OAuth and pages (fictional sample room)', version: '1' },
    servers: [{ url: 'http://localhost' }],
    paths: {
      '/.well-known/oauth-authorization-server': get('authServerMetadata'),
      '/.well-known/oauth-protected-resource': get('resourceMetadataRoot'),
      '/.well-known/oauth-protected-resource/mcp': get('resourceMetadata'),
      '/register': { post: { operationId: 'register', requestBody: body('application/json', register), responses: { default: { description: 'Any answer' } } } },
      '/authorize': get('authorize', [
        query('response_type', 'code'),
        query('client_id', values.clientId),
        query('redirect_uri', values.redirectUri),
        query('state', 'scan-state'),
        query('code_challenge', challenge),
        query('code_challenge_method', 'S256'),
        query('resource', values.resource),
      ]),
      '/token': { post: { operationId: 'token', requestBody: body('application/x-www-form-urlencoded', token), responses: { default: { description: 'Any answer' } } } },
      '/connections': get('connections'),
      '/admin/clients': get('adminClients'),
      '/privacy': get('privacy'),
      '/terms': get('terms'),
      '/connect': get('connect'),
      '/connect/copilot-package': get('copilotPackage'),
    },
  };
}
