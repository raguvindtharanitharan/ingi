import type { TableauWorkbook, MarkType } from '../parsers/model.js';
import {
  collectLeafZones, buildFiltersByWorksheet, pickDashboard,
  cleanRef, markTypeLabel, zoneColors, pct,
  type LeafKind,
} from './react/zone-helpers.js';

export function generateLayoutHtml(workbook: TableauWorkbook): string {
  const dashboard = pickDashboard(workbook);

  if (!dashboard) return errorHtml('No dashboards found in workbook.');

  const leaves = collectLeafZones(dashboard.zones);
  if (leaves.length === 0) return errorHtml('No layout zones found in dashboard.');

  // Compute bounding box and convert to percentages
  const minX = Math.min(...leaves.map((z) => z.x));
  const minY = Math.min(...leaves.map((z) => z.y));
  const maxX = Math.max(...leaves.map((z) => z.x + z.w));
  const maxY = Math.max(...leaves.map((z) => z.y + z.h));
  const totalW = maxX - minX || 1;
  const totalH = maxY - minY || 1;
  const totalArea = totalW * totalH;

  // Identify control zones: zones that share a name with a larger zone
  const areaByName = new Map<string, number>();
  for (const z of leaves) {
    const area = z.w * z.h;
    if (!areaByName.has(z.worksheetOrName) || area > areaByName.get(z.worksheetOrName)!) {
      areaByName.set(z.worksheetOrName, area);
    }
  }

  const filtersByWorksheet = buildFiltersByWorksheet(workbook);

  const zones = leaves.map((z) => {
    const encoding = workbook.visualEncodings.find((e) => e.worksheet === z.worksheetOrName);
    const markType = encoding?.effectiveMarkType ?? 'unsupported';
    const area = z.w * z.h;
    const maxArea = areaByName.get(z.worksheetOrName) ?? area;
    const hasEncodings = encoding
      ? encoding.rows.length > 0 || encoding.columns.length > 0
      : false;

    const isTextButton = z.kind === 'worksheet' && !hasEncodings && area < maxArea * 0.5;
    const isControl = z.kind !== 'worksheet' ||
      (area < maxArea && hasEncodings) ||
      isTextButton;
    const filterFields = filtersByWorksheet.get(z.worksheetOrName) ?? [];

    const rowFields = encoding
      ? encoding.rows
          .map((r) => r.caption ?? cleanRef(r.field))
          .filter((n) => n && !/Latitude|Longitude/i.test(n))
      : [];
    const colFields = encoding
      ? encoding.columns
          .map((c) => c.caption ?? cleanRef(c.field))
          .filter((n) => n && n !== ':Measure Names')
          .slice(0, 3)
      : [];
    const hasMeasureNames = encoding?.columns.some((c) => c.field.includes(':Measure Names')) ?? false;

    return {
      name: z.displayLabel || z.worksheetOrName,
      internalName: z.worksheetOrName,
      kind: z.kind,
      markType,
      isControl,
      isTextButton,
      filterFields,
      rowFields,
      colFields,
      hasMeasureNames,
      controlMode: z.controlMode,
      paramRef: z.paramRef,
      left:   pct((z.x - minX) / totalW),
      top:    pct((z.y - minY) / totalH),
      width:  pct(z.w / totalW),
      height: pct(z.h / totalH),
    };
  });

  const zoneBlocks = zones.map((z) => {
    if (z.isControl) {
      // paramctrl → parameter control (slider, dropdown, etc.)
      if (z.kind === 'paramctrl') {
        const ctrlType = z.controlMode ?? 'dropdown';
        const ctrlIcon = ctrlType === 'slider' ? '⟼' : ctrlType === 'radio' ? '◉' : ctrlType === 'checkbox' ? '☑' : '▾';
        const paramLine = z.paramRef
          ? `<span style="font-size:9px;color:#92400e;opacity:0.7;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${escHtml(z.paramRef)}</span>`
          : '';
        return `
    <div style="
      position: absolute;
      left: ${z.left}; top: ${z.top};
      width: ${z.width}; height: ${z.height};
      box-sizing: border-box;
      background: #fffbeb;
      border: 2px dashed #f59e0b;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 6px 10px;
      overflow: hidden;
    ">
      <span style="font-size:9px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#b45309;">Parameter Control</span>
      <span style="font-size:12px;font-weight:600;color:#78350f;text-align:center;line-height:1.3;">${escHtml(z.name)}</span>
      ${paramLine}
      <span style="font-size:9px;color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:4px;">${ctrlIcon} ${ctrlType}</span>
    </div>`;
      }

      // text → title / label zone
      if (z.kind === 'text') {
        return `
    <div style="
      position: absolute;
      left: ${z.left}; top: ${z.top};
      width: ${z.width}; height: ${z.height};
      box-sizing: border-box;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      overflow: hidden;
    ">
      <span style="font-size:10px;font-weight:500;color:#94a3b8;letter-spacing:0.04em;text-transform:uppercase;">Title / Text Zone</span>
    </div>`;
      }

      // text/button zone — worksheet with no field encodings
      if (z.isTextButton) {
        return `
    <div style="
      position: absolute;
      left: ${z.left}; top: ${z.top};
      width: ${z.width}; height: ${z.height};
      box-sizing: border-box;
      background: #f0fdf4;
      border: 1px dashed #86efac;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px 10px;
      overflow: hidden;
    ">
      <span style="font-size:9px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#16a34a;">Text / Button</span>
      <span style="font-size:10px;color:#15803d;margin-left:6px;">${escHtml(z.name)}</span>
    </div>`;
      }

      // small worksheet → quick filter
      const filterLabel = z.filterFields.length > 0 ? z.filterFields : [z.name];
      return `
    <div style="
      position: absolute;
      left: ${z.left}; top: ${z.top};
      width: ${z.width}; height: ${z.height};
      box-sizing: border-box;
      background: #fffbeb;
      border: 2px dashed #f59e0b;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 6px 10px;
      overflow: hidden;
    ">
      <span style="font-size:9px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#b45309;">Quick Filter</span>
      ${filterLabel.map(f => `<span style="font-size:11px;font-weight:500;color:#78350f;text-align:center;line-height:1.3;">${escHtml(f)}</span>`).join('')}
    </div>`;
    }

    const { bg, border, badge, badgeBg } = zoneStyle(z.markType);

    const rowLine = z.rowFields.length > 0
      ? `<div style="font-size:10px;color:#64748b;margin-top:6px;text-align:center;">
          <span style="color:#94a3b8;font-weight:500;">ROWS&nbsp;</span>${z.rowFields.map(escHtml).join(' · ')}
         </div>`
      : '';

    const colLine = z.colFields.length > 0 || z.hasMeasureNames
      ? `<div style="font-size:10px;color:#64748b;text-align:center;">
          <span style="color:#94a3b8;font-weight:500;">COLS&nbsp;</span>${
            z.hasMeasureNames
              ? 'Measure Names' + (z.colFields.length ? ' · ' + z.colFields.map(escHtml).join(' · ') : '')
              : z.colFields.map(escHtml).join(' · ')
          }
         </div>`
      : '';

    return `
    <div style="
      position: absolute;
      left: ${z.left}; top: ${z.top};
      width: ${z.width}; height: ${z.height};
      box-sizing: border-box;
      background: ${bg};
      border: 2px solid ${border};
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 10px;
      overflow: hidden;
    ">
      <span style="font-size:14px;font-weight:600;color:#1e293b;text-align:center;line-height:1.3;">${escHtml(z.name)}</span>
      <span style="font-size:10px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;background:${badgeBg};color:${badge};padding:2px 8px;border-radius:999px;">${markTypeLabel(z.markType)}</span>
      ${rowLine}
      ${colLine}
    </div>`;
  }).join('\n');

  const legend = [
    { label: 'Text Table', bg: '#dbeafe', border: '#3b82f6', badge: '#1d4ed8', badgeBg: '#eff6ff' },
    { label: 'Map', bg: '#f1f5f9', border: '#94a3b8', badge: '#475569', badgeBg: '#e2e8f0' },
    { label: 'Bar / Line / Other', bg: '#dcfce7', border: '#22c55e', badge: '#15803d', badgeBg: '#f0fdf4' },
    { label: 'Quick Filter', bg: '#fffbeb', border: '#f59e0b', badge: '#b45309', badgeBg: '#fef3c7' },
    { label: 'Unsupported', bg: '#f8fafc', border: '#cbd5e1', badge: '#64748b', badgeBg: '#f1f5f9' },
  ].map((l) => `
    <span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;">
      <span style="width:14px;height:14px;border-radius:3px;background:${l.bg};border:1.5px solid ${l.border};display:inline-block;"></span>
      <span style="font-size:12px;color:#475569;">${l.label}</span>
    </span>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(workbook.metadata.name)} — Layout Preview</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Poppins', sans-serif;
      background: #f8fafc;
      min-height: 100vh;
      padding: 24px;
    }
    .header {
      margin-bottom: 16px;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
    }
    .header p {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 2px;
    }
    .meta {
      display: flex;
      gap: 20px;
      margin-bottom: 16px;
      font-size: 12px;
      color: #64748b;
    }
    .meta span strong { color: #334155; }
    .legend {
      margin-bottom: 16px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
    }
    .canvas-wrap {
      width: 100%;
      aspect-ratio: ${Math.round(totalW / totalH * 100) / 100};
      position: relative;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
      overflow: hidden;
    }
    .footer {
      margin-top: 12px;
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escHtml(workbook.metadata.name)}</h1>
    <p>Dashboard layout preview — generated by <a href="https://github.com/raguvindtharanitharan/drexo" style="color:#3b82f6;text-decoration:none;">drexo</a></p>
  </div>
  <div class="meta">
    <span><strong>Dashboard:</strong> ${escHtml(dashboard.name)}</span>
    <span><strong>Canvas:</strong> ${dashboard.size.width} × ${dashboard.size.height}</span>
    <span><strong>Zones:</strong> ${zones.length}</span>
    <span><strong>Workbook:</strong> ${escHtml(workbook.metadata.originalFilename)}</span>
  </div>
  <div class="legend">${legend}</div>
  <div class="canvas-wrap">
${zoneBlocks}
  </div>
  <div class="footer">Each zone represents one Tableau worksheet. Layout proportions are derived from dashboard zone coordinates.</div>
</body>
</html>`;
}

// ─── Local helpers ────────────────────────────────────────────────────────────

// Alias for layout-html: zone-helpers exports the canonical versions.
// zoneStyle wraps zoneColors for HTML (uses 'badge' key name).
function zoneStyle(mark: MarkType) {
  const c = zoneColors(mark);
  return { bg: c.bg, border: c.border, badge: c.badgeColor, badgeBg: c.badgeBg };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function errorHtml(msg: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;color:#ef4444;">${msg}</body></html>`;
}
