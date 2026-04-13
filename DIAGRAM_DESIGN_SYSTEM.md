# AgentOps SVG Diagram Design System

Design specification for all architecture and concept diagrams across the AgentOps documentation. Every SVG follows this single visual language — no diagram is an exception.

## Design Philosophy

**Minimal, precise, professional.** Inspired by CNCF projects (Flux, Helm, Argo CD) but adapted for our dark-theme documentation site. Diagrams should feel like they belong in a technical publication — dense with information, zero decoration for its own sake.

---

## Canvas & Background

| Property | Value | Notes |
|----------|-------|-------|
| **Background** | `#0a0e1a` → `#111827` linear gradient (135°) | Matches docs site `$body-bg: #09090b` zone |
| **Grid overlay** | 40px cell, `#1e293b` stroke, `0.08` opacity | Subtle engineering-paper feel, never distracting |
| **Corner radius** | `rx="12"` on canvas rect | Softens embedding in the docs site |
| **ViewBox sizing** | Width: 900–1200px. Height: proportional to content | Prefer landscape. Aim for 16:10 to 4:3 ratios |
| **Padding** | 40px minimum on all sides | Content never touches canvas edges |

### Canvas Template
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"
     font-family="'Geist', 'Inter', system-ui, -apple-system, sans-serif">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="#0a0e1a"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="0.5" opacity="0.3"/>
    </pattern>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#bgGrad)" rx="12"/>
  <rect width="{W}" height="{H}" fill="url(#grid)"/>
  <!-- content -->
</svg>
```

---

## Color Palette

Every component in the AgentOps stack has a fixed color identity. This is non-negotiable — the same component always gets the same color, across all diagrams.

### Component Colors

| Component | Primary | Light text | Gradient (top → bottom) | Glow | Usage |
|-----------|---------|-----------|------------------------|------|-------|
| **agentops-core** (Operator) | `#3b82f6` | `#93c5fd` | `#3b82f6` → `#2563eb` | `#3b82f6` @ 0.3 | Blue — reconciliation, control plane |
| **agentops-console** | `#10b981` | `#6ee7b7` | `#10b981` → `#059669` | `#10b981` @ 0.3 | Emerald — user-facing, streaming |
| **agentops-runtime** (Agent Pods) | `#ec4899` | `#f9a8d4` | `#ec4899` → `#db2777` | `#ec4899` @ 0.3 | Pink — runtime, execution |
| **agentops-memory** | `#8b5cf6` | `#c4b5fd` | `#8b5cf6` → `#7c3aed` | `#8b5cf6` @ 0.25 | Violet — memory, knowledge |
| **agent-tools** (MCP) | `#06b6d4` | `#67e8f9` | `#06b6d4` → `#0891b2` | `#06b6d4` @ 0.3 | Cyan — tools, MCP protocol |
| **Tempo** (Observability) | `#f59e0b` | `#fcd34d` | `#f59e0b` → `#d97706` | `#f59e0b` @ 0.3 | Amber — traces, observability |
| **Channels** (Chat) | `#a855f7` | `#c4b5fd` | `#a855f7` → `#7c3aed` | `#a855f7` @ 0.3 | Purple — chat channels |
| **Channels** (Event) | `#f97316` | `#fdba74` | `#f97316` → `#ea580c` | `#f97316` @ 0.3 | Orange — event channels |
| **Platform** (Umbrella) | `#6366f1` | `#a5b4fc` | `#6366f1` → `#8b5cf6` | `#8b5cf6` @ 0.25 | Indigo — umbrella chart |

### Structural Colors

| Element | Color | Opacity |
|---------|-------|---------|
| Namespace border | `#334155` | 0.4 |
| Namespace label text | `#64748b` | 1.0 |
| Component card background | `#1e293b` | 1.0 |
| Subtle annotation text | `#475569` | 1.0 |
| Arrow label text | Uses arrow color | 0.8 |
| Muted connection lines | `#94a3b8` | 0.35–0.5 |
| Legend background | `#0f172a` | 1.0 |
| Watermark text | `#334155` | 1.0 |

---

## Typography

All text is sans-serif. Two font stacks depending on render environment:

```
font-family: 'Geist', 'Inter', system-ui, -apple-system, sans-serif
```

### Text Hierarchy

