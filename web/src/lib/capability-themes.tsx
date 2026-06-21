/**
 * Capability/tool theming module.
 *
 * Provides branded SVG icons, category detection, color themes, and labels
 * for tool call cards and agent detail panels. Ported from the old codebase
 * with full support for Kubernetes, Helm, GitHub, GitLab, Terraform, etc.
 */
import type { Component } from "solid-js";

// =============================================================================
// SVG ICONS — Branded tool/platform icons
// =============================================================================

export const KubernetesIcon: Component<{ class?: string }> = (props) => (
  <svg viewBox="0 160 777 754" class={props.class} fill="none">
    {/* Blue heptagon shield */}
    <path d="M386.93 178.6a48.9 48.9 0 0 0-18.75 4.74L112.31 305.6a48.9 48.9 0 0 0-26.48 32.92L22.71 613.15a48.9 48.9 0 0 0 9.42 41.07L209.24 874.42a48.9 48.9 0 0 0 38.26 18.26l284.02-.07a48.9 48.9 0 0 0 38.25-18.23L746.81 654.15a48.9 48.9 0 0 0 9.46-41.07L693.04 338.46a48.9 48.9 0 0 0-26.47-32.92L410.66 183.34a48.9 48.9 0 0 0-23.73-4.74z" fill="currentColor" opacity="0.15" />
    {/* White wheel — spokes, hub, heptagonal ring */}
    <path d="M389.47 272.06c-8.46 0-15.32 7.62-15.32 17.02 0 .14.03.28.03.42-.01 1.28-.07 2.82-.03 3.93.2 5.42 1.38 9.57 2.09 14.56 1.29 10.69 2.37 19.55 1.7 27.78-.65 3.11-2.93 5.95-4.97 7.92l-.36 6.48c-9.19.76-18.44 2.16-27.69 4.25-39.77 9.03-74.01 29.51-100.07 57.17l-5.53-3.93c-2.73.37-5.5 1.21-9.1-.88-6.85-4.61-13.1-10.98-20.65-18.65-3.46-3.67-5.97-7.16-10.08-10.7-.93-.8-2.36-1.89-3.4-2.72-3.21-2.56-7.01-3.9-10.67-4.03-4.71-.16-9.24 1.68-12.21 5.4-5.27 6.61-3.58 16.72 3.76 22.58l.23.16c1.01.82 2.25 1.87 3.17 2.55 4.36 3.22 8.35 4.87 12.7 7.43 9.16 5.66 16.75 10.35 22.78 16 2.35 2.51 2.76 6.93 3.08 8.84l4.9 4.38c-26.28 39.55-38.44 88.39-31.25 138.16l-6.41 1.87c-1.69 2.18-4.08 5.62-6.58 6.64-7.88 2.48-16.75 3.39-27.46 4.52-5.03.42-9.36.17-14.69 1.18-1.17.22-2.81.65-4.09.95l-.13.03-.23.07c-9.03 2.18-14.83 10.48-12.96 18.65 1.87 8.18 10.68 13.15 19.77 11.19l.23-.03.29-.1c1.27-.28 2.85-.59 3.96-.88 5.24-1.4 9.03-3.46 13.74-5.27 10.13-3.63 18.53-6.67 26.7-7.85 3.42-.27 7.01 2.1 8.8 3.1l6.68-1.14c15.36 47.63 47.56 86.13 88.32 110.28l-2.78 6.68c1 2.59 2.11 6.1 1.36 8.66-2.97 7.71-8.06 15.85-13.86 24.92-2.81 4.19-5.68 7.44-8.21 12.24-.61 1.15-1.38 2.91-1.96 4.12-3.94 8.42-1.05 18.12 6.51 21.76 7.61 3.66 17.05-.2 21.14-8.64l.03-.03v-.03c.58-1.2 1.41-2.77 1.9-3.9 2.17-4.97 2.89-9.23 4.42-14.04 4.05-10.18 6.28-20.86 11.86-27.51 1.53-1.82 4.02-2.52 6.6-3.21l3.47-6.28c35.54 13.64 75.32 17.3 115.06 8.28 9.07-2.06 17.82-4.72 26.28-7.92l3.27 5.89c2.62.85 5.49 1.29 7.82 4.75 4.17 7.13 7.03 15.57 10.5 25.75 1.53 4.81 2.28 9.07 4.45 14.04.5 1.13 1.32 2.73 1.9 3.93 4.08 8.47 13.55 12.34 21.17 8.67 7.56-3.64 10.45-13.34 6.51-21.76-.59-1.21-1.39-2.98-2-4.12-2.53-4.8-5.4-8.02-8.21-12.21-5.8-9.07-10.61-16.61-13.58-24.31-1.24-3.98.21-6.45 1.18-9.03l-2.55-6.18c42.37-25.02 73.62-64.95 88.29-111.07l6.54 1.15c2.3-1.52 4.42-3.5 8.57-3.17 8.18 1.18 16.57 4.22 26.7 7.85 4.71 1.8 8.5 3.9 13.75 5.3 1.1.3 2.69.57 3.96.85l.29.1.23.03c9.08 1.96 17.9-3.01 19.77-11.19 1.86-8.18-3.93-16.47-12.96-18.65-1.31-.3-3.18-.81-4.45-1.05-5.33-1.01-9.67-.76-14.7-1.18-10.7-1.12-19.57-2.03-27.45-4.52-3.21-1.24-5.5-5.07-6.61-6.64l-6.19-1.8c3.21-23.2 2.34-47.34-3.2-71.5-5.6-24.38-15.5-46.68-28.7-66.33l5.43-4.88c.25-2.75.04-5.63 2.88-8.67 6.02-5.66 13.62-10.35 22.78-16 4.35-2.56 8.37-4.21 12.73-7.43.99-.73 2.33-1.88 3.37-2.72 7.35-5.86 9.04-15.97 3.76-22.58-5.27-6.61-15.5-7.23-22.84-1.37-1.05.83-2.46 1.91-3.4 2.72-4.11 3.54-6.65 7.03-10.11 10.7-7.55 7.67-13.8 14.07-20.65 18.69-2.97 1.73-7.32 1.13-9.29 1.01l-5.83 4.16c-30.2-36.58-72.93-63.25-123.04-71.14l-.36-6.84c-1.99-1.91-4.4-3.54-5.01-7.66-.67-8.23.45-17.09 1.73-27.78.71-4.99 1.89-9.14 2.1-14.56.04-1.23-.03-3.02-.03-4.35 0-9.4-6.86-17.02-15.32-17.02zm-19.18 118.79l-4.55 80.34-.33.16c-.3 7.19-6.22 12.93-13.48 12.93-2.97 0-5.72-.96-7.95-2.59l-.13.07-65.87-46.7c20.25-19.91 46.14-34.62 75.99-41.4 5.45-1.24 10.9-2.16 16.33-2.81zm38.39 0c34.84 4.29 67.07 20.06 91.76 44.24l-65.45 46.4-.23-.1c-5.81 4.24-13.99 3.19-18.52-2.49-1.85-2.32-2.83-5.06-2.95-7.82l-.06-.03-4.55-80.2zm-154.59 74.22l60.15 53.8-.07.33c5.43 4.72 6.23 12.91 1.7 18.59-1.85 2.33-4.34 3.88-7 4.61l-.07.26-77.1 22.25c-3.92-35.88 4.53-70.76 22.38-99.84zm270.34.03c8.94 14.49 15.7 30.66 19.73 48.2 3.98 17.33 4.98 34.63 3.34 51.35l-77.49-22.32-.07-.33c-6.94-1.9-11.2-8.96-9.59-16.04.66-2.9 2.2-5.35 4.29-7.17l-.03-.16 59.82-53.54zM377.13 523.02h24.64l15.32 19.14-5.5 23.89-22.12 10.64-22.19-10.67-5.5-23.89zm79 65.51c1.05-.05 2.09.04 3.1.23l.13-.16 79.75 13.48c-11.67 32.79-34 61.2-63.85 80.21l-30.96-74.78.1-.13c-2.84-6.61 0-14.36 6.54-17.51 1.68-.81 3.43-1.25 5.17-1.34zm-133.94.33c6.09.09 11.54 4.31 12.96 10.5.66 2.9.34 5.77-.75 8.31l.23.3-30.63 74.02c-28.64-12.38-51.45-38.9-63.65-72.66l79.06-13.42.13.16c.88-.16 1.78-.24 2.65-.23zm66.79 32.43c2.12-.08 4.27.36 6.32 1.34 2.68 1.29 4.75 3.32 6.05 5.76h.3l38.97 70.42c-5.06 1.7-10.26 3.14-15.58 4.35-29.81 6.77-59.52 4.72-86.43-4.45l38.88-70.29h.07c2.33-4.36 6.76-6.96 11.42-7.13z" fill="currentColor" />
  </svg>
);

