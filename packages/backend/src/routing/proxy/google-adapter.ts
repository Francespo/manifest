/**
 * Converts between OpenAI chat completion format and Google Gemini format.
 * Only used when the resolved provider is Google; all other providers
 * accept the OpenAI format directly.
 */

import { randomUUID } from 'crypto';

import { OpenAIMessage, SignatureLookup } from './proxy-types';

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  // Google attaches thoughtSignature at the Part level (sibling of functionCall),
  // not inside the functionCall object. Gemini 3 rejects tool-use follow-ups
  // that don't round-trip this field.
  thoughtSignature?: string;
}

/**
 * JSON Schema fields not supported by the Gemini API.
 * These must be stripped recursively before sending tool parameters.
 */
const UNSUPPORTED_SCHEMA_FIELDS = new Set([
  'patternProperties',
  'additionalProperties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'dependentRequired',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contentMediaType',
  'contentEncoding',
  'examples',
  'default',
  'const',
  'title',
]);

function sanitizeSchema(schema: unknown, isPropertiesMap = false): unknown {
  if (schema === null || schema === undefined || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeSchema(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    // Inside a `properties` map, keys are user-defined property names
    // (e.g. "title", "default"), not JSON Schema keywords — keep them all.
    // Their values are sub-schemas, so recurse normally (not as properties map).
    if (!isPropertiesMap && UNSUPPORTED_SCHEMA_FIELDS.has(key)) continue;
    result[key] = sanitizeSchema(value, key === 'properties');
  }
  return result;
}

function safeParseArgs(args: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(args || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/* ── Request conversion ── */

function mapRole(role: string): string {
  if (role === 'assistant') return 'model';
  if (role === 'system') return 'user'; // Gemini treats system as user
  return 'user';
}

function messageToContent(
  msg: OpenAIMessage,
  signatureLookup?: SignatureLookup,
): GeminiContent | null {
  const parts: GeminiPart[] = [];

  if (typeof msg.content === 'string') {
    parts.push({ text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push({ text: block.text });
      }
    }
  }

  // Handle tool calls from assistant
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      const functionCall: GeminiPart['functionCall'] = {
        name: tc.function.name,
        args: safeParseArgs(tc.function.arguments),
      };
      const part: GeminiPart = { functionCall };
      // Preserve thought_signature from the client (if it echoed it back), or
      // re-inject it from the cache. On the Google wire, the field lives at
      // the Part level as `thoughtSignature`, not inside functionCall.
      const echoed = (tc as Record<string, unknown>).thought_signature;
      const cached = signatureLookup ? signatureLookup(tc.id) : null;
      const signature = typeof echoed === 'string' ? echoed : cached;
      if (signature) part.thoughtSignature = signature;
      parts.push(part);
    }
  }

  // Handle tool response
  if (msg.role === 'tool' && typeof msg.content === 'string') {
    return {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: (msg.tool_call_id as string) || 'unknown',
            response: { result: msg.content },
          },
        },
      ],
    };
  }

  if (parts.length === 0) return null;
  return { role: mapRole(msg.role), parts };
}

function convertTools(tools?: Record<string, unknown>[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const declarations = tools
    .map((t) => {
      const fn = t.function as
        | { name: string; description?: string; parameters?: unknown }
        | undefined;
      if (!fn) return null;
      return {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters ? sanitizeSchema(fn.parameters) : undefined,
      };
    })
    .filter(Boolean);

  if (declarations.length === 0) return undefined;
  return [{ functionDeclarations: declarations }];
}

/** Extracted thought_signature entries from a Gemini response. */
export interface ExtractedSignature {
  toolCallId: string;
  signature: string;
}

export function toGoogleRequest(
  body: Record<string, unknown>,
  _model: string,
  signatureLookup?: SignatureLookup,
): Record<string, unknown> {
  const messages = (body.messages as OpenAIMessage[]) || [];
  const contents: GeminiContent[] = [];

  // Extract system instruction
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const systemText = systemMsgs
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)
    .join('\n');

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const content = messageToContent(msg, signatureLookup);
    if (content) contents.push(content);
  }

  const result: Record<string, unknown> = { contents };

  if (systemText) {
    result.systemInstruction = {
      parts: [{ text: systemText }],
    };
  }

  const tools = convertTools(body.tools as Record<string, unknown>[] | undefined);
  if (tools) result.tools = tools;

  // Map generation config
  const genConfig: Record<string, unknown> = {};
  if (body.max_tokens !== undefined) genConfig.maxOutputTokens = body.max_tokens;
  if (body.temperature !== undefined) genConfig.temperature = body.temperature;
  if (body.top_p !== undefined) genConfig.topP = body.top_p;
  if (Object.keys(genConfig).length > 0) result.generationConfig = genConfig;

  return result;
}

/* ── Response conversion ── */

