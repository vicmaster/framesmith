import './test-env.js';
// Smoke for batch_design's operations parser. Targets the recently-fixed bug
// where embedded single quotes inside double-quoted strings were clobbered
// (e.g. `fontFamily: "system-ui, 'Segoe UI', sans-serif"`), plus regression
// coverage for the existing single-quoted-string / bare-word-value / unquoted-
// key idioms the parser already supports.
//
// Usage: npx tsx test-ops-parser.ts

import { parseAndExecute } from './src/operations.js';
import type { SceneNode } from './src/types.js';

interface Case {
  name: string;
  ops: string;
  expect: (node: SceneNode) => boolean | string; // true | error message
}

const cases: Case[] = [
  {
    name: "fontFamily with embedded 'Segoe UI' (the bug)",
    ops: `I("document", { type: "text", content: "x", fontFamily: "system-ui, 'Segoe UI', sans-serif" })`,
    expect: (root) => {
      const child = root.children?.[0];
      const want = "system-ui, 'Segoe UI', sans-serif";
      return child?.fontFamily === want || `got fontFamily=${JSON.stringify(child?.fontFamily)} expected ${JSON.stringify(want)}`;
    },
  },
  {
    name: 'single-quoted string value',
    ops: `I("document", { type: 'frame', fill: '#FF0000' })`,
    expect: (root) => {
      const child = root.children?.[0];
      return (child?.type === 'frame' && child?.fill === '#FF0000') || `got ${JSON.stringify(child)}`;
    },
  },
  {
    name: 'escaped single quote inside single-quoted string',
    ops: `I("document", { type: "text", content: 'it\\'s working' })`,
    expect: (root) => {
      const child = root.children?.[0];
      return child?.content === "it's working" || `got content=${JSON.stringify(child?.content)}`;
    },
  },
  {
    name: 'bare-word value still becomes string',
    ops: `I("document", { type: "frame", layout: horizontal })`,
    expect: (root) => {
      const child = root.children?.[0];
      return child?.layout === 'horizontal' || `got layout=${JSON.stringify(child?.layout)}`;
    },
  },
  {
    name: 'unquoted keys still work',
    ops: `I("document", { type: "frame", width: 200, fill: "#00FF00" })`,
    expect: (root) => {
      const child = root.children?.[0];
      return (child?.width === 200 && child?.fill === '#00FF00') || `got ${JSON.stringify(child)}`;
    },
  },
  {
    name: "double-quoted value with apostrophe (e.g. content: \"it's fine\")",
    ops: `I("document", { type: "text", content: "it's fine" })`,
    expect: (root) => {
      const child = root.children?.[0];
      return child?.content === "it's fine" || `got content=${JSON.stringify(child?.content)}`;
    },
  },
  // Issue #228 — the README's own examples, pasted as written.
  {
    name: 'multi-line op (README donut shape)',
    ops: `I("document", { type: "chart", kind: "donut", width: 176, height: 176, centerValue: "1,204", centerLabel: "forms",
  segments: [
    { value: 385, color: "#2563EB", label: "North" },
    { value: 289, color: "#16A34A", label: "Highlands" }
  ] })`,
    expect: (root) => {
      const child = root.children?.[0];
      return (root.children?.length === 1 && child?.type === 'chart' && (child as any).segments?.length === 2 && (child as any).centerValue === '1,204')
        || `got ${JSON.stringify(root.children)}`;
    },
  },
  {
    name: 'full-line # comments between ops (README intro shape)',
    ops: `# Insert a frame into the document root
header=I("document", { type: "frame", fill: "#1a1a2e" })

  # Insert text into the header — it's a comment, apostrophe and all
I(header, { type: "text", content: "My App" })`,
    expect: (root) => {
      const header = root.children?.[0];
      return (root.children?.length === 1 && header?.fill === '#1a1a2e' && header?.children?.[0]?.content === 'My App')
        || `got ${JSON.stringify(root.children)}`;
    },
  },
  {
    name: 'trailing // comments inside a multi-line op (README chart shape)',
    ops: `I("document", { type: "chart", kind: "line", width: 600, height: 220,
  series: [
    { data: [1, 2, 3], stroke: "#111111", area: true },   // actual
    { data: [2, 3, 4], stroke: "#999999" }  // target
  ] })`,
    expect: (root) => {
      const series = (root.children?.[0] as any)?.series;
      return (series?.length === 2 && series[0].area === true && series[1].stroke === '#999999') || `got series=${JSON.stringify(series)}`;
    },
  },
  {
    name: '# and // inside strings are not comments',
    ops: `I("document", { type: "image", fill: "#ff0000", src: "https://example.com/a.png", content: "Issue #12 // keep" })`,
    expect: (root) => {
      const c = root.children?.[0];
      return (c?.fill === '#ff0000' && c?.src === 'https://example.com/a.png' && c?.content === 'Issue #12 // keep')
        || `got ${JSON.stringify(c)}`;
    },
  },
  {
    name: 'parens and brackets inside string content do not split the op',
    ops: `I("document", { type: "text", content: "Total (incl. tax [est.]" })
I("document", { type: "text", content: "next" })`,
    expect: (root) => {
      const [a, b] = root.children ?? [];
      return (root.children?.length === 2 && a?.content === 'Total (incl. tax [est.]' && b?.content === 'next')
        || `got ${JSON.stringify(root.children)}`;
    },
  },
  {
    name: 'single-line ops still parse one per line',
    ops: `a=I("document", { type: "frame" })\nI(a, { type: "text", content: "1" })\nI(a, { type: "text", content: "2" })`,
    expect: (root) => {
      const a = root.children?.[0];
      return (root.children?.length === 1 && a?.children?.length === 2) || `got ${JSON.stringify(root.children)}`;
    },
  },
];

// An unbalanced op must still fail with the existing error (stop-on-first-error).
{
  const root: SceneNode = { id: 'document', type: 'document', children: [] };
  const results = parseAndExecute(root, `I("document", { type: "frame" }\nI("document", { type: "text", content: "x" })`);
  const last = results[results.length - 1];
  if (!last || last.ok || !/Unmatched parentheses/.test(last.error ?? '')) {
    console.log(`FAIL  unbalanced op still errors with Unmatched parentheses\n      got ${JSON.stringify(results)}`);
    process.exitCode = 1;
  } else {
    console.log('PASS  unbalanced op still errors with Unmatched parentheses');
  }
}

let allPass = true;
for (const c of cases) {
  const root: SceneNode = { id: 'document', type: 'document', children: [] };
  const results = parseAndExecute(root, c.ops);
  const opOk = results.every((r) => r.ok);
  if (!opOk) {
    allPass = false;
    console.log(`FAIL  ${c.name}\n      op error: ${results.find((r) => !r.ok)?.error}`);
    continue;
  }
  const verdict = c.expect(root);
  if (verdict === true) {
    console.log(`PASS  ${c.name}`);
  } else {
    allPass = false;
    console.log(`FAIL  ${c.name}\n      ${verdict}`);
  }
}

process.exit(allPass && !process.exitCode ? 0 : 1);