export const HelmIcon: Component<{ class?: string }> = (props) => (
  <svg viewBox="0 0 32 32" class={props.class} fill="currentColor">
    <path d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0zm0 2c7.732 0 14 6.268 14 14s-6.268 14-14 14S2 23.732 2 16 8.268 2 16 2zm-1 5v3h2V7h-2zm-5.5 2.134l-1.732 1 1.5 2.598 1.732-1-1.5-2.598zm13 0l-1.5 2.598 1.732 1 1.5-2.598-1.732-1zM16 12a4 4 0 100 8 4 4 0 000-8zm-8.5 4.268l-1.732 1 1.5 2.598 1.732-1-1.5-2.598zm17 0l-1.5 2.598 1.732 1 1.5-2.598-1.732-1zM9.768 20.232l-1.5 2.598 1.732 1 1.5-2.598-1.732-1zm12.464 0l-1.732 1 1.5 2.598 1.732-1-1.5-2.598zM15 23v3h2v-3h-2z"/>
  </svg>
);

export const GitHubIcon: Component<{ class?: string }> = (props) => (
  <svg viewBox="0 0 24 24" class={props.class} fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

export const GitLabIcon: Component<{ class?: string }> = (props) => (
  <svg viewBox="0 0 24 24" class={props.class} fill="currentColor">
    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
  </svg>
);

export const TerraformIcon: Component<{ class?: string }> = (props) => (
  <svg viewBox="0 0 24 24" class={props.class} fill="currentColor">
    <path d="M1.5 0v8.35l7.24 4.18V4.18L1.5 0zm8.74 4.18v8.35l7.24-4.18V0L10.24 4.18zM10.24 13.7v8.35l7.24-4.18V9.52L10.24 13.7zM18.98 4.18v8.35L22.5 10.5V2.15L18.98 4.18z"/>
  </svg>
);

/** AgentOps branded icon — uses the platform logo PNG */
export const AgentOpsIcon: Component<{ class?: string }> = (props) => (
  <img src="/logo.png" alt="" class={props.class} draggable={false} />
);

// =============================================================================
// TOOL CATEGORY DETECTION
// =============================================================================

export type ToolCategory =
  | "agentops"
  | "kubernetes"
  | "helm"
  | "github"
  | "gitlab"
  | "terraform"
  | "database"
  | "slack"
  | "mcp"
  | "builtin"
  | "generic";

/**
 * Detect the category of a tool or capability by name.
 * When a capability spec is provided, uses the CRD's authoritative
 * type and containerType fields instead of name-guessing.
 */
export function detectToolCategory(
  name: string,
  capability?: { spec: { type?: string; container?: { containerType?: string } } },
): ToolCategory {
  // If we have CRD data, use it authoritatively
  if (capability?.spec?.type) {
    const crdType = capability.spec.type;

    if (crdType === "Container" && capability.spec.container?.containerType) {
      const ct = capability.spec.container.containerType;
      if (ct === "kubernetes") return "kubernetes";
      if (ct === "helm") return "helm";
      if (ct === "github") return "github";
      if (ct === "gitlab") return "gitlab";
    }

    if (crdType === "MCP" || crdType === "Skill" || crdType === "Tool" || crdType === "Plugin") {
      const domain = detectDomainFromName(name);
      if (domain) return domain;
      if (crdType === "MCP") return "mcp";
      return "generic";
    }
  }

  const lower = name.toLowerCase();

  // AgentOps internal tools — first-class branded cards
  const agentopsTools = ["run_agent", "get_agent_run"];
  if (agentopsTools.includes(lower)) return "agentops";

  // Built-in tools
  const builtins = [
    "bash", "read", "write", "edit", "glob", "grep", "ls",
    "webfetch", "fetch", "task", "todowrite", "todoread", "question", "skill",
  ];
  if (builtins.includes(lower)) return "builtin";

  // Capability-based tools (substring match)
  return detectDomainFromName(name) || "generic";
}

/** Try to detect a domain category from a capability/tool name via substring matching. */
function detectDomainFromName(name: string): ToolCategory | null {
  const lower = name.toLowerCase();
  if (lower.includes("kubectl") || lower.includes("kubernetes") || lower.includes("k8s") || lower.includes("kube")) return "kubernetes";
  if (lower.includes("helm")) return "helm";
  if (lower.includes("github") || lower.includes("gh-")) return "github";
  if (lower.includes("gitlab") || lower.includes("glab")) return "gitlab";
  if (lower.includes("git") && !lower.includes("github") && !lower.includes("gitlab")) return "generic";
  if (lower.includes("terraform") || lower.includes("tf-")) return "terraform";
  if (lower.includes("postgres") || lower.includes("mysql") || lower.includes("database") || lower.includes("redis") || lower.includes("mongo")) return "database";
  if (lower.includes("slack")) return "slack";
  if (lower.includes("mcp-") || lower.includes("mcp_")) return "mcp";
  return null;
}

// =============================================================================
// THEMED ACCENT MAPS — gradient backgrounds, branded borders, watermarks
// =============================================================================

export interface ToolTheme {
  border: string;
  bg: string;
  headerBg: string;
  iconColor: string;
  badge: string;
  watermark: string;
}

export const toolThemes: Record<ToolCategory, ToolTheme> = {
  agentops: {
    border: "border-indigo-400/30",
    bg: "bg-gradient-to-br from-indigo-500/8 via-purple-500/5 to-cyan-500/3",
    headerBg: "bg-gradient-to-r from-indigo-500/12 via-purple-500/8 to-transparent",
    iconColor: "",
    badge: "bg-indigo-500/15 text-indigo-300",
    watermark: "opacity-[0.07]",
  },
  kubernetes: {
    border: "border-blue-500/30",
    bg: "bg-gradient-to-br from-blue-500/5 to-blue-600/2",
    headerBg: "bg-gradient-to-r from-blue-500/10 to-transparent",
    iconColor: "text-blue-400",
    badge: "bg-blue-500/15 text-blue-400",
    watermark: "text-blue-400/[0.08]",
  },
  helm: {
    border: "border-cyan-500/30",
    bg: "bg-gradient-to-br from-cyan-500/5 to-cyan-600/2",
    headerBg: "bg-gradient-to-r from-cyan-500/10 to-transparent",
    iconColor: "text-cyan-400",
    badge: "bg-cyan-500/15 text-cyan-400",
    watermark: "text-cyan-400/[0.04]",
  },
  github: {
    border: "border-white/15",
    bg: "bg-gradient-to-br from-white/[0.03] to-white/[0.01]",
    headerBg: "bg-gradient-to-r from-white/[0.06] to-transparent",
    iconColor: "text-gray-300",
    badge: "bg-white/10 text-gray-300",
    watermark: "text-white/[0.03]",
  },
  gitlab: {
    border: "border-orange-500/30",
    bg: "bg-gradient-to-br from-orange-500/5 to-orange-600/2",
    headerBg: "bg-gradient-to-r from-orange-500/10 to-transparent",
    iconColor: "text-orange-400",
    badge: "bg-orange-500/15 text-orange-400",
    watermark: "text-orange-400/[0.04]",
  },
  terraform: {
    border: "border-purple-500/30",
    bg: "bg-gradient-to-br from-purple-500/5 to-purple-600/2",
    headerBg: "bg-gradient-to-r from-purple-500/10 to-transparent",
    iconColor: "text-purple-400",
    badge: "bg-purple-500/15 text-purple-400",
    watermark: "text-purple-400/[0.04]",
  },
  database: {
    border: "border-emerald-500/30",
    bg: "bg-gradient-to-br from-emerald-500/5 to-emerald-600/2",
    headerBg: "bg-gradient-to-r from-emerald-500/10 to-transparent",
    iconColor: "text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-400",
    watermark: "text-emerald-400/[0.04]",
  },
  slack: {
    border: "border-pink-500/30",
    bg: "bg-gradient-to-br from-pink-500/5 to-pink-600/2",
    headerBg: "bg-gradient-to-r from-pink-500/10 to-transparent",
    iconColor: "text-pink-400",
    badge: "bg-pink-500/15 text-pink-400",
    watermark: "text-pink-400/[0.04]",
  },
  mcp: {
    border: "border-indigo-500/30",
    bg: "bg-gradient-to-br from-indigo-500/5 to-indigo-600/2",
    headerBg: "bg-gradient-to-r from-indigo-500/10 to-transparent",
    iconColor: "text-indigo-400",
    badge: "bg-indigo-500/15 text-indigo-400",
    watermark: "text-indigo-400/[0.04]",
  },
  builtin: {
    border: "",
    bg: "",
    headerBg: "",
    iconColor: "text-text-muted",
    badge: "",
    watermark: "",
  },
  generic: {
    border: "border-text-muted/20",
    bg: "bg-gradient-to-br from-text-muted/[0.03] to-transparent",
    headerBg: "bg-gradient-to-r from-text-muted/[0.06] to-transparent",
    iconColor: "text-text-muted",
    badge: "bg-text-muted/10 text-text-muted",
    watermark: "text-text-muted/[0.03]",
  },
};

// =============================================================================
// CATEGORY HELPERS
// =============================================================================

/** Return the branded SVG icon component for a tool category. */
export function getCategoryIcon(category: ToolCategory): Component<{ class?: string }> {
  switch (category) {
    case "agentops":   return AgentOpsIcon;
    case "kubernetes": return KubernetesIcon;
    case "helm":       return HelmIcon;
    case "github":     return GitHubIcon;
    case "gitlab":     return GitLabIcon;
    case "terraform":  return TerraformIcon;
    case "database":   return (p) => <svg class={p.class} fill="none" stroke="currentColor" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
    case "slack":      return (p) => <svg class={p.class} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 15a2 2 0 01-2 2h-2v2a2 2 0 01-4 0v-6a2 2 0 012-2h4a2 2 0 012 2zM3 9a2 2 0 012-2h2V5a2 2 0 014 0v6a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>;
    case "mcp":        return (p) => <svg class={p.class} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25"/></svg>;
    default:           return (p) => <svg class={p.class} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M12 5l7 7-7 7"/></svg>;
  }
}

/** Friendly display name for a tool category, or null for builtin/generic. */
export function getCategoryLabel(category: ToolCategory): string | null {
  switch (category) {
    case "agentops":   return "AgentOps";
    case "kubernetes": return "Kubernetes";
    case "helm":       return "Helm";
    case "github":     return "GitHub";
    case "gitlab":     return "GitLab";
    case "terraform":  return "Terraform";
    case "database":   return "Database";
    case "slack":      return "Slack";
    case "mcp":        return "MCP";
    default:           return null;
  }
}

/** Human-readable display name for built-in tools */
export function getToolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    bash: "Terminal",
    read: "Read File",
    write: "Write File",
    edit: "Edit File",
    glob: "Find Files",
    ls: "List Files",
    grep: "Search",
    fetch: "Web Fetch",
    webfetch: "Web Fetch",
    task: "Sub-Agent",
    todowrite: "Todo List",
    todoread: "Todo List",
    question: "Question",
    skill: "Skill",
    run_agent: "Run Agent",
    get_agent_run: "Agent Run",
  };
  return names[toolName] || toolName.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
