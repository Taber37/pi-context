const categoryLabels = [
  ['system', 'System'], ['declarations', 'Declarations and announcements', 'Decls + announcements'],
  ['conversation', 'Conversation'], ['results', 'Results and injections'], ['other', 'Other'],
];
const originLabels = [['native', 'Native'], ['shared', 'Shared'], ['unknown', 'Unknown origin']];
const integers = new Intl.NumberFormat('en-US');
const percentages = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const number = (value) => isCount(value) ? integers.format(value) : 'unknown';
const units = (value, unit) => `${number(value)} ${unit}${value === 1 ? '' : 's'}`;
const approx = (value) => isCount(value) ? `~${units(value, 'token')}` : 'unknown';

// Escape instead of stripping so IDs differing only by a hidden character stay distinct.
// Printable ASCII also gives the renderer a dependency-free, one-character/one-cell budget.
function safeLabel(value, fallback = 'unknown') {
  return typeof value === 'string' && value.trim()
    ? value.replace(/\\|[^\x20-\x7E]/gu, (char) => `\\u{${char.codePointAt(0).toString(16)}}`).trim()
    : fallback;
}

function wrap(lines, text, width) {
  while (text.length > width) {
    const space = text.lastIndexOf(' ', width);
    const end = space > 0 && text.slice(0, space).trim() ? space : width;
    const line = text.slice(0, end).trimEnd();
    if (line) lines.push(line);
    text = text.slice(end).trimStart();
  }
  if (text) lines.push(text);
}

function renderProjection(add, width, projected) {
  const { tokens, contextWindow, percent } = projected ?? {};
  const hasPercent = Number.isFinite(percent) && percent >= 0;
  const percentage = !hasPercent ? 'unknown' : percent > 0 && percent < 0.01 ? '<0.01%' : `${percentages.format(percent)}%`;
  add(`Projected: ${number(tokens)} / ${number(contextWindow)} tokens (${percentage})`);
  const known = isCount(tokens) && isCount(contextWindow) && contextWindow > 0;
  if (!known) {
    add('Free: unknown');
    return;
  }
  const free = `Free: ${units(Math.max(0, contextWindow - tokens), 'token')}`;
  add(tokens > contextWindow ? `${free}; over window by ${units(tokens - contextWindow, 'token')}` : free);
  if (width < 24) return;
  const columns = 20;
  const cells = 2 * columns;
  const occupied = tokens === 0 ? 0 : tokens >= contextWindow ? cells :
    Math.min(cells - 1, Math.max(1, Math.round(cells * (tokens / contextWindow))));
  const grid = '#'.repeat(occupied) + '.'.repeat(cells - occupied);
  add(grid.slice(0, columns));
  add(grid.slice(columns));
  add('# occupied  . free');
}

const partial = (row) => row?.mediaCount > 0 || row?.unknownBlocks > 0;
function renderEstimate(add, width, label, row, detail) {
  const tokens = row?.estimatedTokens == null ? 'unknown tokens' : approx(row.estimatedTokens);
  const prefix = width >= 60 ? `${label.padEnd(32)}  ` : `${label}: `;
  add(`${prefix}${tokens}; ${units(row?.textBytes, 'text byte')}`);
  if (detail && partial(row)) {
    add(`  ${units(row.mediaCount, 'media item')}; ${units(row.knownMediaBytes, 'known media byte')}; ` +
      `${units(row.unknownMediaSizes, 'unknown media size')}; ${units(row.unknownBlocks, 'opaque block')}`);
  }
}

function savingsBytes(server) {
  const savings = server.savings;
  return savings?.status === 'conditional-next-full-request' && isCount(savings.declarationBytes) &&
    isCount(savings.announcementBytes) ? savings.declarationBytes + savings.announcementBytes : -1;
}

