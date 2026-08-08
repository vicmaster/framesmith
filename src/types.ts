export type NodeType = 'frame' | 'text' | 'rectangle' | 'ellipse' | 'image' | 'icon' | 'component' | 'instance' | 'document' | 'path'
  // Phase 16 — input primitives: static, token-styled control renders.
  | 'toggle' | 'checkbox' | 'radio' | 'select'
  // Phase 24 slice B — loading-placeholder block (token-derived neutral;
  // pulses only in the live viewer, static in screenshots/exports/diffs).
  | 'skeleton'
  // Phase 22 slice F — data-driven chart (line/bar): the node does the
  // value→coordinate math, so a chart edit is a data edit.
  | 'chart';

/** Phase 22 slice F (#129) — one plotted series of a `chart` node. X positions
 * are data indexes (0-based); a series shorter than the chart's x-range stops
 * early (e.g. 7 booked months against a 12-month target line). */
export interface ChartSeries {
  data: number[];
  /** Series name — reserved for a future legend; not rendered in v1. */
  label?: string;
  /** Line / bar color. `$token` refs resolve; defaults cycle a neutral ramp. */
  stroke?: string;
  strokeWidth?: number;
  /** Dash pattern ("6 4" or [6, 4]) — the projected/forecast convention. Lines only. */
  strokeDasharray?: string | number[];
  /** Fill under the line at ~12% opacity. Lines only. */
  area?: boolean;
  /** Dot markers on each data point. Lines only. */
  points?: boolean;
}

/** Phase 22 slice A — a single border side. `style` defaults to "solid";
 * "dashed"/"dotted" cover the forecast/placeholder/draft conventions. */
export interface BorderSide {
  width: number;
  color: string;
  style?: 'solid' | 'dashed' | 'dotted';
}

/** One layer of a box shadow — used on nodes (`shadows`) and as the value
 * shape of `$elevation.*` tokens (Phase 27). */
export interface ShadowSpec {
  x: number; y: number; blur: number; spread?: number;
  color: string; inset?: boolean;
}

export interface SceneNode {
  id: string;
  type: NodeType;
  name?: string;
  children?: SceneNode[];

  // Layout
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  layout?: 'horizontal' | 'vertical' | 'grid' | 'none';
  gap?: number;
  /** grid only (Phase 26 slice A) — row-axis gap override; `gap` covers both
   * axes otherwise. */
  rowGap?: number;
  /** grid container — the column template: a count (3 → three equal columns),
   * an array of fr weights and/or CSS lengths ([2, 1, "240px"]), or a raw
   * template string (sanitized; unsafe values fall back to equal columns). */
  gridColumns?: number | (number | string)[] | string;
  /** grid children — cell placement: a number means "span N"; strings accept
   * "span N" or "a / b" line syntax. */
  gridColumn?: number | string;
  gridRow?: number | string;
  padding?: number | [number, number] | [number, number, number, number];
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
  wrap?: boolean;

  // Responsive layout hint. Authored desktop-first; the renderer adapts down.
  //   stack — horizontal layout flips to vertical below the mobile breakpoint
  //   wrap  — children wrap to the next line instead of overflowing
  //   fixed — never reflows (e.g. toolbars). Marker today; reserved for future
  //           opt-out of descendant fluid scaling.
  responsive?: 'stack' | 'wrap' | 'fixed';

  // Position (when layout is 'none' on parent)
  x?: number;
  y?: number;
  position?: 'absolute' | 'relative';

  // Visual
  fill?: string;
  /** Phase 22 slice A — one side of a per-side border (row rules, accent bars).
   * Composable with `stroke`: the all-sides border renders first, a per-side
   * entry wins on its side (CSS cascade order). */
  borderTop?: BorderSide;
  borderRight?: BorderSide;
  borderBottom?: BorderSide;
  borderLeft?: BorderSide;
  gradient?: {
    type: 'linear' | 'radial';
    angle?: number;
    stops: Array<{ color: string; position?: number }>;
  };
  stroke?: string;
  strokeWidth?: number;
  /** Line style for the all-sides `stroke` border (frames). Default "solid". */
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  cornerRadius?: number | [number, number, number, number];
  opacity?: number;
  overflow?: 'visible' | 'hidden' | 'auto';
  /** Designed single-line truncation (text nodes): nowrap + hidden +
   * text-overflow ellipsis, with min-width 0 so flex rows let it shrink.
   * canvas_stress reports a clip behind it as info ("designed truncation
   * engaged"), not a warning — the sanctioned fix for labels that must
   * survive hostile-length content. */
  textOverflow?: 'ellipsis';
  shadow?: string;
  shadows?: ShadowSpec[];
  blur?: number;
  backdropBlur?: number;
  /** Composable backdrop filter functions. Each field is numeric:
   * `blur` in px; `saturate`/`brightness`/`contrast` as percentage values
   * where `100` is the identity (`saturate: 180` → `saturate(180%)`).
   * If `backdropFilter` is set it takes precedence over `backdropBlur`. */
  backdropFilter?: {
    blur?: number;
    saturate?: number;
    brightness?: number;
    contrast?: number;
  };

