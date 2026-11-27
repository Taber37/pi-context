import { isDeepStrictEqual } from 'node:util';
import { measureRequest } from '../measurement/index.mjs';

const label = /^[\p{L}\p{N}_.-]{1,128}$/u;
const modes = new Set(['direct', 'deferred', 'codemode']);
const sharedToolSources = new Set(['builtin:codemode', 'builtin:tool-search']);
const intro = /^MCP servers whose tools are not declared to you\.(?: Call the tools of `codemode` servers from codemode scripts\.)?(?: Load the tools of `tool_search` servers with `tool_search`\.)?$/u;

export function evidence(pi) {
  const tools = new Map(), names = new Map(), servers = new Map();
  const active = new Set(pi.getActiveTools());
  for (const tool of pi.getAllTools()) {
    const { sourceInfo, namespace, exposure } = tool;
    let owner = sourceInfo?.source === 'builtin'
      ? (sharedToolSources.has(sourceInfo.path) || sourceInfo.path === 'builtin:mcp' ? 'shared' : 'native') : 'unknown';
    if (sourceInfo?.path === 'builtin:mcp' && namespace) {
      owner = 'unknown';
      const id = namespace.aliases?.length === 1 ? namespace.aliases[0] : null;
      if (sourceInfo.source === 'builtin' && typeof id === 'string' && label.test(id) &&
          /^mcp__[\w-]+$/u.test(namespace.name) && (servers.has(id) || servers.size < 128)) {
        owner = { server: id };
        if (!servers.has(id)) servers.set(id, new Set());
        if (modes.has(exposure)) servers.get(id).add(exposure);
        if (!names.has(namespace.name)) names.set(namespace.name, new Set());
        names.get(namespace.name).add(id);
      }
    }
    tools.set(tool.name, tools.has(tool.name) ? null : { tool, owner });
  }
  const seen = new Set(), lines = new Set();
  let declarations = true, announcements = true;
  return {
    tool(value) {
      const info = tools.get(value?.name);
      if (!info || seen.has(value.name) || !isDeepStrictEqual(value.parameters, info.tool.parameters) ||
          value.description !== info.tool.description) {
        declarations = false;
        return 'unknown';
      }
      seen.add(value.name);
      // A matched standalone extension tool is outside the built-in MCP loadout, even
      // though its origin is not native. An unknown namespaced tool could be an MCP tool.
      if (info.owner === 'unknown' && (!info.tool.sourceInfo?.path || info.tool.namespace ||
          info.tool.sourceInfo.path === 'builtin:mcp')) declarations = false;
      return info.owner;
    },
    line(line, index, all) {
      if (index === 0 && line === '<mcp_servers>' && intro.test(all[1] ?? '') && all.at(-1) === '</mcp_servers>') return 'shared';
      if (!intro.test(all[1] ?? '') || all[0] !== '<mcp_servers>' || all.at(-1) !== '</mcp_servers>') {
        announcements = false;
        return 'unknown';
      }
      if (index === 1 || index === all.length - 1) return 'shared';
      const match = /^- (mcp__[\w-]+) \((codemode|tool_search)\)(?:: .+)?$/u.exec(line);
      const ids = names.get(match?.[1]);
      if (ids?.size !== 1 || lines.has(match[1])) { announcements = false; return 'unknown'; }
      lines.add(match[1]);
      const [server] = ids;
      servers.get(server).add(match[2] === 'codemode' ? 'codemode' : 'deferred');
      return { server };
    },
    inventory({ structuredAnnouncements = false } = {}) {
      // A registered active MCP tool missing from the observed list may be hidden by a loadout or rewrite.
      for (const name of active) if (tools.get(name)?.owner?.server && !seen.has(name)) declarations = false;
      return [...servers].map(([id, modes]) => {
        const advertised = [...lines].some((name) => names.get(name).has(id));
        const canBeAbsent = !modes.has('deferred') && !modes.has('codemode');
        return { id, exposure: modes.size > 1 ? 'mixed' : [...modes][0],
          removable: { declarations, announcements: structuredAnnouncements && announcements && (advertised || canBeAbsent) } };
      });
    },
  };
}

export function measureTranscript(messages, pi, model) {
  // On resume, Pi can insert its system entry after the retained conversation.
  if (!Array.isArray(messages) || !messages.some((message) => message?.role === 'system')) return null;
  const current = new Map(), owners = {}, groupOverrides = {}, source = evidence(pi);
  let announcement;
  const transcript = messages.map((message, i) => {
    if (message.role === 'system') {
      for (const tool of message.toolsRemoved ?? []) current.delete(tool.name);
      message.toolsAdded?.forEach((tool, j) => current.set(tool.name, { tool, path: `${i}/toolsAdded/${j}` }));
      if (Object.hasOwn(message.sections ?? {}, 'mcp_servers')) announcement = { value: message.sections.mcp_servers, i };
    }
    const group = { custom: 'results', compactionSummary: 'other', branchSummary: 'other' }[message.role];
    if (!group) return message;
    const content = message.content ?? message.summary;
    (Array.isArray(content) ? content : [content]).forEach((_, j) => { groupOverrides[`${i}/content/${j}`] = group; });
    return { role: 'user', content };
  });
  for (const { tool, path } of current.values()) owners[path] = source.tool(tool);
  if (announcement?.value != null) {
    const lines = typeof announcement.value === 'string' ? announcement.value.split('\n') : [''];
    lines.forEach((line, j) => { owners[`${announcement.i}/sections/mcp_servers/${j}`] = source.line(line, j, lines); });
  }
  return measureRequest({ format: 'pi-transcript', coverage: 'full', request: { messages: transcript },
    model, owners, groupOverrides, servers: source.inventory({ structuredAnnouncements: true }) });
}