function renderServers(add, width, servers, observed, detail) {
  add('MCP servers');
  if (!servers?.length) {
    add('No server rows in this observation.');
    return;
  }
  add('Conditional savings if disabled on next full request');
  add('Retained = attributed history only; 0 does not rule out earlier results.');
  const ranked = [...servers].sort((a, b) => savingsBytes(b) - savingsBytes(a));
  const data = ranked.map((server) => {
    const decl = observed ? server.declarations : null;
    const retained = observed ? server.history : null;
    const cell = (row) => number(row?.textBytes) + (partial(row) ? '*' : '');
    return { server, id: safeLabel(server.id), exposure: safeLabel(server.exposure), decl, retained,
      cells: [cell(decl), cell(retained), savingsBytes(server) >= 0 ? approx(server.savings.estimatedTokens) : 'unknown'] };
  });
  const headings = ['Current decl.', 'Retained', 'Savings'];
  const widths = headings.map((label, i) => data.reduce((max, row) => Math.max(max, row.cells[i].length), label.length));
  const available = width - 16 - widths.reduce((sum, n) => sum + n, 0);
  const preferred = data.reduce((max, entry) => Math.max(max, entry.id.length), 12);
  const idWidth = Math.min(preferred, 36, available);
  const table = width >= 76 && idWidth >= 12;
  if (table) {
    add('Declarations and history in text bytes; * = known subtotal');
    const row = (id, exposure, cells) => add([id.padEnd(idWidth), exposure.padEnd(8),
      cells[0].padStart(widths[0]), cells[1].padStart(widths[1]), cells[2]].join('  '));
    row('Server', 'Exposure', headings);
    for (const entry of data) {
      const id = entry.id.length > idWidth ? `${entry.id.slice(0, idWidth - 3)}...` : entry.id;
      row(id, entry.exposure, entry.cells);
    }
  } else {
    const value = (row) => row == null ? 'unknown' : units(row.textBytes, 'text byte') + (partial(row) ? ' (known subtotal)' : '');
    for (const entry of data) {
      add(`${entry.id} (${entry.exposure})`);
      add(`  Current declarations: ${value(entry.decl)}`);
      add(`  Retained history: ${value(entry.retained)}`);
      add(`  Savings: ${entry.cells[2]}`);
    }
  }
  if (!detail || !observed) return;
  add('Server detail (alternate origin view)');
  for (const { id, server } of data) {
    add(`${id}:`);
    renderEstimate(add, width, '  Observed attribution', server.observed, true);
    renderEstimate(add, width, '  Current announcements', server.announcements, true);
    const component = (value) => isCount(value) ? units(value, 'byte') : 'unknown';
    add(`  Conditional components: declarations ${component(server.savings?.declarationBytes)}; ` +
      `announcements ${component(server.savings?.announcementBytes)}`);
  }
}

function renderReconciliation(add, reconciliation) {
  const input = reconciliation?.inputTokens;
  add(`Matched provider input: ${units(input, 'token')}${isCount(input) ? ' (cache-inclusive)' : ''}`);
  const discrepancy = reconciliation?.discrepancy;
  const signed = Number.isSafeInteger(discrepancy) ? `${discrepancy > 0 ? '+' : ''}${integers.format(discrepancy)} tokens` : 'unknown';
  add(`Discrepancy (provider minus estimate): ${signed}`);
}

const dashboardCategories = [
  ['System', 'mdCode'], ['Declarations + ads', 'mdLink'], ['Conversation', 'mdCodeBlock'],
  ['Results + injections', 'mdHeading'], ['Other', 'toolDiffRemoved'],
];
const scaled = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const asK = (n) => `${n < 100 ? n / 1_000 : scaled.format(n / 1_000)}k`;
const shortCount = (n) => !isCount(n) ? 'unknown' : n >= 1_000_000 ? `${scaled.format(n / 1_000_000)}m` :
  n >= 1_000 ? asK(n) : number(n);
const clip = (text, width) => text.length > width ? `${text.slice(0, width - 1)}…` : text;
const ofWindow = (n, window) => {
  if (!isCount(n) || !isCount(window) || window === 0) return 'unknown';
  const percent = n / window * 100;
  if (n > 0 && percent < 0.01) return '<0.01%';
  if (n < window && percent >= 99.995) return '<100%';
  if (n > window && percent < 100.005) return '>100%';
  return `${percentages.format(percent)}%`;
};

function inventoryLine(snapshot, width) {
  if (!snapshot) return 'MCP inventory unavailable';
  const servers = snapshot.servers ?? [];
  const prefix = `${servers.length} MCP server${servers.length === 1 ? '' : 's'}`;
  let best, unavailable = 0;
  for (const server of servers) {
    if (savingsBytes(server) < 0 || !isCount(server.savings.estimatedTokens)) unavailable++;
    else if (!best || savingsBytes(server) > savingsBytes(best)) best = server;
  }
  if (!best) return `${prefix} ${servers.length ? '· Savings unavailable' : 'observed'}`;
  const label = clip(safeLabel(best.id), Math.max(1, Math.min(24, width - 8)));
  const unknown = unavailable ? ` · ${unavailable} unavailable` : '';
  return `${prefix} · Best saving if disabled: ${label} ${approx(best.savings.estimatedTokens)}${unknown}`;
}