  // Text
  content?: string;
  /** px number, or a CSS length expression string (e.g. the clamp() forms
   * generate_scale emits in fluid mode). */
  fontSize?: number | string;
  fontFamily?: string;
  fontWeight?: number | string;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number | string;
  letterSpacing?: number;
  textDecoration?: string;
  textTransform?: string;
  /** Raw CSS font-variation-settings value, e.g. `"wght" 650, "opsz" 24`.
   * Needed for variable fonts and icon fonts whose axes aren't covered by fontWeight. */
  fontVariationSettings?: string;

  // Image
  src?: string;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none';

  // Icon — `icon` accepts a Lucide name ("search") or a Material Symbols
  // reference ("material:check"; "-fill" suffix = filled variant).
  icon?: string;
  iconSize?: number;
  iconColor?: string;
  /** Material Symbols style variant; ignored for Lucide. Default "outlined". */
  iconStyle?: 'outlined' | 'rounded' | 'sharp';

  // Input primitives (toggle / checkbox / radio / select) — static renders;
  // `checked` is a prop, not behavior. Colors default from design tokens
  // ($accent / $border / $bg-surface / $text-primary with neutral fallbacks);
  // fill / stroke / color override them.
  checked?: boolean;
  disabled?: boolean;
  /** select only: the displayed value; absent renders a muted placeholder. */
  value?: string;
  /** skeleton only: set false to opt a block out of the live-viewer pulse.
   * Screenshots/exports/diffs are ALWAYS static regardless (determinism). */
  pulse?: boolean;
  /** text only (Phase 25 slice A): render digits with tabular (fixed-width)
   * figures so number columns align vertically. Defaults on for chart tick
   * labels and the table scaffolds; harmless on non-numeric text. */
  tabularNums?: boolean;

  // SVG path (only for type: 'path'). Inherits fill/stroke/strokeWidth from
  // the standard SceneNode fields; viewBox defaults to `0 0 width height`.
  d?: string;
  viewBox?: string;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  /** SVG dash pattern for path strokes — "6 4" or [6, 4]. The convention for
   * projected/forecast lines vs solid actuals. */
  strokeDasharray?: string | number[];

  // CSS animation, referencing a built-in keyframe. The renderer auto-emits
  // the `@keyframes` block only when any node references the name.
  animation?: {
    name: 'fadeIn' | 'slideUp' | 'slideDown' | 'scaleIn';
    duration?: number;   // ms, default 300
    delay?: number;      // ms, default 0
    easing?: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear';
    iteration?: number | 'infinite';
  };

  // CSS transition. Note: transitions only fire on state change (hover, focus,
  // JS-driven property change). Inert in static renders today — included so a
  // future PR that adds pseudo-class or interactive state has a place to land.
  transition?: {
    property?: string;   // e.g. 'all', 'opacity', 'transform'. Identifier chars only.
    duration: number;    // ms
    easing?: string;     // named easing or cubic-bezier(...) — unsafe values fall back to 'ease'
    delay?: number;      // ms
  } | string;            // "$motion.<name>" — resolves to the motion token's { duration, easing }

  // Chart (only for type: 'chart'). Sized by width/height like any node;
  // fill/stroke/cornerRadius style the box, series carry the plot colors.
  kind?: 'line' | 'bar';
  series?: ChartSeries[];
  /** Index range plotted on x (default [0, longestSeries - 1]). */
  xDomain?: [number, number];
  /** Value range on y (default: min/max across series; bars floor at 0). */
  yDomain?: [number, number];
  curve?: 'linear' | 'smooth';
  /** Count of horizontal hairlines spread evenly across the plot (incl. baseline + top when >= 2). */
  gridlines?: number;
  /** Tick labels spread evenly along the bottom / left edge. */
  xLabels?: string[];
  yLabels?: string[];

  // Component / Instance
  componentId?: string;
  overrides?: Record<string, Partial<SceneNode>>;
}