| Role | Size | Weight | Color | Tracking |
|------|------|--------|-------|----------|
| **Diagram title** | 18–20px | 700 | `#e2e8f0` | `letter-spacing: 2` |
| **Component name** (primary) | 14–15px | 700 | Component light text | 0 |
| **Component subtitle** | 11px | 400 | `#64748b` | 0 |
| **Component detail** | 10px | 400 | `#475569` | 0 |
| **Namespace label** | 10px | 600 | `#64748b` | `letter-spacing: 1` |
| **Arrow label** | 10–11px | 500 | Arrow color | 0 |
| **Badge / pill text** | 7–9px | 500–600 | Component light text | 0 |
| **Legend entry** | 10px | 400 | `#94a3b8` | 0 |
| **Watermark** | 11px | 500 | `#334155` | `letter-spacing: 2` |

### Rules

- All text is **horizontal**. Never rotate text for readability.
- Use `text-anchor="middle"` for component names centered in cards.
- Labels on angled arrows may use `transform="rotate()"` but keep angle < 30°.

---

## Component Cards

Every service/component is rendered as a **card** — a rounded rectangle with a colored top accent bar.

### Card Anatomy

```
┌─────────────────────────────┐  ← 4px tall accent bar (component gradient fill)
│                             │
│     Component Name          │  ← Primary text (component light color)
│     Subtitle                │  ← Secondary text (#64748b)
│     Detail line 1           │  ← Detail text (#475569)
│     Detail line 2           │
│                             │
└─────────────────────────────┘
```

### Card Specification

| Property | Value |
|----------|-------|
| Background fill | `#1e293b` |
| Border | Component primary color, `stroke-width: 1.5` |
| Corner radius | `rx="8"` |
| Accent bar | Same rect, `height="4"`, filled with component gradient |
| Glow filter | Gaussian blur `stdDeviation="4"`, component color at 0.25–0.3 opacity |
| Min width | 180px |
| Min height | 80px |
| Internal padding | ~15px conceptual padding (position text accordingly) |

### Card SVG Template

```xml
<!-- Glow layer -->
<g filter="url(#glow-{component})">
  <rect x="X" y="Y" rx="8" ry="8" width="W" height="H"
        fill="#1e293b" stroke="{primary}" stroke-width="1.5"/>
</g>
<!-- Accent bar -->
<rect x="X" y="Y" rx="8" ry="8" width="W" height="4"
      fill="url(#{component}Grad)"/>
<!-- Text -->
<text x="{cx}" y="{Y+32}" text-anchor="middle"
      fill="{lightText}" font-size="15" font-weight="700">{Name}</text>
<text x="{cx}" y="{Y+52}" text-anchor="middle"
      fill="#64748b" font-size="11">{Subtitle}</text>
```

---

## Namespace Regions

Kubernetes namespaces are drawn as **dashed rounded rectangles** containing component cards.

| Property | Value |
|----------|-------|
| Fill | `none` (transparent) |
| Stroke | `#334155` |
| Stroke width | 1 |
| Dash pattern | `stroke-dasharray="8,4"` |
| Corner radius | `rx="8"` |
| Label position | Top-left inside, 20px from left edge, 22px from top |
| Label format | `NAMESPACE: {name}` — all caps, small, `#64748b` |
| Opacity | 0.4 on the border |

---

## Connections & Arrows

### Arrow Markers

Every connection color gets its own marker definition:

```xml
<marker id="arrow-{color}" markerWidth="8" markerHeight="6"
        refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
  <path d="M0,0 L8,3 L0,6 Z" fill="{color}"/>
</marker>
```

### Line Types

| Type | Stroke width | Dash | Opacity | When to use |
|------|-------------|------|---------|-------------|
| **Primary flow** | 2.5 | solid | 0.9 | Main data paths (reconciliation, FEP/SSE, memory) |
| **Secondary flow** | 1.5 | `6,3` | 0.7 | Proxy, indirect connections |
| **Tertiary / background** | 1.5 | `3,3` | 0.25–0.35 | Trace paths, passive relationships |
| **Bidirectional** | 2.5 + 2.5 | solid + `4,3` | 0.9 + 0.5 | Two parallel lines, offset 20px |

### Routing Rules

- **Orthogonal routing preferred** — straight lines with right-angle bends.
- **Diagonal allowed** when orthogonal would create excessive visual clutter.
- **Never use curves/beziers.** Straight segments only.
- Connections are drawn FIRST (behind all cards) in the SVG layer order.
- Arrow labels sit ON or BESIDE the line in the arrow's color, 10–11px, weight 500.

---

## Pills / Badges

Small inline indicators for sub-components (e.g., tool source types, API endpoints):

| Property | Value |
|----------|-------|
| Height | 18–24px |
| Corner radius | `rx="4"` |
| Background | Dark tinted variant of component color |
| Border | Component accent, `stroke-width: 0.5–0.75` |
| Text | Component light text, 7–10px, weight 500–600 |
| Spacing | 4–6px gap between pills |

