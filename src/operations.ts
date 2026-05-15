import type { Canvas, SceneNode } from './types.js';
import { insertNode, updateNode, deleteNode, copyNode, moveNode, replaceNode, findNode } from './scene-graph.js';

interface OperationResult {
  ok: boolean;
  nodeId?: string;
  error?: string;
}

export function parseAndExecute(root: SceneNode, operationsStr: string, canvas?: Canvas): OperationResult[] {
  const lines = operationsStr.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const bindings = new Map<string, string>();
  bindings.set('document', root.id);

  const results: OperationResult[] = [];

  for (const line of lines) {
    try {
      const result = executeLine(root, line, bindings, canvas);
      results.push(result);
    } catch (err) {
      results.push({ ok: false, error: (err as Error).message });
      break; // Stop on first error
    }
  }

  return results;
}

function resolveId(ref: string, bindings: Map<string, string>): string {
  // Handle concatenation: foo+"/childId" or "literal"+"/more"
  const parts = ref.split('+').map((p) => p.trim());
  let resolved = '';
  for (const part of parts) {
    const unquoted = part.replace(/^["']|["']$/g, '');
    if (bindings.has(unquoted)) {
      resolved += bindings.get(unquoted)!;
    } else if (bindings.has(part)) {
      resolved += bindings.get(part)!;
    } else {
      resolved += unquoted;
    }
  }
  // If the result contains "/", take the last segment as the actual ID
  if (resolved.includes('/')) {
    const segments = resolved.split('/');
    return segments[segments.length - 1];
  }
  return resolved;
}

function extractArgs(line: string, startIdx: number): string {
  // Extract everything inside the outer parentheses
  let depth = 0;
  let start = -1;
  for (let i = startIdx; i < line.length; i++) {
    if (line[i] === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (line[i] === ')') {
      depth--;
      if (depth === 0) return line.substring(start, i);
    }
  }
  throw new Error(`Unmatched parentheses in: ${line}`);
}

function parseJsonArg(str: string): Record<string, unknown> {
  // Find the JSON object in the string by matching braces
  let braceStart = -1;
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') {
      if (depth === 0) braceStart = i;
      depth++;
    } else if (str[i] === '}') {
      depth--;
      if (depth === 0) {
        const jsonStr = str.substring(braceStart, i + 1);
        // Convert single-quoted strings to double-quoted, but leave single
        // quotes inside existing double-quoted values alone (e.g. CSS-style
        // `fontFamily: "system-ui, 'Segoe UI', sans-serif"`).
        const quoteNormalized = normalizeQuotes(jsonStr);
        // Quote unquoted object keys.
        const keysQuoted = quoteNormalized.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
        // Quote bare-word values (e.g. horizontal → "horizontal"), preserving literals.
        const valuesQuoted = keysQuoted.replace(/:\s*([a-zA-Z_]\w*)(\s*[,}])/g, (match, val, after) => {
          if (['true', 'false', 'null'].includes(val)) return match;
          return `: "${val}"${after}`;
        });
        return JSON.parse(valuesQuoted);
      }
    }
  }
  return {};
}

