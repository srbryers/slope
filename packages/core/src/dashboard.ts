import type { GolfScorecard, MissDirection } from './types.js';
import type { MetaphorDefinition } from './metaphor.js';
import type { ReportData, SprintTrendEntry } from './report.js';
import {
  REPORT_CSS,
  escapeHtml,
  svgRect,
  svgText,
  renderSummaryCards,
  renderHandicapTrendChart,
  renderDispersionChart,
  renderAreaPerformanceChart,
  renderNutritionChart,
  renderSprintTable,
} from './report.js';

// --- Dashboard Config ---

export interface DashboardConfig {
  port: number;
  autoOpen: boolean;
  refreshInterval: number;
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  port: 3000,
  autoOpen: true,
  refreshInterval: 30,
};

// --- Heatmap Types ---

export interface HeatmapCell {
  sprintNumber: number;
  direction: MissDirection;
  count: number;
  intensity: number;
}

export interface MissHeatmapData {
  cells: HeatmapCell[];
  maxCount: number;
  sprints: number[];
  directions: MissDirection[];
}

export interface AreaHazardEntry {
  club: string;
  totalShots: number;
  hazardCount: number;
  hazardRate: number;
  topHazards: { type: string; count: number }[];
}

// --- Sprint Detail Renderer ---

export function renderSprintDetail(scorecard: GolfScorecard, metaphor?: MetaphorDefinition): string {
  const sprintLabel = metaphor?.vocabulary.sprint ?? 'Sprint';

  // Shot table
  let shotsHtml = '';
  if (scorecard.shots.length > 0) {
    const clubHeader = metaphor?.vocabulary.sprint ? 'Approach' : 'Club';
    const rows = scorecard.shots.map(shot => {
      const clubLabel = metaphor?.clubs[shot.club as keyof typeof metaphor.clubs] ?? shot.club;
      const resultLabel = metaphor?.shotResults[shot.result as keyof typeof metaphor.shotResults] ?? shot.result;
      const hazardList = shot.hazards.map(h => {
        const hLabel = metaphor?.hazards[h.type as keyof typeof metaphor.hazards] ?? h.type;
        return escapeHtml(`${hLabel}: ${h.description}`);
      }).join('<br>') || '—';
      const notes = shot.notes ? escapeHtml(shot.notes) : '—';
      return `<tr>
        <td>${escapeHtml(shot.ticket_key)}</td>
        <td>${escapeHtml(shot.title)}</td>
        <td>${escapeHtml(clubLabel)}</td>
        <td>${escapeHtml(resultLabel)}</td>
        <td>${hazardList}</td>
        <td>${notes}</td>
      </tr>`;
    }).join('\n');

    shotsHtml = `
    <h4>Shot Records</h4>
    <table>
      <thead>
        <tr><th>Ticket</th><th>Title</th><th>${escapeHtml(clubHeader)}</th><th>Result</th><th>Hazards</th><th>Notes</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // Conditions
  let conditionsHtml = '';
  if (scorecard.conditions.length > 0) {
    const condRows = scorecard.conditions.map(c => {
      const condLabel = metaphor?.conditions[c.type as keyof typeof metaphor.conditions] ?? c.type;
      return `<tr><td>${escapeHtml(condLabel)}</td><td>${escapeHtml(c.description)}</td><td>${escapeHtml(c.impact)}</td></tr>`;
    }).join('\n');
    conditionsHtml = `
    <h4>Conditions</h4>
    <table>
      <thead><tr><th>Type</th><th>Description</th><th>Impact</th></tr></thead>
      <tbody>${condRows}</tbody>
    </table>`;
  }

  // Special plays
  let specialPlaysHtml = '';
  if (scorecard.special_plays.length > 0) {
    const plays = scorecard.special_plays.map(p => {
      const pLabel = metaphor?.specialPlays[p as keyof typeof metaphor.specialPlays] ?? p;
      return `<span class="tag">${escapeHtml(pLabel)}</span>`;
    }).join(' ');
    specialPlaysHtml = `<h4>Special Plays</h4><div class="tags">${plays}</div>`;
  }

  // Nutrition
  let nutritionHtml = '';
  if (scorecard.nutrition && scorecard.nutrition.length > 0) {
    const nutRows = scorecard.nutrition.map(n => {
      const catLabel = metaphor?.nutrition[n.category] ?? n.category;
      const statusClass = n.status === 'healthy' ? 'under' : n.status === 'neglected' ? 'over' : 'even';
      return `<tr><td>${escapeHtml(catLabel)}</td><td>${escapeHtml(n.description)}</td><td class="${statusClass}">${escapeHtml(n.status)}</td></tr>`;
    }).join('\n');
    nutritionHtml = `
    <h4>Nutrition</h4>
    <table>
      <thead><tr><th>Category</th><th>Description</th><th>Status</th></tr></thead>
      <tbody>${nutRows}</tbody>
    </table>`;
  }

  // 19th Hole
  let nineteenthHtml = '';
  if (scorecard.nineteenth_hole) {
    const nh = scorecard.nineteenth_hole;
    const entries: string[] = [];
    if (nh.how_did_it_feel) entries.push(`<dt>How did it feel?</dt><dd>${escapeHtml(nh.how_did_it_feel)}</dd>`);
    if (nh.advice_for_next_player) entries.push(`<dt>Advice for next player</dt><dd>${escapeHtml(nh.advice_for_next_player)}</dd>`);
    if (nh.what_surprised_you) entries.push(`<dt>What surprised you?</dt><dd>${escapeHtml(nh.what_surprised_you)}</dd>`);
    if (nh.excited_about_next) entries.push(`<dt>Excited about next</dt><dd>${escapeHtml(nh.excited_about_next)}</dd>`);
    if (entries.length > 0) {
      nineteenthHtml = `<h4>19th Hole</h4><dl class="nineteenth-hole">${entries.join('\n')}</dl>`;
    }
  }

  const diffStr = scorecard.score - scorecard.par;
  const diffLabel = diffStr > 0 ? `+${diffStr}` : `${diffStr}`;
  const diffClass = diffStr > 0 ? 'over' : diffStr < 0 ? 'under' : 'even';

  return `
  <div class="sprint-detail">
    <h3>${escapeHtml(sprintLabel)} ${scorecard.sprint_number}: ${escapeHtml(scorecard.theme)}</h3>
    <div class="detail-meta">
      <span>Par ${scorecard.par} | Score ${scorecard.score} (<span class="${diffClass}">${diffLabel}</span>)</span>
      <span>Date: ${escapeHtml(scorecard.date)}</span>
      <span>Label: ${escapeHtml(scorecard.score_label)}</span>
    </div>
    ${shotsHtml}
    ${conditionsHtml}
    ${specialPlaysHtml}
    ${nutritionHtml}
    ${nineteenthHtml}
  </div>`;
}

// --- Sprint Timeline Chart ---

export function renderSprintTimeline(trend: SprintTrendEntry[], metaphor?: MetaphorDefinition): string {
  if (trend.length === 0) return '<p>No sprint data available.</p>';

  const W = 600, H = 200, PAD = { top: 30, right: 30, bottom: 40, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...trend.map(t => Math.max(t.par, t.score)), 5);
  const barGroupW = plotW / trend.length;
  const barW = Math.min(barGroupW * 0.35, 24);
  const gap = 2;

  let bars = '';
  for (let i = 0; i < trend.length; i++) {
    const t = trend[i];
    const groupX = PAD.left + i * barGroupW + (barGroupW - barW * 2 - gap) / 2;

    // Par bar (gray)
    const parH = (t.par / maxVal) * plotH;
    const parY = PAD.top + plotH - parH;
    bars += svgRect(groupX, parY, barW, parH, '#cbd5e1');

    // Actual bar (colored)
    const color = t.score < t.par ? '#22c55e' : t.score === t.par ? '#3b82f6' : '#ef4444';
    const actH = (t.score / maxVal) * plotH;
    const actY = PAD.top + plotH - actH;
    bars += svgRect(groupX + barW + gap, actY, barW, actH, color);

    // Sprint label
    bars += svgText(groupX + barW + gap / 2, H - PAD.bottom + 16, `S${t.sprintNumber}`, { size: 10 });

    // data-sprint attribute via transparent clickable rect
    bars += `<rect x="${groupX}" y="${PAD.top}" width="${barW * 2 + gap}" height="${plotH}" fill="transparent" data-sprint="${t.sprintNumber}" class="clickable"/>`;
  }

  // Y-axis labels
  let yLabels = '';
  for (let v = 0; v <= maxVal; v++) {
    const y = PAD.top + plotH - (v / maxVal) * plotH;
    yLabels += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#e2e8f0" stroke-width="0.5"/>`;
    yLabels += svgText(PAD.left - 8, y + 4, `${v}`, { anchor: 'end', size: 10 });
  }

  const sprintLabel = metaphor?.vocabulary.sprint ?? 'Sprint';

  return `
  <div class="chart-container">
    <h3>${escapeHtml(sprintLabel)} Timeline</h3>
    <svg viewBox="0 0 ${W} ${H}" width="100%">
      ${yLabels}
      ${bars}
    </svg>
    <div class="legend">
      <span class="legend-item"><span class="dot" style="background:#cbd5e1"></span> Par</span>
      <span class="legend-item"><span class="dot green"></span> Under Par</span>
      <span class="legend-item"><span class="dot" style="background:#3b82f6"></span> At Par</span>
      <span class="legend-item"><span class="dot red"></span> Over Par</span>
    </div>
  </div>`;
}