export interface DesignVariables {
  colors?: Record<string, string>;
  spacing?: Record<string, number>;
  radius?: Record<string, number>;
  typography?: Record<string, { fontSize: number | string; fontWeight?: string | number; fontFamily?: string; lineHeight?: number | string; letterSpacing?: number }>;
  /** Phase 25 slice D — the dark theme as a SPARSE override layer keyed by
   * token NAME: anything not overridden inherits the light value. Rendering
   * and evaluation merge it over `colors` when theme = "dark"; storage stays
   * one flat, diffable object per layer. */
  dark?: {
    colors?: Record<string, string>;
    /** Phase 27 — dark-theme elevation overrides (sparse, keyed by token
     * name): light-tuned shadows read wrong on dark surfaces, so the dark
     * layer re-states depth instead of inheriting it. */
    elevation?: Record<string, ShadowSpec[]>;
  };
  /** Phase 25 slice E — motion tokens (the Carbon/Atlassian pattern):
   * duration + easing packaged under a name, referenced from `transition`
   * as the string "$motion.<name>". */
  motion?: Record<string, { duration: number; easing: string }>;
  /** Phase 27 — elevation (shadow) tokens, referenced from a node as
   * `shadow: "$elevation.<name>"` (the `$motion` dotted pattern). Semantic
   * names by convention: flat / raised / floating / overlay. */
  elevation?: Record<string, ShadowSpec[]>;
}

/** Custom font face declaration. Renderer emits a single `@font-face` rule
 * per entry plus a `<link rel="preconnect">` per unique origin so the browser
 * can warm the connection before the first font request fires. */
export interface FontFace {
  /** Family name used in `fontFamily` (no quotes). */
  family: string;
  /** Direct binary URL (.woff2/.woff/.ttf/.otf) — `https://`, `http://`, or
   * `data:` URIs. (Google Fonts css2 stylesheet URLs are accepted by the
   * set_fonts tool, which extracts the binary faces before they land here.) */
  url: string;
  weight?: number | string;
  style?: 'normal' | 'italic';
}

/** Phase 11 — independent taxonomy axes a layout structure is tagged on, so
 * "differs from the last canvas" is a computable set diff, not a vibe. Every
 * structure sets all four; the diversification signal and Phase 13's "variety"
 * rubric axis both read them, so keep the names/values stable. */
export interface StructureAxes {
  heroTreatment: 'none' | 'marquee' | 'split' | 'stat-led' | 'editorial';
  density: 'airy' | 'balanced' | 'dense';
  rhythm: 'uniform' | 'alternating' | 'asymmetric';
  alignment: 'centered' | 'left' | 'split';
}

/** Phase 11 — a named page structure: a partial scene tree of labeled
 * placeholder children plus its taxonomy tags. Distinct from a preset — presets
 * carry tokens/components, structures carry the layout skeleton. Placeholders
 * are labeled neutral blocks (never fabricated data) and reference `$token`s so
 * an applied preset themes them. Registered in `src/structures.ts`. */
export interface Structure {
  name: string;
  description: string;
  /** Phase 16 — granularity: 'page' (default) stamps a whole-page scaffold at
   * the canvas root; 'component' stamps a reusable fragment (table, form
   * field, …) under any target node, repeatably, with re-keyed IDs. */
  kind?: 'page' | 'component';
  /** Taxonomy tags — page structures only (the diversification signal and the
   * "variety" rubric axis read them; component stamps don't shape the page). */
  axes?: StructureAxes;
  /** Placeholder children inserted under `canvas.root` by `apply_structure`. */
  nodes: SceneNode[];
}

/** Phase 11 — provenance stamp recorded on `Canvas.metadata`: which structure /
 * preset / axes produced a canvas. Lives in the open metadata bag so Phases 12
 * (cliche flags) and 13 (rubric verdict) extend it without a further migration. */
export interface Provenance {
  structure?: string;
  preset?: string;
  axes?: Partial<StructureAxes>;
  /** Phase 17 — set when the canvas was imported from an implementation:
   * 'html' for snippets, or the source URL. Auth material is never recorded. */
  importedFrom?: string;
  /** Reserved for a future "pick a structure for me" auto-selector; unused in v1.1. */
  seed?: string;
  /** ISO-8601 timestamp when the stamp was written. */
  at: string;
}

/** Phase 13 — rubric critique verdict stamped on `Canvas.metadata.critique`.
 * Distinct from `provenance` (what *produced* the canvas); this is *how good* it
 * is. The full rubric lives here; the build log keeps only a compact summary. */
