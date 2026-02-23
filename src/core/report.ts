import type {
  GolfScorecard,
  HandicapCard,
  DispersionReport,
  AreaReport,
  MissDirection,
  NutritionCategory,
  NutritionEntry,
} from './types.js';
import type { MetaphorDefinition } from './metaphor.js';
import { computeHandicapCard } from './handicap.js';
import { computeDispersion, computeAreaPerformance } from './dispersion.js';
import {
  background, text as textColor, border, status, chart, semantic,
  fontFamily, fontSize, fontWeight, spacing, radius, layout,
} from '../tokens/index.js';

// --- Report Data ---

export interface ReportData {
  generatedAt: string;
  sprintCount: number;
  scorecards: GolfScorecard[];
  handicapCard: HandicapCard;
  dispersion: DispersionReport;
  areaPerformance: AreaReport;
  nutritionTrends: NutritionTrendEntry[];
  sprintTrend: SprintTrendEntry[];
}

export interface SprintTrendEntry {
  sprintNumber: number;
  theme: string;
  par: number;
  score: number;
  differential: number;
  fairwayPct: number;
  girPct: number;
}

export interface NutritionTrendEntry {
  category: NutritionCategory;
  healthy: number;
  needsAttention: number;
  neglected: number;
  total: number;
}

// --- Data Computation ---

export function buildReportData(scorecards: GolfScorecard[]): ReportData {
  const sorted = [...scorecards].sort((a, b) => a.sprint_number - b.sprint_number);

  const handicapCard = computeHandicapCard(sorted);
  const dispersion = computeDispersion(sorted);
  const areaPerformance = computeAreaPerformance(sorted);

  const sprintTrend: SprintTrendEntry[] = sorted.map(sc => {
    const fwTotal = sc.stats.fairways_total || 1;
    const girTotal = sc.stats.greens_total || 1;
    return {
      sprintNumber: sc.sprint_number,
      theme: sc.theme,
      par: sc.par,
      score: sc.score,
      differential: sc.score - sc.par,
      fairwayPct: Math.round((sc.stats.fairways_hit / fwTotal) * 100),
      girPct: Math.round((sc.stats.greens_in_regulation / girTotal) * 100),
    };
  });

  // Aggregate nutrition across all sprints
  const nutritionAgg: Record<NutritionCategory, { healthy: number; needsAttention: number; neglected: number; total: number }> = {
    hydration: { healthy: 0, needsAttention: 0, neglected: 0, total: 0 },
    diet: { healthy: 0, needsAttention: 0, neglected: 0, total: 0 },
    recovery: { healthy: 0, needsAttention: 0, neglected: 0, total: 0 },
    supplements: { healthy: 0, needsAttention: 0, neglected: 0, total: 0 },
    stretching: { healthy: 0, needsAttention: 0, neglected: 0, total: 0 },
  };

  for (const sc of sorted) {
    for (const entry of sc.nutrition ?? []) {
      const agg = nutritionAgg[entry.category];
      if (!agg) continue;
      agg.total++;
      if (entry.status === 'healthy') agg.healthy++;
      else if (entry.status === 'needs_attention') agg.needsAttention++;
      else if (entry.status === 'neglected') agg.neglected++;
    }
  }

  const nutritionTrends: NutritionTrendEntry[] = Object.entries(nutritionAgg)
    .filter(([, v]) => v.total > 0)
    .map(([cat, v]) => ({ category: cat as NutritionCategory, ...v }));

  return {
    generatedAt: new Date().toISOString(),
    sprintCount: sorted.length,
    scorecards: sorted,
    handicapCard,
    dispersion,
    areaPerformance,
    nutritionTrends,
    sprintTrend,
  };
}

// --- SVG Chart Helpers ---

export function svgLine(
  data: { x: number; y: number }[],
  width: number,
  height: number,
  color: string,
  strokeWidth = 2,
): string {
  if (data.length === 0) return '';
  const points = data.map(d => `${d.x},${d.y}`).join(' ');
  return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

export function svgRect(x: number, y: number, w: number, h: number, fill: string, rx = 3): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}"/>`;
}

export function svgText(x: number, y: number, text: string, opts: { anchor?: string; size?: number; fill?: string; weight?: string } = {}): string {
  const { anchor = 'middle', size = 11, fill = textColor.muted, weight = 'normal' } = opts;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${fill}" font-weight="${weight}" font-family="system-ui, -apple-system, sans-serif">${escapeHtml(text)}</text>`;
}

// --- Chart Renderers ---

