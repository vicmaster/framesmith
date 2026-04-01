import type { DesignVariables } from './types.js';
import type { Preset } from './presets.js';

/**
 * Parses a DESIGN.md file (Google Stitch / awesome-design-md format)
 * and extracts design tokens into canvas-mcp's DesignVariables format.
 */
export function parseDesignMd(content: string, name?: string): Preset {
  const systemName = name ?? extractName(content);
  const colors = extractColors(content);
  const typography = extractTypography(content);
  const spacing = extractSpacing(content);
  const radius = extractRadius(content);
  const description = extractDescription(content);

  const variables: DesignVariables = {};
  if (Object.keys(colors).length) variables.colors = colors;
  if (Object.keys(typography).length) variables.typography = typography;
  if (Object.keys(spacing).length) variables.spacing = spacing;
  if (Object.keys(radius).length) variables.radius = radius;

  return {
    name: slugify(systemName),
    description: description || `Design system: ${systemName}`,
    variables,
  };
}

function extractName(content: string): string {
  // Look for "# Design System: Name" or first H1
  const match = content.match(/^#\s+(?:Design System:\s*)?(.+)/m);
  return match ? match[1].trim() : 'imported';
}

function extractDescription(content: string): string {
  // Pull from "Visual Theme & Atmosphere" section — first sentence
  const section = getSection(content, 'Visual Theme');
  if (!section) return '';
  const firstSentence = section.match(/^[^#\n].*?\./);
  return firstSentence ? firstSentence[0].trim() : '';
}

/**
 * Extract colors from "Color Palette & Roles" section.
 * Looks for patterns like: **Name** (`#hex`) or (`rgba(...)`)
 */
function extractColors(content: string): Record<string, string> {
  const section = getSection(content, 'Color Palette');
  if (!section) return {};

  const colors: Record<string, string> = {};
  // Match: **Label** (`#hex`) or **Label** (`rgba(...)`)
  const pattern = /\*\*([^*]+)\*\*\s*\(`([^`]+)`\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(section)) !== null) {
    const label = slugify(match[1].trim());
    const value = match[2].trim();
    // Only keep actual color values
    if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) {
      colors[label] = value;
    }
  }

  return colors;
}

/**
 * Extract typography from "Typography Rules" section.
 * Parses the markdown table with columns: Role, Font, Size, Weight, Line Height, Letter Spacing
 */
function extractTypography(content: string): Record<string, { fontSize: number; fontWeight?: string | number; fontFamily?: string; lineHeight?: number | string }> {
  const section = getSection(content, 'Typography');
  if (!section) return {};

  const typography: Record<string, { fontSize: number; fontWeight?: string | number; fontFamily?: string; lineHeight?: number | string }> = {};

  // Extract font family from "### Font Family" subsection
  let primaryFont: string | undefined;
  const fontMatch = section.match(/\*\*Primary\*\*:\s*`([^`]+)`/);
  if (fontMatch) {
    const fontName = fontMatch[1].trim();
    // Build a fallback stack
    const fallbackMatch = section.match(/fallback[s]?:\s*`?([^`\n]+)`?/i);
    primaryFont = fallbackMatch
      ? `${fontName}, ${fallbackMatch[1].trim()}`
      : `${fontName}, system-ui, sans-serif`;
  }

  let monoFont: string | undefined;
  const monoMatch = section.match(/\*\*Monospace\*\*:\s*`([^`]+)`/);
  if (monoMatch) {
    monoFont = `${monoMatch[1].trim()}, monospace`;
  }

  // Parse the hierarchy table
  const tableLines = section.split('\n').filter(line => line.startsWith('|') && !line.match(/^\|\s*-/));
  if (tableLines.length < 2) return typography;

  // Find column indices from header
  const header = tableLines[0];
  const cols = header.split('|').map(c => c.trim().toLowerCase());
  const roleIdx = cols.findIndex(c => c === 'role');
  const sizeIdx = cols.findIndex(c => c === 'size');
  const weightIdx = cols.findIndex(c => c === 'weight');
  const lineHeightIdx = cols.findIndex(c => c.includes('line height'));
  const letterSpacingIdx = cols.findIndex(c => c.includes('letter'));
  const fontIdx = cols.findIndex(c => c === 'font');

  for (let i = 1; i < tableLines.length; i++) {
    const cells = tableLines[i].split('|').map(c => c.trim());
    const role = cells[roleIdx];
    if (!role) continue;

    const sizeStr = cells[sizeIdx] || '';
    const sizeMatch = sizeStr.match(/(\d+)px/);
    if (!sizeMatch) continue;

    const fontSize = parseInt(sizeMatch[1], 10);
    const weightStr = cells[weightIdx] || '';
    const weightMatch = weightStr.match(/(\d+)/);
    const fontWeight = weightMatch ? parseInt(weightMatch[1], 10) : undefined;

    const lineHeightStr = cells[lineHeightIdx] || '';
    const lhMatch = lineHeightStr.match(/([\d.]+)/);
    const lineHeight = lhMatch ? parseFloat(lhMatch[1]) : undefined;

    // Determine font family
    const cellFont = fontIdx >= 0 ? cells[fontIdx] || '' : '';
    let fontFamily: string | undefined;
    if (cellFont.toLowerCase().includes('mono') || cellFont.toLowerCase().includes('code')) {
      fontFamily = monoFont || `${cellFont}, monospace`;
    } else {
      fontFamily = primaryFont;
    }

    const key = slugify(role);
    const entry: { fontSize: number; fontWeight?: number; fontFamily?: string; lineHeight?: number } = { fontSize };
    if (fontWeight !== undefined) entry.fontWeight = fontWeight;
    if (fontFamily) entry.fontFamily = fontFamily;
    if (lineHeight !== undefined) entry.lineHeight = lineHeight;

    typography[key] = entry;
  }

  return typography;
}

/**
 * Extract spacing from "Layout Principles" section.
 * Looks for spacing scales or base unit definitions.
 */
function extractSpacing(content: string): Record<string, number> {
  const section = getSection(content, 'Layout Principles') || getSection(content, 'Spacing');
  if (!section) return {};

  const spacing: Record<string, number> = {};

  // Look for "Base unit: Npx"
  const baseMatch = section.match(/[Bb]ase\s+unit:\s*(\d+)px/);
  const base = baseMatch ? parseInt(baseMatch[1], 10) : 8;

  // Always generate a clean scale from the base unit — explicit scales in DESIGN.md
  // are often too dense (every 2px) to map well to named tokens.
  spacing.xs = Math.round(base * 0.5);
  spacing.sm = base;
  spacing.md = base * 2;
  spacing.lg = base * 3;
  spacing.xl = base * 4;
  spacing['2xl'] = base * 6;

  return spacing;
}

/**
 * Extract border radius from "Component Stylings" section.
 */
function extractRadius(content: string): Record<string, number> {
  const section = getSection(content, 'Component Styling') || getSection(content, 'Component');
  if (!section) return {};

  const radius: Record<string, number> = {};
  const radiusValues: number[] = [];

  // Collect all radius/border-radius values mentioned
  const radiusPattern = /[Rr]adius:\s*(\d+)px/g;
  let match: RegExpExecArray | null;
  while ((match = radiusPattern.exec(section)) !== null) {
    radiusValues.push(parseInt(match[1], 10));
  }

  // Also look for "border-radius" in inline style patterns
  const borderRadiusPattern = /border-radius[:\s]+(\d+)px/g;
  while ((match = borderRadiusPattern.exec(section)) !== null) {
    radiusValues.push(parseInt(match[1], 10));
  }

  // Check for pill/full radius (9999px)
  if (section.includes('9999')) {
    radiusValues.push(9999);
  }

  if (radiusValues.length === 0) return {};

  // Deduplicate and sort
  const unique = [...new Set(radiusValues)].filter(v => v > 0).sort((a, b) => a - b);

  // Map to sm/md/lg/full
  const nonFull = unique.filter(v => v < 100);
  const hasFull = unique.some(v => v >= 100);

  if (nonFull.length >= 3) {
    radius.sm = nonFull[0];
    radius.md = nonFull[Math.floor(nonFull.length / 2)];
    radius.lg = nonFull[nonFull.length - 1];
  } else if (nonFull.length === 2) {
    radius.sm = nonFull[0];
    radius.md = nonFull[1];
    radius.lg = nonFull[1] * 2;
  } else if (nonFull.length === 1) {
    radius.sm = nonFull[0];
    radius.md = nonFull[0] * 2;
    radius.lg = nonFull[0] * 4;
  }

  if (hasFull) radius.full = 9999;

  return radius;
}

// --- Helpers ---

/** Get a section by partial heading match (## N. Title) */
function getSection(content: string, headingSearch: string): string | null {
  const lines = content.split('\n');
  const search = headingSearch.toLowerCase();
  let start = -1;
  let level = 0;

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (!headingMatch) continue;

    if (start === -1) {
      if (headingMatch[2].toLowerCase().includes(search)) {
        start = i + 1;
        level = headingMatch[1].length;
      }
    } else {
      // End at same or higher level heading
      if (headingMatch[1].length <= level) {
        return lines.slice(start, i).join('\n');
      }
    }
  }

  if (start !== -1) {
    return lines.slice(start).join('\n');
  }

  return null;
}

/** Pick N well-distributed values from a sorted array */
function pickDistributed(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr;
  const result: number[] = [arr[0]]; // always include first
  const step = (arr.length - 1) / (n - 1);
  for (let i = 1; i < n - 1; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  result.push(arr[arr.length - 1]); // always include last
  return [...new Set(result)];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