export interface CritiqueVerdict {
  rubric: Record<string, { score: number; rationale: string }>;
  /** 0–100 derived from the rubric. */
  overall: number;
  needsRevision: boolean;
  model: string;
  /** ISO-8601 timestamp. */
  at: string;
}

/** Phase 21 — a point-and-tell comment the user left in the viewer, anchored
 * to a node (or to the canvas as a whole when `nodeId` is absent). Lives on
 * `Canvas.metadata.feedback` so it travels with the canvas (git-diffable in
 * bound repos) and reaches a running server via the ensureFresh mtime reload.
 * `node` is a snapshot captured at comment time so the entry stays meaningful
 * after the node changes or is deleted (orphan resilience — C4). */
export interface FeedbackEntry {
  /** "fb-" + random suffix; unique within the canvas. */
  id: string;
  /** Anchor node. Absent = canvas-level note ("whole thing feels cramped"). */
  nodeId?: string;
  comment: string;
  /** ISO-8601 timestamp when the comment was written. */
  at: string;
  /** Snapshot of the anchor at comment time (text truncated to ~80 chars). */
  node?: { type: string; name?: string; text?: string };
  resolvedAt?: string;
  resolvedBy?: 'agent' | 'user';
  /** The agent's reply when resolving — tells the user what changed. */
  resolutionNote?: string;
}

/** Phase 11 — one per-project build-log entry: a provenance record plus the
 * canvas it describes. The diversification signal reads the last N entries to
 * steer the next canvas toward differing on >= 1 axis. */
export interface BuildLogEntry extends Provenance {
  canvasId: string;
  canvasName: string;
  /** Phase 13 — compact critique verdict for auditability across the build log
   * (the full rubric stays on the canvas's metadata). Optional / back-compat. */
  critiqueOverall?: number;
  needsRevision?: boolean;
}

export interface Canvas {
  id: string;
  name: string;
  root: SceneNode;
  variables: DesignVariables;
  /** Custom font faces emitted into the rendered document head. */
  fonts?: FontFace[];
  components: Record<string, SceneNode>;
  createdAt: string;
  lastModified: string;
  /**
   * Every canvas belongs to exactly one project. On migration, canvases
   * without `projectId` are assigned to the default project (`DEFAULT_PROJECT_ID`).
   */
  projectId: string;
  /** Soft-delete flag. Archived canvases stay in storage but are hidden from
   * the default gallery view. Permadelete is a separate action. */
  archived?: boolean;
  archivedAt?: string;
  /** Phase 11 — open metadata bag. `provenance` records which structure / preset
   * / axes produced this canvas (feeds the per-project build log + diversification
   * signal). Optional, so existing canvases load unchanged with no migration.
   * Phases 12/13 extend this bag (cliche flags, rubric verdict) in place. */
  metadata?: {
    provenance?: Provenance;
    /** Phase 13 — latest rubric critique verdict (LLM judge). */
    critique?: CritiqueVerdict;
    /** Phase 21 — point-and-tell comments from the viewer. */
    feedback?: FeedbackEntry[];
    /** Phase 24 slice A — marks this canvas as a STATE VARIANT (empty /
     * loading / error / …) of a base canvas. Variants are sibling canvases
     * cloned from the base; the viewer groups them and the coverage check
     * (slice C) counts them. */
    variant?: VariantLink;
    [key: string]: unknown;
  };
}

/** Phase 24 slice A — the link a state-variant canvas carries back to its base.
 * `state` is a free string; `empty` / `loading` / `error` are the recommended
 * (and, in slice C, demanded) vocabulary. */
export interface VariantLink {
  /** The base canvas this variant belongs to. */
  of: string;
  /** The state this canvas designs (e.g. "empty", "loading", "error"). */
  state: string;
  /** ISO-8601 timestamp when the variant was created. */
  at: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  /** Phase 9 — workspace-level design system inherited by every project +
   * canvas under it. Resolution order at render is canvas.variables (override)
   * → project.designSystem → workspace.designSystem → built-in defaults. */
  designSystem?: DesignVariables;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  /** Phase 9 — project-level overrides on top of the parent workspace's design
   * system. Sits between workspace and canvas in the resolution chain. */
  designSystem?: DesignVariables;
}

/** Stable IDs for the built-in defaults so migration is idempotent. */
export const DEFAULT_WORKSPACE_ID = 'default-workspace';
export const DEFAULT_PROJECT_ID = 'default-project';