function renderDashboardDetail({ snapshot, ageMs, reconciliation }, width, theme, observed) {
  const lines = [];
  const add = (value, style = (line) => line) => {
    const parts = [];
    wrap(parts, value, width);
    lines.push(...parts.map(style));
  };
  const muted = (text) => theme.fg('muted', text);
  const section = (title) => { lines.push(''); add(title, theme.bold.bind(theme)); };
  const tokens = (row) => isCount(row?.estimatedTokens) ? `~${number(row.estimatedTokens)}` : 'unknown';
  const bytes = (row) => number(row?.textBytes) + (partial(row) ? '*' : '');
  const media = (row) => [units(row.mediaCount, 'media item'), units(row.knownMediaBytes, 'known media byte'),
    units(row.unknownMediaSizes, 'unknown media size'), units(row.unknownBlocks, 'opaque block')].join(' · ');
  const table = (headings, rows, textColumns, stacked, after = () => {}) => {
    const widths = headings.map((label, i) => rows.reduce((max, cells) => Math.max(max, cells[i].length), label.length));
    const fits = widths.reduce((sum, value) => sum + value, 2 * (widths.length - 1)) <= width;
    const row = (cells, header) => {
      const aligned = cells.map((cell, i) => i < textColumns ? cell.padEnd(widths[i]) : cell.padStart(widths[i]));
      if (header) lines.push(muted(aligned.join('  ')));
      else lines.push([theme.bold(aligned[0]), ...aligned.slice(1)].join('  '));
    };
    if (fits) row(headings, true);
    rows.forEach((cells, i) => {
      if (fits) row(cells, false);
      else stacked(cells);
      after(i);
    });
  };

  const servers = [...(snapshot?.servers ?? [])];
  if (observed) servers.sort((a, b) => (b.observed?.textBytes ?? -1) - (a.observed?.textBytes ?? -1));
  if (servers.length) {
    section('Current footprint by MCP');
    add('Observed attribution only · 0 retained does not rule out earlier results.', muted);
    const scopes = [['observed', 'Total'], ['declarations', 'Declarations'], ['announcements', 'Ads'], ['history', 'Retained']];
    const rows = servers.map((server) => observed ? scopes.map(([key]) => server[key]) : []);
    if (rows.some((cells) => cells.some(partial))) add('* Text subtotal; media and opaque blocks are separate.', muted);
    add('Ads = advertisements. All byte columns are UTF-8 text.', muted);
    const names = servers.map(({ id }) => safeLabel(id));
    table(['MCP', 'Exposure', 'Est. tokens', 'Total B', 'Decl B', 'Ads B', 'Retained B'],
      servers.map(({ exposure }, i) => [names[i], safeLabel(exposure), tokens(rows[i][0]),
        ...scopes.map((_, j) => bytes(rows[i][j]))]), 2,
      ([id, exposure, totalTokens, total, decl, ads, retained]) => {
        add(`${id} · ${exposure}`, theme.bold.bind(theme));
        add(`  Total: ${totalTokens === 'unknown' ? 'unknown tokens' : `${totalTokens} tokens`} · ${total} B`);
        add(`  Decl ${decl} · Ads ${ads} · Retained ${retained} B`, muted);
      }, (i) => rows[i].forEach((part, j) => {
        if (partial(part)) add(`  ${scopes[j][1]}: ${media(part)}`, muted);
      }));

    section('If disabled · next full request');
    add('Disabling does not delete past calls or results. Compaction can change the retained history later.', muted);
    table(['MCP', 'Est. tokens saved', 'Removable decl B', 'Removable ads B'], servers.map(({ savings }, i) => [
      names[i], observed && savingsBytes(servers[i]) >= 0 ? tokens(savings) : 'unknown',
      number(observed ? savings?.declarationBytes : null), number(observed ? savings?.announcementBytes : null),
    ]), 1, ([id, total, decl, ads]) => {
      add(`${id} · ${total === 'unknown' ? 'unknown savings' : `${total} tokens saved`}`, theme.bold.bind(theme));
      add(`  Removable B: Decl ${decl} · Ads ${ads}`, muted);
    });
  } else if (snapshot) {
    section('Current footprint by MCP');
    add(observed ? 'No server rows in this observation.' : 'MCP attribution unavailable.', muted);
  }

  section('Observation detail');
  const age = isCount(ageMs) ? `${number(ageMs)} ms` : 'unknown';
  if (snapshot) add(observed ? `${snapshot.observation.format} / ${safeLabel(snapshot.observation.coverage)} · age ${age}` :
    `Observation unavailable · age ${age}`, muted);
  if (observed) {
    add(`Method: ${safeLabel(snapshot.estimation?.method)}`);
    add(`Measurement model: ${safeLabel(snapshot.estimation?.model)}`);
    const estimate = (row) => `${tokens(row)} tokens · ${number(row?.textBytes)} text bytes`;
    add(`Observed total: ${estimate(snapshot.observed)}`);
    add('Groups · exact text bytes and token estimates', muted);
    const evidenceRow = (label, row) => {
      add(`  ${label}: ${estimate(row)}`);
      if (partial(row)) add(`  ${media(row)}`, muted);
    };
    categoryLabels.forEach(([key], i) => evidenceRow(dashboardCategories[i][0], snapshot.groups?.[key]));
    add('Origins · alternate view, not additional input (see MCP footprints above)', muted);
    originLabels.forEach(([key, label]) => evidenceRow(label, snapshot.origins?.[key]));
  }
  renderReconciliation(add, reconciliation);
  return lines;
}

