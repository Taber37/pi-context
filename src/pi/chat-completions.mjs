import { measureRequest } from '../measurement/index.mjs';
import { evidence } from './attribution.mjs';

// Pi 1.6.1's openai-completions adapter builds a stateless {model,messages,tools?,stream}
// body. This decoder handles the flat tool layout, not the mid-conversation tool-patch dialect.
export function measureChat(payload, pi, model) {
  if (!model || payload?.model !== model || payload.stream !== true || !Array.isArray(payload.messages) ||
      (payload.tools !== undefined && !Array.isArray(payload.tools)) || Object.hasOwn(payload, 'previous_response_id') ||
      payload.messages.some((message) => !message || Object.hasOwn(message, 'tools') ||
        (message.tool_calls != null && !Array.isArray(message.tool_calls)) ||
        !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)) ||
      payload.messages.filter(({ role }) => role === 'system' || role === 'developer').length > 1) return null;
  const source = evidence(pi), request = [];
  const add = (group, kind, value) => request.push({ group, kind, value });
  for (const message of payload.messages) {
    const system = ['system', 'developer'].includes(message.role);
    const group = system ? 'system' : message.role === 'tool' ? 'results' : 'conversation';
    const parts = Array.isArray(message.content) ? message.content : [message.content];
    for (const part of parts) {
      const text = typeof part === 'string' ? part : part?.type === 'text' ? part.text : null;
      // Pi folds named sections into prompt text. The provider body has no provenance
      // for those spans, so neither matching text nor its length attests an announcement.
      if (typeof text === 'string') add(group, 'text', text);
      else if (part?.type === 'image_url') add('other', 'media');
      else if (part != null) add('other', 'unknown');
    }
    for (const call of message.tool_calls ?? []) add('conversation', 'json', call);
    for (const key of Object.keys(message)) {
      if (!['role', 'content', 'tool_calls', 'tool_call_id'].includes(key) && message[key] != null) add('other', 'unknown');
    }
  }
  for (const tool of payload.tools ?? []) {
    request.push({ part: 'declaration', phase: 'effective', kind: 'json', value: tool,
      owner: source.tool(tool?.type === 'function' ? tool.function : undefined) });
  }
  return measureRequest({ format: 'fragments', coverage: 'full', model, request, servers: source.inventory() });
}

export function reportedChatInput(data) {
  const total = data?.usage?.prompt_tokens;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}