export function fromGoogleResponse(
  googleResp: Record<string, unknown>,
  model: string,
): Record<string, unknown> & { _extractedSignatures?: ExtractedSignature[] } {
  const candidates = (googleResp.candidates as Array<Record<string, unknown>>) || [];
  const candidate = candidates[0];

  if (!candidate) {
    return {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [],
    };
  }

  const content = candidate.content as { parts?: Array<Record<string, unknown>> } | undefined;
  const parts = content?.parts || [];

  let textContent = '';
  const toolCalls: Record<string, unknown>[] = [];
  const extractedSignatures: ExtractedSignature[] = [];

  for (const part of parts) {
    // Thinking summaries come back as text parts with `thought: true`. Skip
    // them — the OpenAI-compat surface doesn't expose them, and including
    // them in `content` would leak chain-of-thought into the assistant reply.
    if (part.text && !part.thought) textContent += part.text;
    if (part.functionCall) {
      const fc = part.functionCall as { name: string; args: Record<string, unknown> };
      const toolCallId = `call_${randomUUID()}`;
      const toolCall: Record<string, unknown> = {
        id: toolCallId,
        type: 'function',
        function: { name: fc.name, arguments: JSON.stringify(fc.args) },
      };
      const sig = part.thoughtSignature;
      if (typeof sig === 'string' && sig) {
        toolCall.thought_signature = sig;
        extractedSignatures.push({ toolCallId, signature: sig });
      }
      toolCalls.push(toolCall);
    }
  }

  const message: Record<string, unknown> = { role: 'assistant', content: textContent || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const usage = googleResp.usageMetadata as Record<string, number> | undefined;

  return {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message, finish_reason: mapFinishReason(candidate, toolCalls.length > 0) },
    ],
    usage: usage
      ? {
          prompt_tokens: usage.promptTokenCount ?? 0,
          completion_tokens: usage.candidatesTokenCount ?? 0,
          total_tokens: usage.totalTokenCount ?? 0,
          prompt_tokens_details: { cached_tokens: usage.cachedContentTokenCount ?? 0 },
          cache_read_tokens: usage.cachedContentTokenCount ?? 0,
          cache_creation_tokens: 0,
        }
      : undefined,
    ...(extractedSignatures.length > 0 ? { _extractedSignatures: extractedSignatures } : {}),
  };
}

function mapFinishReason(candidate: Record<string, unknown>, hasToolCalls = false): string {
  const reason = candidate.finishReason as string | undefined;
  if (!reason || reason === 'STOP') {
    return hasToolCalls ? 'tool_calls' : 'stop';
  }
  const map: Record<string, string> = {
    MAX_TOKENS: 'length',
    SAFETY: 'content_filter',
    RECITATION: 'content_filter',
  };
  return map[reason] ?? 'stop';
}

/* ── Stream chunk conversion ── */

/**
 * Result of transforming one Google SSE chunk. `chunk` is the OpenAI-formatted
 * SSE text to forward to the client (null when the input chunk produced no
 * output). `signatures` lists any thoughtSignature values extracted from
 * functionCall parts in this chunk, which the caller should cache so they can
 * be re-injected on the next turn (Gemini 3 requires this).
 */
export interface GoogleStreamChunkResult {
  chunk: string | null;
  signatures: ExtractedSignature[];
}

export function transformGoogleStreamChunk(
  chunk: string,
  model: string,
): GoogleStreamChunkResult {
  const empty: GoogleStreamChunkResult = { chunk: null, signatures: [] };
  if (!chunk.trim()) return empty;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(chunk);
  } catch {
    return empty;
  }

  const candidates = (data.candidates as Array<Record<string, unknown>>) || [];
  const candidate = candidates[0];
  const content = candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined;
  const parts = content?.parts || [];
  const text = parts
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('');

  const toolCalls: Record<string, unknown>[] = [];
  const signatures: ExtractedSignature[] = [];
  for (const part of parts) {
    if (part.functionCall) {
      const fc = part.functionCall as { name: string; args?: Record<string, unknown> };
      const toolCallId = `call_${randomUUID()}`;
      const toolCall: Record<string, unknown> = {
        index: toolCalls.length,
        id: toolCallId,
        type: 'function',
        function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) },
      };
      const sig = part.thoughtSignature;
      if (typeof sig === 'string' && sig) {
        toolCall.thought_signature = sig;
        signatures.push({ toolCallId, signature: sig });
      }
      toolCalls.push(toolCall);
    }
  }

  let result = '';

  if (text || toolCalls.length > 0) {
    const delta: Record<string, unknown> = {};
    if (text) delta.content = text;
    if (toolCalls.length > 0) delta.tool_calls = toolCalls;
    result += `data: ${JSON.stringify({
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`;
  }

  const usage = data.usageMetadata as Record<string, number> | undefined;
  if (usage) {
    const finishReason = mapFinishReason(candidate ?? {}, toolCalls.length > 0);
    result += `data: ${JSON.stringify({
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    })}\n\n`;
    result += `data: ${JSON.stringify({
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [],
      usage: {
        prompt_tokens: usage.promptTokenCount ?? 0,
        completion_tokens: usage.candidatesTokenCount ?? 0,
        total_tokens: usage.totalTokenCount ?? 0,
        prompt_tokens_details: { cached_tokens: usage.cachedContentTokenCount ?? 0 },
        cache_read_tokens: usage.cachedContentTokenCount ?? 0,
        cache_creation_tokens: 0,
      },
    })}\n\n`;
  }

  return { chunk: result || null, signatures };
}