function renderDashboard(report, width, theme, detail) {
  const { snapshot, model, projected, staleReason } = report;
  const { tokens, contextWindow: window } = projected ?? {};
  const known = isCount(tokens) && isCount(window) && window > 0;
  const observed = ['fragments', 'pi-transcript'].includes(snapshot?.observation?.format);
  const estimates = categoryLabels.map(([key]) => snapshot?.groups?.[key]?.estimatedTokens);
  // Paint estimates against window capacity, never rescale them to fill occupancy.
  // Leave the remainder neutral; inconsistent, partial-request or stale observations get no bands.
  const subtotal = estimates.reduce((sum, estimate) => sum + (isCount(estimate) ? estimate : 0), 0);
  const bandsFit = known && tokens > 0 && tokens <= window && !staleReason && observed &&
    snapshot.observation.coverage === 'full' && subtotal > 0 && subtotal <= tokens;
  const mix = bandsFit && estimates.every(isCount) && subtotal === tokens;
  const columns = width < 12 || !known ? 0 : Math.min(20, Math.floor((width + 1) / 2));
  const sideBySide = columns === 20 && width >= 78;
  const paneWidth = sideBySide ? width - 42 : width;
  const text = (value) => value;
  const muted = (value) => theme.fg('muted', value);
  const accent = (value) => theme.fg('accent', value);
  function add(lines, value, budget, style = text, swatch = '') {
    const parts = [];
    const inset = swatch && budget >= 3 ? 2 : 0;
    wrap(parts, value, budget - inset);
    parts.forEach((part, i) => lines.push((inset ? (i === 0 ? `${swatch} ` : '  ') : '') + style(part)));
  }

  const title = [], summary = [], legend = [], grid = [], footer = [];
  add(title, detail ? 'Context usage · Details' : 'Context usage', width, (value) => theme.bold(accent(value)));
  if (detail) add(title, 'Current context', width, (value) => theme.bold(value));
  summary.push(theme.bold(clip(safeLabel(model, 'unknown model'), paneWidth)));
  const exact = known && tokens !== window && shortCount(tokens) === shortCount(window);
  const formatCount = exact ? number : shortCount;
  add(summary, `${formatCount(tokens)} / ${formatCount(window)} tokens (${ofWindow(tokens, window)})`, paneWidth);

  const free = theme.fg('dim', '·'), occupied = theme.fg('muted', '■');
  const swatches = dashboardCategories.map(([, role]) => theme.fg(role, '■'));
  if (columns) {
    const cells = 10 * columns;
    const used = tokens === 0 ? 0 : tokens >= window ? cells :
      Math.min(cells - 1, Math.max(1, Math.round(cells * (tokens / window))));
    let cumulative = 0;
    const bands = bandsFit ? estimates.map((count) => Math.round(cells * ((cumulative += isCount(count) ? count : 0) / window))) : [];
    const symbols = Array.from({ length: cells }, (_, i) => i >= used ? free :
      (swatches[bands.findIndex((end) => i < end)] ?? occupied));
    for (let i = 0; i < cells; i += columns) grid.push(symbols.slice(i, i + columns).join(' '));
  }

  if (observed) {
    add(legend, `${mix ? 'Approx. mix' : 'Observed estimates'} · % of window`, paneWidth, muted);
    const values = estimates.map((count) => isCount(count) ? [`~${asK(count)}`, ofWindow(count, window)] : ['unknown', '']);
    const sizeWidth = Math.max(...values.map(([size]) => size.length));
    const percentWidth = Math.max(...values.map(([, percent]) => percent.length));
    const alignNumbers = 26 + sizeWidth + percentWidth <= paneWidth;
    dashboardCategories.forEach(([label], i) => {
      const [size, percent] = values[i];
      const estimate = !percent ? size : alignNumbers ?
        `${size.padStart(sizeWidth)}  ${percent.padStart(percentWidth)}` : `${size}  ${percent}`;
      add(legend, `${paneWidth >= 36 ? label.padEnd(20) : label}  ${estimate}`, paneWidth, text, swatches[i]);
    });
  } else add(legend, snapshot ? 'Observation unavailable' : 'No request measured yet.', paneWidth, muted);
  if (columns && !mix && tokens > 0) add(legend, 'Occupied (unclassified)', paneWidth, muted, occupied);
  add(legend, `Free  ${known ? units(Math.max(0, window - tokens), 'token') : 'unknown'}`, paneWidth, muted, known ? free : '');
  if (known && tokens > window) add(legend, `Over window by ${units(tokens - window, 'token')}`, paneWidth,
    (value) => theme.fg('warning', value));

  if (detail) {
    if (staleReason) {
      footer.push('');
      add(footer, `Stale observation: ${safeLabel(staleReason)}`, width, muted);
    }
    footer.push(...renderDashboardDetail(report, width, theme, observed));
  } else {
    footer.push('');
    if (staleReason) add(footer, `Stale observation: ${safeLabel(staleReason)}`, width, muted);
    add(footer, inventoryLine(snapshot, width), width, muted);
    add(footer, '/gentle:context all', width, accent);
  }
  if (!sideBySide) return [...title, ...summary, '', ...grid, ...legend, ...footer];
  const right = [...summary, ...legend];
  const body = Array.from({ length: Math.max(grid.length, right.length) }, (_, i) => {
    if (!right[i]) return grid[i];
    return `${grid[i] ? `${grid[i]}   ` : ' '.repeat(42)}${right[i]}`;
  });
  return [...title, '', ...body, ...footer];
}

