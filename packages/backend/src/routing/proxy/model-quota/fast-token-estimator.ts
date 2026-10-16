/**
 * Extremely fast (<0.05ms) in-memory pre-flight token estimator for request payloads.
 * Evaluates input character length across all message types, tool schemas, and system prompts.
 */
export function estimatePayloadInputTokens(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  const b = body as Record<string, unknown>;
  let totalChars = 0;
  let messageCount = 0;

  // OpenAI / Anthropic / Generic messages array
  if (Array.isArray(b.messages)) {
    messageCount += b.messages.length;
    for (const msg of b.messages) {
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as Record<string, unknown>;
      const content = m.content;
      if (typeof content === 'string') {
        totalChars += content.length;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== 'object') continue;
          const p = part as Record<string, unknown>;
          if (typeof p.text === 'string') {
            totalChars += p.text.length;
          }
        }
      }
      if (typeof m.name === 'string') {
        totalChars += m.name.length;
      }
      // Tool calls arguments
      const toolCalls = m.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          if (!tc || typeof tc !== 'object') continue;
          const fn = (tc as Record<string, unknown>).function as
            Record<string, unknown> | undefined;
          if (fn) {
            if (typeof fn.name === 'string') totalChars += fn.name.length;
            if (typeof fn.arguments === 'string') totalChars += fn.arguments.length;
          }
        }
      }
    }
  }

  // Google Gemini contents array
  if (Array.isArray(b.contents)) {
    messageCount += b.contents.length;
    for (const content of b.contents) {
      if (!content || typeof content !== 'object') continue;
      const parts = (content as Record<string, unknown>).parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (!part || typeof part !== 'object') continue;
          const p = part as Record<string, unknown>;
          if (typeof p.text === 'string') {
            totalChars += p.text.length;
          }
          if (p.functionCall && typeof p.functionCall === 'object') {
            const fc = p.functionCall as Record<string, unknown>;
            if (typeof fc.name === 'string') totalChars += fc.name.length;
            if (fc.args) totalChars += JSON.stringify(fc.args).length;
          }
          if (p.functionResponse && typeof p.functionResponse === 'object') {
            const fr = p.functionResponse as Record<string, unknown>;
            if (typeof fr.name === 'string') totalChars += fr.name.length;
            if (fr.response) totalChars += JSON.stringify(fr.response).length;
          }
        }
      }
    }
  }

  // Legacy prompt format
  if (typeof b.prompt === 'string') {
    totalChars += b.prompt.length;
    messageCount += 1;
  } else if (Array.isArray(b.prompt)) {
    for (const p of b.prompt) {
      if (typeof p === 'string') {
        totalChars += p.length;
        messageCount += 1;
      }
    }
  }

  // System prompt if separate
  if (typeof b.system === 'string') {
    totalChars += b.system.length;
    messageCount += 1;
  } else if (Array.isArray(b.system)) {
    for (const s of b.system) {
      if (typeof s === 'string') totalChars += s.length;
      else if (
        s &&
        typeof s === 'object' &&
        typeof (s as Record<string, unknown>).text === 'string'
      ) {
        totalChars += ((s as Record<string, unknown>).text as string).length;
      }
    }
    messageCount += 1;
  }

  // Tools / functions schema definitions
  if (Array.isArray(b.tools)) {
    for (const tool of b.tools) {
      try {
        totalChars += JSON.stringify(tool).length;
      } catch {
        // Ignore serialization failure
      }
    }
  }
  if (Array.isArray(b.functions)) {
    for (const fn of b.functions) {
      try {
        totalChars += JSON.stringify(fn).length;
      } catch {
        // Ignore serialization failure
      }
    }
  }

  if (totalChars === 0) return 0;
  // BPE token heuristic: ~3.8 chars per token + ~4 tokens framing overhead per turn
  return Math.max(1, Math.ceil(totalChars / 3.8) + messageCount * 4);
}