export function renderHandicapTrendChart(trend: SprintTrendEntry[], metaphor?: MetaphorDefinition): string {
  if (trend.length === 0) return '<p>No sprint data available.</p>';

  const W = 600, H = 250, PAD = { top: 30, right: 30, bottom: 40, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const minY = Math.min(...trend.map(t => t.differential), -2);
  const maxY = Math.max(...trend.map(t => t.differential), 2);
  const yRange = Math.max(maxY - minY, 1);

  const scaleX = (i: number) => PAD.left + (i / Math.max(trend.length - 1, 1)) * plotW;
  const scaleY = (v: number) => PAD.top + plotH - ((v - minY) / yRange) * plotH;

  const points = trend.map((t, i) => ({ x: scaleX(i), y: scaleY(t.differential) }));

  // Par line (y=0)
  const parY = scaleY(0);

  // Grid lines
  let gridLines = '';
  for (let v = Math.ceil(minY); v <= Math.floor(maxY); v++) {
    const y = scaleY(v);
    gridLines += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="${border.default}" stroke-width="1"/>`;
    gridLines += svgText(PAD.left - 8, y + 4, v > 0 ? `+${v}` : `${v}`, { anchor: 'end', size: 10 });
  }

  // X-axis labels
  let xLabels = '';
  const sprintLabel = metaphor?.vocabulary.sprint ?? 'Sprint';
  for (let i = 0; i < trend.length; i++) {
    xLabels += svgText(scaleX(i), H - PAD.bottom + 20, `S${trend[i].sprintNumber}`, { size: 10 });
  }

  // Data points
  let dots = '';
  for (const p of points) {
    dots += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${chart.atPar}" stroke="#fff" stroke-width="2"/>`;
  }

  const title = metaphor?.vocabulary.handicapCard ?? 'Handicap';

  return `
  <div class="chart-container">
    <h3>${escapeHtml(title)} Trend</h3>
    <svg viewBox="0 0 ${W} ${H}" width="100%">
      ${gridLines}
      <line x1="${PAD.left}" y1="${parY}" x2="${W - PAD.right}" y2="${parY}" stroke="${chart.underPar}" stroke-width="1.5" stroke-dasharray="6,4"/>
      ${svgText(W - PAD.right + 5, parY + 4, metaphor?.vocabulary.onTarget ?? 'Par', { anchor: 'start', size: 10, fill: chart.underPar })}
      ${svgLine(points, W, H, chart.atPar, 2.5)}
      ${dots}
      ${xLabels}
      ${svgText(W / 2, H - 2, `${sprintLabel} Number`, { size: 10 })}
    </svg>
  </div>`;
}

export function renderDispersionChart(dispersion: DispersionReport, metaphor?: MetaphorDefinition): string {
  const W = 300, H = 300, CX = W / 2, CY = H / 2, R = 100;

  const dirs: MissDirection[] = ['long', 'short', 'left', 'right'];
  const offsets: Record<MissDirection, { dx: number; dy: number; labelX: number; labelY: number }> = {
    long: { dx: 0, dy: -1, labelX: CX, labelY: CY - R - 20 },
    short: { dx: 0, dy: 1, labelX: CX, labelY: CY + R + 28 },
    left: { dx: -1, dy: 0, labelX: CX - R - 40, labelY: CY + 4 },
    right: { dx: 1, dy: 0, labelX: CX + R + 40, labelY: CY + 4 },
  };

  // Background circle
  let svg = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${background.page}" stroke="${border.default}" stroke-width="1"/>`;
  svg += `<circle cx="${CX}" cy="${CY}" r="${R * 0.5}" fill="none" stroke="${border.default}" stroke-width="0.5"/>`;

  // Crosshairs
  svg += `<line x1="${CX}" y1="${CY - R}" x2="${CX}" y2="${CY + R}" stroke="${border.default}" stroke-width="0.5"/>`;
  svg += `<line x1="${CX - R}" y1="${CY}" x2="${CX + R}" y2="${CY}" stroke="${border.default}" stroke-width="0.5"/>`;

  // Center dot (target)
  svg += `<circle cx="${CX}" cy="${CY}" r="4" fill="${status.green}"/>`;

  // Miss dots (scatter based on count)
  const totalMisses = dispersion.total_misses || 1;
  const colors: Record<MissDirection, string> = {
    long: status.red, short: status.orange, left: status.purple, right: status.blue,
  };

  for (const dir of dirs) {
    const count = dispersion.by_direction[dir].count;
    if (count === 0) continue;

    const { dx, dy } = offsets[dir];
    const pct = count / totalMisses;
    const spread = Math.min(pct * R * 0.8, R * 0.8);

    for (let i = 0; i < Math.min(count, 15); i++) {
      const angle = (i / Math.max(count, 1)) * 0.8 - 0.4;
      const dist = (0.3 + (i % 3) * 0.25) * spread;
      const px = CX + dx * dist + Math.sin(angle) * dist * 0.4;
      const py = CY + dy * dist + Math.cos(angle) * dist * 0.4;
      svg += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="${colors[dir]}" opacity="0.7"/>`;
    }
  }

  // Direction labels
  for (const dir of dirs) {
    const { labelX, labelY } = offsets[dir];
    const dirLabel = metaphor?.missDirections[dir] ?? dir;
    const count = dispersion.by_direction[dir].count;
    svg += svgText(labelX, labelY, `${dirLabel} (${count})`, { size: 11, fill: colors[dir], weight: count > 0 ? 'bold' : 'normal' });
  }

  const missRate = dispersion.miss_rate_pct;
  const dominant = dispersion.dominant_miss;

  return `
  <div class="chart-container">
    <h3>Shot Dispersion</h3>
    <div class="dispersion-layout">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        ${svg}
      </svg>
      <div class="dispersion-stats">
        <div class="stat"><span class="stat-label">Total Shots</span><span class="stat-value">${dispersion.total_shots}</span></div>
        <div class="stat"><span class="stat-label">Miss Rate</span><span class="stat-value ${missRate > 20 ? 'warn' : ''}">${missRate}%</span></div>
        <div class="stat"><span class="stat-label">Dominant Miss</span><span class="stat-value">${dominant ? escapeHtml(metaphor?.missDirections[dominant] ?? dominant) : 'None'}</span></div>
      </div>
    </div>
  </div>`;
}

export function renderAreaPerformanceChart(area: AreaReport, metaphor?: MetaphorDefinition): string {
  const clubEntries = Object.entries(area.by_club);
  if (clubEntries.length === 0) return '<p>No club performance data.</p>';

  const W = 500, H = 200, PAD = { top: 20, right: 20, bottom: 40, left: 100 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const barH = Math.min(plotH / clubEntries.length - 8, 24);

  let bars = '';
  for (let i = 0; i < clubEntries.length; i++) {
    const [club, data] = clubEntries[i];
    const y = PAD.top + i * (plotH / clubEntries.length) + (plotH / clubEntries.length - barH) / 2;
    const clubLabel = metaphor?.clubs[club as keyof typeof metaphor.clubs] ?? club;

    // In-the-hole rate bar (green)
    const holeW = (data.in_the_hole_rate / 100) * plotW;
    bars += svgRect(PAD.left, y, holeW, barH, status.green);

    // Miss rate bar overlay (red, stacked)
    const missW = (data.miss_rate / 100) * plotW;
    if (missW > 0) {
      bars += svgRect(PAD.left + holeW, y, missW, barH, status.red);
    }

    // Label
    bars += svgText(PAD.left - 8, y + barH / 2 + 4, `${clubLabel} (${data.count})`, { anchor: 'end', size: 11 });

    // Value text
    const perfectLabel = metaphor?.shotResults.in_the_hole ?? 'perfect';
    bars += svgText(PAD.left + holeW + missW + 8, y + barH / 2 + 4, `${data.in_the_hole_rate}% ${perfectLabel}`, { anchor: 'start', size: 10, fill: status.green });
  }

  return `
  <div class="chart-container">
    <h3>Approach Performance</h3>
    <svg viewBox="0 0 ${W} ${H}" width="100%">
      ${bars}
    </svg>
    <div class="legend">
      <span class="legend-item"><span class="dot green"></span> ${escapeHtml(metaphor?.shotResults.in_the_hole ?? 'Perfect')}</span>
      <span class="legend-item"><span class="dot red"></span> Miss</span>
    </div>
  </div>`;
}

export function renderNutritionChart(trends: NutritionTrendEntry[], metaphor?: MetaphorDefinition): string {
  if (trends.length === 0) return '<p>No nutrition data.</p>';

  const W = 500, H = 180, PAD = { top: 20, right: 20, bottom: 30, left: 100 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const barH = Math.min(plotH / trends.length - 6, 20);

  let bars = '';
  for (let i = 0; i < trends.length; i++) {
    const t = trends[i];
    const y = PAD.top + i * (plotH / trends.length) + (plotH / trends.length - barH) / 2;
    const catLabel = metaphor?.nutrition[t.category] ?? t.category;

    const total = t.total || 1;
    const healthyW = (t.healthy / total) * plotW;
    const attentionW = (t.needsAttention / total) * plotW;
    const neglectedW = (t.neglected / total) * plotW;

    bars += svgRect(PAD.left, y, healthyW, barH, status.green);
    bars += svgRect(PAD.left + healthyW, y, attentionW, barH, status.amber);
    bars += svgRect(PAD.left + healthyW + attentionW, y, neglectedW, barH, status.red);

    bars += svgText(PAD.left - 8, y + barH / 2 + 4, catLabel, { anchor: 'end', size: 11 });
  }

  return `
  <div class="chart-container">
    <h3>Nutrition Trends</h3>
    <svg viewBox="0 0 ${W} ${H}" width="100%">
      ${bars}
    </svg>
    <div class="legend">
      <span class="legend-item"><span class="dot green"></span> Healthy</span>
      <span class="legend-item"><span class="dot amber"></span> Needs Attention</span>
      <span class="legend-item"><span class="dot red"></span> Neglected</span>
    </div>
  </div>`;
}

// --- Summary Cards ---

export function renderSummaryCards(data: ReportData, metaphor?: MetaphorDefinition): string {
  const { handicapCard, sprintTrend } = data;
  const all = handicapCard.all_time;
  const last5 = handicapCard.last_5;
  const scorecardLabel = metaphor?.vocabulary.scorecard ?? 'Scorecard';

  const trendArrow = last5.handicap < all.handicap ? '&#x25BC;' : last5.handicap > all.handicap ? '&#x25B2;' : '&#x25CF;';
  const trendColor = last5.handicap <= all.handicap ? status.green : status.red;

  return `
  <div class="summary-cards">
    <div class="card">
      <div class="card-label">${escapeHtml(metaphor?.vocabulary.handicapCard ?? 'Handicap')}</div>
      <div class="card-value">${all.handicap > 0 ? '+' : ''}${all.handicap}</div>
      <div class="card-sub" style="color:${trendColor}">Last 5: ${last5.handicap > 0 ? '+' : ''}${last5.handicap} ${trendArrow}</div>
    </div>
    <div class="card">
      <div class="card-label">${escapeHtml(metaphor?.shotResults.fairway ?? 'Fairway')} %</div>
      <div class="card-value">${all.fairway_pct}%</div>
      <div class="card-sub">Last 5: ${last5.fairway_pct}%</div>
    </div>
    <div class="card">
      <div class="card-label">${escapeHtml(metaphor?.shotResults.green ?? 'GIR')} %</div>
      <div class="card-value">${all.gir_pct}%</div>
      <div class="card-sub">Last 5: ${last5.gir_pct}%</div>
    </div>
    <div class="card">
      <div class="card-label">${escapeHtml(scorecardLabel)}s</div>
      <div class="card-value">${data.sprintCount}</div>
      <div class="card-sub">${sprintTrend.length > 0 ? `Latest: S${sprintTrend[sprintTrend.length - 1].sprintNumber}` : 'None'}</div>
    </div>
  </div>`;
}

// --- Sprint Table ---

export function renderSprintTable(trend: SprintTrendEntry[], metaphor?: MetaphorDefinition): string {
  if (trend.length === 0) return '';

  const sprintLabel = metaphor?.vocabulary.sprint ?? 'Sprint';
  const rows = trend.map(t => {
    const diffStr = t.differential > 0 ? `+${t.differential}` : `${t.differential}`;
    const diffClass = t.differential > 0 ? 'over' : t.differential < 0 ? 'under' : 'even';
    return `<tr data-sprint="${t.sprintNumber}">
      <td>S${t.sprintNumber}</td>
      <td>${escapeHtml(t.theme)}</td>
      <td>${t.par}</td>
      <td>${t.score}</td>
      <td class="${diffClass}">${diffStr}</td>
      <td>${t.fairwayPct}%</td>
      <td>${t.girPct}%</td>
    </tr>`;
  }).join('\n');

  return `
  <div class="chart-container">
    <h3>${escapeHtml(sprintLabel)} History</h3>
    <table>
      <thead>
        <tr><th>${escapeHtml(sprintLabel)}</th><th>Theme</th><th>${escapeHtml(metaphor?.vocabulary.onTarget ?? 'Par')}</th><th>Score</th><th>+/-</th><th>${escapeHtml(metaphor?.shotResults.fairway ?? 'FW')}%</th><th>${escapeHtml(metaphor?.shotResults.green ?? 'GIR')}%</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// --- HTML Generation ---

export const REPORT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${fontFamily.system}; background: ${background.page}; color: ${textColor.primary}; padding: ${spacing[7]}; max-width: ${layout.maxWidth}; margin: 0 auto; }
  h1 { font-size: ${fontSize.xl}; margin-bottom: ${spacing[2]}; }
  h2 { font-size: ${fontSize.lg}; color: ${textColor.secondary}; margin: ${spacing[8]} 0 ${spacing[5]}; border-bottom: 2px solid ${border.default}; padding-bottom: ${spacing[3]}; }
  h3 { font-size: ${fontSize.md}; color: ${textColor.tertiary}; margin-bottom: ${spacing[4]}; }
  .subtitle { color: ${textColor.muted}; font-size: ${fontSize.base}; margin-bottom: ${spacing[7]}; }
  .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(${layout.cardMinWidth}, 1fr)); gap: ${layout.cardGap}; margin-bottom: ${spacing[8]}; }
  .card { background: ${background.surface}; border: 1px solid ${border.default}; border-radius: ${radius.md}; padding: ${spacing[5]}; }
  .card-label { font-size: ${fontSize.sm}; color: ${textColor.muted}; text-transform: uppercase; letter-spacing: 0.05em; }
  .card-value { font-size: ${fontSize['2xl']}; font-weight: ${fontWeight.bold}; margin: ${spacing[2]} 0; }
  .card-sub { font-size: ${fontSize.sm}; color: ${textColor.faint}; }
  .chart-container { background: ${background.surface}; border: 1px solid ${border.default}; border-radius: ${radius.md}; padding: ${spacing[6]}; margin-bottom: ${spacing[6]}; }
  .chart-container svg { display: block; margin: 0 auto; }
  .dispersion-layout { display: flex; align-items: center; gap: ${spacing[7]}; flex-wrap: wrap; justify-content: center; }
  .dispersion-stats { display: flex; flex-direction: column; gap: ${spacing[4]}; }
  .stat { display: flex; flex-direction: column; }
  .stat-label { font-size: ${fontSize.xs}; color: ${textColor.muted}; text-transform: uppercase; }
  .stat-value { font-size: 20px; font-weight: ${fontWeight.semibold}; }
  .stat-value.warn { color: ${semantic.warn}; }
  .legend { display: flex; gap: ${spacing[5]}; margin-top: ${spacing[3]}; font-size: ${fontSize.sm}; color: ${textColor.muted}; }
  .legend-item { display: flex; align-items: center; gap: ${spacing[2]}; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .dot.green { background: ${status.green}; }
  .dot.red { background: ${status.red}; }
  .dot.amber { background: ${status.amber}; }
  table { width: 100%; border-collapse: collapse; font-size: ${fontSize.base}; }
  th { text-align: left; padding: ${spacing[3]}; border-bottom: 2px solid ${border.default}; font-weight: ${fontWeight.semibold}; color: ${textColor.secondary}; }
  td { padding: ${spacing[3]}; border-bottom: 1px solid ${border.subtle}; }
  tr:hover td { background: ${background.page}; }
  .over { color: ${semantic.over}; font-weight: ${fontWeight.semibold}; }
  .under { color: ${semantic.under}; font-weight: ${fontWeight.semibold}; }
  .even { color: ${semantic.even}; font-weight: ${fontWeight.semibold}; }
  .footer { margin-top: ${spacing[9]}; padding-top: ${spacing[5]}; border-top: 1px solid ${border.default}; font-size: ${fontSize.xs}; color: ${textColor.faint}; text-align: center; }
`;

export function generateHtmlReport(data: ReportData, metaphor?: MetaphorDefinition): string {
  const title = metaphor?.vocabulary.review ?? 'SLOPE Report';
  const sprintLabel = metaphor?.vocabulary.sprint ?? 'Sprint';
  const nutritionHeading = metaphor ? 'Development Health' : 'Nutrition';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">Generated ${data.generatedAt.split('T')[0]} &middot; ${data.sprintCount} ${escapeHtml(metaphor?.vocabulary.sprint ?? 'sprint')}s analyzed</p>

  ${renderSummaryCards(data, metaphor)}

  <h2>Performance Trend</h2>
  ${renderHandicapTrendChart(data.sprintTrend, metaphor)}

  <h2>Dispersion</h2>
  ${renderDispersionChart(data.dispersion, metaphor)}

  <h2>Approach Performance</h2>
  ${renderAreaPerformanceChart(data.areaPerformance, metaphor)}

  <h2>${escapeHtml(nutritionHeading)}</h2>
  ${renderNutritionChart(data.nutritionTrends, metaphor)}

  <h2>${escapeHtml(sprintLabel)} History</h2>
  ${renderSprintTable(data.sprintTrend, metaphor)}

  <div class="footer">SLOPE &mdash; Sprint Lifecycle &amp; Operational Performance Engine</div>
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