/** Render aggregate report data without inspecting requests or session state. Theme opts into the interactive dashboard. */
export function renderContext(report, options = {}) {
  const { snapshot, model, projected, ageMs, reconciliation, staleReason } = report ?? {};
  const { width: requestedWidth, detail = false, theme } = options;
  const width = Number.isFinite(requestedWidth) ? Math.max(1, Math.floor(requestedWidth)) : 80;
  if (theme) return renderDashboard(report ?? {}, width, theme, detail);
  const lines = [];
  const add = (text) => wrap(lines, text, width);
  add(`Context: ${safeLabel(model, 'unknown model')}`);
  renderProjection(add, width, projected);
  if (staleReason) add(`Stale observation: ${safeLabel(staleReason)}`);
  if (!snapshot) {
    add('No request measured yet.');
    if (detail) renderReconciliation(add, reconciliation);
    return lines;
  }
  const { format, coverage } = snapshot.observation ?? {};
  const observed = format === 'fragments' || format === 'pi-transcript';
  const age = isCount(ageMs) ? `${number(ageMs)} ms` : 'unknown';
  add(observed ? `Observation: ${format} / ${safeLabel(coverage)}; age ${age}` : `Observation unavailable; age ${age}`);
  if (observed) {
    add(width >= 60 ? 'Category estimates (observed text; not projected occupancy)' : 'Observed estimates (not occupancy)');
    for (const [key, label, compact = label] of categoryLabels) {
      renderEstimate(add, width, width >= 60 ? label : compact, snapshot.groups?.[key], detail);
    }
  }
  renderServers(add, width, snapshot.servers, observed, detail);
  if (detail) {
    if (observed) {
      add('Observed request detail');
      add(`Method: ${safeLabel(snapshot.estimation?.method)}`);
      add(`Measurement model: ${safeLabel(snapshot.estimation?.model)}`);
      renderEstimate(add, width, 'Observed total', snapshot.observed, true);
      add('Origins (alternate view, not additional input)');
      for (const [key, label] of originLabels) renderEstimate(add, width, label, snapshot.origins?.[key], true);
    }
    renderReconciliation(add, reconciliation);
  }
  return lines;
}