// --- Miss Pattern Heatmap ---

export function computeMissHeatmap(scorecards: GolfScorecard[]): MissHeatmapData {
  const directions: MissDirection[] = ['long', 'short', 'left', 'right'];
  const sorted = [...scorecards].sort((a, b) => a.sprint_number - b.sprint_number);
  const sprints = sorted.map(s => s.sprint_number);

  let maxCount = 0;
  const cells: HeatmapCell[] = [];

  for (const sc of sorted) {
    for (const dir of directions) {
      const count = sc.stats.miss_directions[dir] ?? 0;
      if (count > maxCount) maxCount = count;
      cells.push({ sprintNumber: sc.sprint_number, direction: dir, count, intensity: 0 });
    }
  }

  // Normalize intensity
  for (const cell of cells) {
    cell.intensity = maxCount > 0 ? cell.count / maxCount : 0;
  }

  return { cells, maxCount, sprints, directions };
}

export function renderMissHeatmap(heatmap: MissHeatmapData, metaphor?: MetaphorDefinition): string {
  if (heatmap.sprints.length === 0) return '<p>No miss data available.</p>';

  const CELL_W = 48, CELL_H = 36;
  const PAD = { top: 30, left: 90, right: 20, bottom: 10 };
  const W = PAD.left + heatmap.sprints.length * CELL_W + PAD.right;
  const H = PAD.top + heatmap.directions.length * CELL_H + PAD.bottom;

  let cells = '';

  // Column headers (sprint numbers)
  for (let i = 0; i < heatmap.sprints.length; i++) {
    const x = PAD.left + i * CELL_W + CELL_W / 2;
    cells += svgText(x, PAD.top - 8, `S${heatmap.sprints[i]}`, { size: 10 });
  }

  // Row headers (directions) + cells
  for (let d = 0; d < heatmap.directions.length; d++) {
    const dir = heatmap.directions[d];
    const dirLabel = metaphor?.missDirections[dir] ?? dir;
    const y = PAD.top + d * CELL_H;
    cells += svgText(PAD.left - 8, y + CELL_H / 2 + 4, dirLabel, { anchor: 'end', size: 11 });

    for (let s = 0; s < heatmap.sprints.length; s++) {
      const cell = heatmap.cells.find(c => c.sprintNumber === heatmap.sprints[s] && c.direction === dir);
      const intensity = cell?.intensity ?? 0;
      const count = cell?.count ?? 0;
      const x = PAD.left + s * CELL_W;

      // Interpolate color: #f8fafc (0) -> #ef4444 (1.0)
      const r = Math.round(248 + (239 - 248) * intensity);
      const g = Math.round(250 + (68 - 250) * intensity);
      const b = Math.round(252 + (68 - 252) * intensity);
      const fill = `rgb(${r},${g},${b})`;

      cells += svgRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4, fill, 4);
      if (count > 0) {
        cells += svgText(x + CELL_W / 2, y + CELL_H / 2 + 4, `${count}`, { size: 11, fill: intensity > 0.5 ? '#fff' : '#64748b' });
      }
      const tooltip = `S${heatmap.sprints[s]} ${dirLabel}: ${count} misses`;
      cells += `<title>${escapeHtml(tooltip)}</title>`;
    }
  }

  return `
  <div class="chart-container">
    <h3>Miss Pattern Heatmap</h3>
    <svg viewBox="0 0 ${W} ${H}" width="100%">
      ${cells}
    </svg>
  </div>`;
}

