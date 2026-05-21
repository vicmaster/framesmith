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
];

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

process.exit(allPass ? 0 : 1);