---

## Legend

Every diagram with more than 2 connection types includes a legend box in the bottom-right.

| Property | Value |
|----------|-------|
| Background | `#0f172a` |
| Border | `#1e293b`, `stroke-width: 1` |
| Corner radius | `rx="8"` |
| Title | `PROTOCOL LEGEND`, 11px, weight 600, `#94a3b8` |
| Entry format | 40px colored line sample + 10px label in `#94a3b8` |
| Vertical spacing | 18px between entries |

---

## Glow Filters

Each component color gets a dedicated glow filter. Glow is subtle — it shouldn't compete with the content.

```xml
<filter id="glow-{name}" x="-20%" y="-20%" width="140%" height="140%">
  <feGaussianBlur stdDeviation="4" result="blur"/>
  <feFlood flood-color="{primary}" flood-opacity="0.3"/>
  <feComposite in2="blur" operator="in"/>
  <feMerge>
    <feMergeNode/>
    <feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>
```

- `stdDeviation`: 4 for standard components, 6 for oversized regions (platform umbrella).
- `flood-opacity`: 0.25–0.3 (never above 0.35).

---

## Layout Conventions

### Flow Direction

- **Primary flow: top → bottom** — control plane at top, workloads below
- **Secondary flow: left → right** — external actors left, Kubernetes workloads right
- Entry points (user, external channels) are always at the top or left edge

### Spatial Organization

- **Namespace regions** stack vertically with 30–40px gap between them
- **Cards within a namespace** are arranged in a single row where possible
- **Sub-components** (tools, sidecars) appear INSIDE or directly below their parent card
- **Generous whitespace** — minimum 30px gap between cards, 20px card content margin

### Z-Order (SVG layer order)

1. Background (gradient + grid)
2. Connection lines and arrows (drawn behind everything)
3. Namespace region borders
4. Component cards (with glow filters)
5. Text and labels
6. Legend box
7. Watermark

---

## Watermark

Every diagram ends with a bottom-center watermark:

```xml
<text x="{W/2}" y="{H-10}" text-anchor="middle"
      fill="#334155" font-size="11" letter-spacing="2"
      font-weight="500">{DIAGRAM TITLE}</text>
```

---

## Diagram Catalog

Planned diagrams for the documentation site, all following this design system:

| # | Diagram | Location in docs | Scope |
|---|---------|-----------------|-------|
| 1 | **Platform Architecture** | Getting Started > Architecture | Full component overview, two-namespace model, all connections |
| 2 | **Operator Reconciliation** | Getting Started > Architecture (or Concepts > Agents) | CRD reconciliation flows, channel bridges, agent lifecycle |
| 3 | **Memory Flow** | Concepts > Memory | Three-layer memory model, context injection, write dedup |
| 4 | **User Interaction Flow** | Concepts > Console | Console → BFF → Agent → FEP stream sequence |
| 5 | **Tool Execution** | Concepts > Tools | AgentTool sources, OCI init containers, MCP gateway, stdio chain |
| 6 | **Trace Flow** | Concepts > Observability | OTLP export paths from all components to Tempo |
| 7 | **Delegation Flow** | Concepts > Delegation | run_agent tool → AgentRun CR → reconciler → agent task/daemon |
| 8 | **Channel Architecture** | Guides > Multi-Agent (or Concepts) | Chat/event channel types, bridge deployments, webhook ingress |
| 9 | **Platform vs. User Ecosystem** | Getting Started > Architecture | Platform control plane vs. user-declared CRD workloads |

---

## File Conventions

- **Location**: `static/images/` in the Hugo docs site (`agentops/`)
- **Naming**: `{slug}.svg` — e.g., `architecture.svg`, `memory-flow.svg`, `delegation-flow.svg`
- **Per-repo copies**: repos (agentops-core, agentops-runtime) may keep a copy in `docs/` but the Hugo site's `static/images/` is the source of truth
- **Embedding in markdown**: `![Alt text](/images/{slug}.svg)` or via Hugo shortcode

---

## Anti-Patterns (What NOT to do)

- **No 3D effects, drop shadows on cards, or perspective transforms**
- **No curved/bezier connection lines** — orthogonal or diagonal only
- **No random colors** — every element uses the palette defined above
- **No decorative icons or clip-art** — text labels are sufficient
- **No gradient fills on card bodies** — only the accent bar and glow use gradients
- **No white or light backgrounds** — all diagrams are dark theme
- **No external font dependencies** — Geist/Inter/system-ui fallback chain
- **No text smaller than 7px** — minimum legibility threshold
- **No opacity below 0.2** on any visible element — if it's not visible, remove it