// --- Area Hazard Overlay ---

export function computeAreaHazards(scorecards: GolfScorecard[]): AreaHazardEntry[] {
  const clubMap: Record<string, { totalShots: number; hazardCount: number; hazardTypes: Record<string, number> }> = {};

  for (const sc of scorecards) {
    for (const shot of sc.shots) {
      if (!clubMap[shot.club]) {
        clubMap[shot.club] = { totalShots: 0, hazardCount: 0, hazardTypes: {} };
      }
      const entry = clubMap[shot.club];
      entry.totalShots++;
      for (const h of shot.hazards) {
        entry.hazardCount++;
        entry.hazardTypes[h.type] = (entry.hazardTypes[h.type] ?? 0) + 1;
      }
    }
  }

  return Object.entries(clubMap).map(([club, data]) => ({
    club,
    totalShots: data.totalShots,
    hazardCount: data.hazardCount,
    hazardRate: data.totalShots > 0 ? Math.round((data.hazardCount / data.totalShots) * 100) : 0,
    topHazards: Object.entries(data.hazardTypes)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
  })).sort((a, b) => b.hazardRate - a.hazardRate);
}

export function renderAreaHazardOverlay(hazards: AreaHazardEntry[], metaphor?: MetaphorDefinition): string {
  if (hazards.length === 0) return '';

  const rows = hazards.map(h => {
    const clubLabel = metaphor?.clubs[h.club as keyof typeof metaphor.clubs] ?? h.club;
    const topList = h.topHazards.map(t => {
      const tLabel = metaphor?.hazards[t.type as keyof typeof metaphor.hazards] ?? t.type;
      return `${escapeHtml(tLabel)} (${t.count})`;
    }).join(', ') || '—';
    return `<tr>
      <td>${escapeHtml(clubLabel)}</td>
      <td>${h.totalShots}</td>
      <td>${h.hazardCount}</td>
      <td>${h.hazardRate}%</td>
      <td>${topList}</td>
    </tr>`;
  }).join('\n');

  return `
  <div class="chart-container hazard-overlay">
    <h4>Area Hazard Frequency</h4>
    <table>
      <thead><tr><th>Area</th><th>Shots</th><th>Hazards</th><th>Rate</th><th>Top Hazards</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// --- Dashboard Script ---

export function generateDashboardScript(config?: Partial<DashboardConfig>): string {
  return `
  <script>
    (function() {
      var detailEl = document.getElementById('sprint-detail');
      var currentSprint = null;

      function handleSprintClick(e) {
        var target = e.target.closest('[data-sprint]');
        if (!target) return;
        var sprintNum = target.getAttribute('data-sprint');
        if (!sprintNum) return;

        if (currentSprint === sprintNum) {
          detailEl.innerHTML = '';
          currentSprint = null;
          return;
        }

        currentSprint = sprintNum;
        detailEl.innerHTML = '<p>Loading...</p>';

        fetch('/api/sprint/' + sprintNum + '?html=1')
          .then(function(r) { return r.ok ? r.text() : Promise.reject('Not found'); })
          .then(function(html) {
            detailEl.innerHTML = html;
            detailEl.scrollIntoView({ behavior: 'smooth' });
          })
          .catch(function() {
            detailEl.innerHTML = '<p>Sprint not found.</p>';
          });
      }

      document.addEventListener('click', handleSprintClick);
    })();
  </script>`;
}

// --- Dashboard HTML Generator ---

const DASHBOARD_CSS = `
  .dashboard-nav { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; margin-bottom: 24px; border-bottom: 2px solid #e2e8f0; }
  .dashboard-nav h1 { margin: 0; }
  .dashboard-nav .meta { font-size: 12px; color: #94a3b8; }
  .sprint-detail { background: #fff; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
  .sprint-detail h3 { color: #1e293b; margin-bottom: 8px; }
  .detail-meta { font-size: 13px; color: #64748b; margin-bottom: 16px; display: flex; gap: 16px; flex-wrap: wrap; }
  .sprint-detail h4 { font-size: 13px; color: #475569; margin: 16px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .tags { display: flex; gap: 8px; flex-wrap: wrap; }
  .tag { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 2px 8px; font-size: 12px; color: #475569; }
  .nineteenth-hole dt { font-weight: 600; color: #475569; font-size: 13px; margin-top: 8px; }
  .nineteenth-hole dd { color: #64748b; font-size: 13px; margin: 2px 0 0 0; }
  .hazard-overlay { border-color: #fde68a; }
  .hazard-overlay h4 { color: #92400e; }
  svg .clickable { cursor: pointer; }
  svg .clickable:hover { opacity: 0.2; fill: #3b82f6; }
  #sprint-detail:empty { display: none; }
`;

export function generateDashboardHtml(
  data: ReportData,
  metaphor?: MetaphorDefinition,
  config?: Partial<DashboardConfig>,
): string {
  const resolvedConfig = { ...DEFAULT_DASHBOARD_CONFIG, ...config };
  const title = metaphor?.vocabulary.review ?? 'SLOPE Dashboard';
  const sprintLabel = metaphor?.vocabulary.sprint ?? 'Sprint';
  const nutritionHeading = metaphor ? 'Development Health' : 'Nutrition';

  const refreshMeta = resolvedConfig.refreshInterval > 0
    ? `<meta http-equiv="refresh" content="${resolvedConfig.refreshInterval}">`
    : '';

  // Compute heatmap + hazard data from scorecards
  const heatmap = computeMissHeatmap(data.scorecards);
  const hazards = computeAreaHazards(data.scorecards);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${refreshMeta}
  <title>${escapeHtml(title)}</title>
  <style>${REPORT_CSS}${DASHBOARD_CSS}</style>
</head>
<body>
  <nav class="dashboard-nav">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div>${data.sprintCount} ${escapeHtml(sprintLabel.toLowerCase())}s analyzed</div>
      <div>Updated ${data.generatedAt.split('T')[0]}</div>
    </div>
  </nav>

  ${renderSummaryCards(data, metaphor)}

  <h2>Performance Trend</h2>
  ${renderHandicapTrendChart(data.sprintTrend, metaphor)}

  <h2>${escapeHtml(sprintLabel)} Timeline</h2>
  ${renderSprintTimeline(data.sprintTrend, metaphor)}

  <h2>Dispersion</h2>
  ${renderDispersionChart(data.dispersion, metaphor)}

  <h2>Miss Pattern Heatmap</h2>
  ${renderMissHeatmap(heatmap, metaphor)}

  <h2>Approach Performance</h2>
  ${renderAreaPerformanceChart(data.areaPerformance, metaphor)}
  ${renderAreaHazardOverlay(hazards, metaphor)}

  <h2>${escapeHtml(nutritionHeading)}</h2>
  ${renderNutritionChart(data.nutritionTrends, metaphor)}

  <h2>${escapeHtml(sprintLabel)} History</h2>
  ${renderSprintTable(data.sprintTrend, metaphor)}

  <div id="sprint-detail"></div>

  <div class="footer">SLOPE &mdash; Sprint Lifecycle &amp; Operational Performance Engine</div>

  ${generateDashboardScript(config)}
</body>
</html>`;
}