// Walks the input emitting a JSON-compatible string:
//   - Inside a double-quoted span: pass through verbatim (so `'` stays as `'`).
//   - On `'`: open a single-quoted span and re-emit as a double-quoted string,
//     escaping any embedded `"` and respecting backslash escapes (`\'` → `'`).
function normalizeQuotes(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < s.length) {
        const ch = s[i];
        if (ch === '\\' && i + 1 < s.length) {
          out += ch + s[i + 1];
          i += 2;
          continue;
        }
        out += ch;
        i++;
        if (ch === '"') break;
      }
    } else if (c === "'") {
      out += '"';
      i++;
      while (i < s.length) {
        const ch = s[i];
        if (ch === '\\' && i + 1 < s.length) {
          out += s[i + 1] === "'" ? "'" : ch + s[i + 1];
          i += 2;
          continue;
        }
        if (ch === "'") {
          out += '"';
          i++;
          break;
        }
        out += ch === '"' ? '\\"' : ch;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function splitArgs(argsStr: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (inString) {
      current += ch;
      if (ch === stringChar && argsStr[i - 1] !== '\\') inString = false;
    } else if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      current += ch;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function executeLine(root: SceneNode, line: string, bindings: Map<string, string>, canvas?: Canvas): OperationResult {
  // Check for binding: varName=OP(...)
  let bindingName: string | undefined;
  const bindingMatch = line.match(/^(\w+)\s*=\s*([A-Z])\s*\(/);
  if (bindingMatch) {
    bindingName = bindingMatch[1];
  }

  // Detect operation
  const opMatch = line.match(/(?:\w+\s*=\s*)?([A-Z])\s*\(/);
  if (!opMatch) throw new Error(`Invalid operation: ${line}`);

  const op = opMatch[1];
  const argsStr = extractArgs(line, line.indexOf(op + '(') >= 0 ? line.indexOf(op + '(') + 1 : line.indexOf('('));
  const args = splitArgs(argsStr);

  switch (op) {
    case 'I': {
      // Insert: binding=I("parentId", { ...props })
      const parentId = resolveId(args[0], bindings);
      const props = args.length > 1 ? parseJsonArg(args.slice(1).join(',')) : {};
      if (!props.type) props.type = 'frame';
      // Resolve componentId binding for instances
      if (props.type === 'instance' && props.componentId && typeof props.componentId === 'string') {
        props.componentId = bindings.get(props.componentId as string) ?? props.componentId;
      }
      const node = insertNode(root, parentId, props as Partial<SceneNode> & { type: SceneNode['type'] });
      // Register component in canvas registry
      if (node.type === 'component' && canvas) {
        canvas.components[node.id] = node;
      }
      if (bindingName) bindings.set(bindingName, node.id);
      return { ok: true, nodeId: node.id };
    }

    case 'U': {
      // Update: U("nodeId", { ...props })
      const nodeId = resolveId(args[0], bindings);
      const props = args.length > 1 ? parseJsonArg(args.slice(1).join(',')) : {};
      const node = updateNode(root, nodeId, props as Partial<SceneNode>);
      return { ok: true, nodeId: node.id };
    }

    case 'D': {
      // Delete: D("nodeId")
      const nodeId = resolveId(args[0], bindings);
      deleteNode(root, nodeId);
      return { ok: true };
    }

    case 'C': {
      // Copy: binding=C("sourceId", "parentId", { ...overrides })
      const sourceId = resolveId(args[0], bindings);
      const parentId = resolveId(args[1], bindings);
      const overrides = args.length > 2 ? parseJsonArg(args.slice(2).join(',')) : undefined;
      const node = copyNode(root, sourceId, parentId, overrides as Partial<SceneNode> | undefined);
      if (bindingName) bindings.set(bindingName, node.id);
      return { ok: true, nodeId: node.id };
    }

    case 'M': {
      // Move: M("nodeId", "parentId", index?)
      const nodeId = resolveId(args[0], bindings);
      const parentId = resolveId(args[1], bindings);
      const index = args.length > 2 ? parseInt(args[2], 10) : undefined;
      moveNode(root, nodeId, parentId, index);
      return { ok: true };
    }

    case 'R': {
      // Replace: binding=R("nodeId", { ...newData })
      const nodeId = resolveId(args[0], bindings);
      const props = args.length > 1 ? parseJsonArg(args.slice(1).join(',')) : {};
      const node = replaceNode(root, nodeId, props as Partial<SceneNode>);
      if (bindingName) bindings.set(bindingName, node.id);
      return { ok: true, nodeId: node.id };
    }

    default:
      throw new Error(`Unknown operation: ${op}`);
  }
}
