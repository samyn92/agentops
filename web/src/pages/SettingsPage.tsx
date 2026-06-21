// SettingsPage — Material You theme park + Vercel-style preferences
import { For, Show, createMemo } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Switch as ArkSwitch } from '@ark-ui/solid/switch';
import { BackArrowIcon, PlusIcon } from '../components/shared/Icons';
import Tip from '../components/shared/Tip';
import {
  themeMode, setThemeMode,
  themeStyle, setThemeStyle,
  accentColor, setAccentColor,
  schemeVariant, setSchemeVariant,
  diffView, setDiffView,
  collapsedTools, setCollapsedTools,
  toolExpansionDefaults, setToolExpansionDefault, setAllToolExpansionDefaults,
  showSystemPrompts, setShowSystemPrompts,
  showThinkingBlocks, setShowThinkingBlocks,
  thinkingStyle, setThinkingStyle,
  KNOWN_TOOLS,
} from '../stores/settings';
import type { ThemeMode, ThemeStyle, ThinkingStyle, SchemeVariant } from '../stores/settings';
import { getToolDisplayName } from '../lib/capability-themes';
import { SCHEME_VARIANTS, generatePreviewPalette } from '../lib/theme';

// ── Accent color presets ──

const accentPresets = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Red', value: '#ef4444' },
];

// ── Shared components ──

function SettingSection(props: { title: string; description?: string; children: any }) {
  return (
    <div class="mb-8">
      <div class="mb-4">
        <h3 class="text-[13px] font-semibold text-text uppercase tracking-[0.05em]">{props.title}</h3>
        {props.description && (
          <p class="text-xs text-text-muted mt-1 leading-relaxed">{props.description}</p>
        )}
      </div>
      <div class="rounded-xl border border-border bg-surface overflow-hidden">
        {props.children}
      </div>
    </div>
  );
}

function SettingRow(props: { label: string; description?: string; children: any; last?: boolean }) {
  return (
    <div class={`flex items-center justify-between px-4 py-3.5 ${props.last ? '' : 'border-b border-border-subtle'}`}>
      <div class="min-w-0 mr-4">
        <p class="text-sm text-text font-medium">{props.label}</p>
        {props.description && (
          <p class="text-xs text-text-muted mt-0.5 leading-relaxed">{props.description}</p>
        )}
      </div>
      <div class="flex-shrink-0">
        {props.children}
      </div>
    </div>
  );
}

function SelectButton(props: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div class="flex rounded-lg border border-border overflow-hidden">
      {props.options.map((opt) => (
        <button
          class={`px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
            props.value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-surface text-text-secondary hover:bg-surface-hover'
          }`}
          onClick={() => props.onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <ArkSwitch.Root
      checked={props.checked}
      onCheckedChange={(details) => props.onChange(details.checked)}
      class="inline-flex"
    >
      <ArkSwitch.Control
        class={`relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer ${
          props.checked
            ? 'bg-accent'
            : 'bg-surface-2 border border-border'
        }`}
      >
        <ArkSwitch.Thumb
          class={`absolute top-0.5 w-5 h-5 rounded-full shadow-sm transition-all duration-200 ${
            props.checked
              ? 'left-[22px] bg-white'
              : 'left-0.5 bg-text-muted'
          }`}
        />
      </ArkSwitch.Control>
      <ArkSwitch.HiddenInput />
    </ArkSwitch.Root>
  );
}

// ── Accent color picker with live ring ──

function AccentColorPicker(props: { isMaterial: boolean }) {
  return (
    <div class={`px-4 py-4 ${props.isMaterial ? 'border-b border-border-subtle' : ''}`}>
      <div class="flex items-center justify-between mb-3">
        <div>
          <p class="text-sm text-text font-medium">Accent Color</p>
          <p class="text-xs text-text-muted mt-0.5">
            {props.isMaterial
              ? 'Seed color for the entire tonal palette'
              : 'Highlight color for interactive elements'}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div
            class="w-5 h-5 rounded-full border border-border"
            style={{ background: accentColor() }}
          />
          <span class="text-xs text-text-muted font-mono">{accentColor()}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <For each={accentPresets}>
          {(preset) => {
            const isActive = () => accentColor() === preset.value;
            return (
              <button
                class={`w-8 h-8 rounded-full transition-all duration-200 ring-offset-2 ring-offset-surface ${
                  isActive()
                    ? 'ring-2 ring-accent scale-110'
                    : 'hover:scale-105 hover:ring-1 hover:ring-border-hover'
                }`}
                style={{ background: preset.value }}
                onClick={() => setAccentColor(preset.value)}
                title={preset.name}
              />
            );
          }}
        </For>
        {/* Custom color input */}
        <Tip content="Custom color">
          <label
            class="w-8 h-8 rounded-full border-2 border-dashed border-border-hover flex items-center justify-center cursor-pointer hover:border-accent transition-colors group"
          >
            <PlusIcon class="w-3.5 h-3.5 text-text-muted group-hover:text-accent transition-colors" />
            <input
              type="color"
              class="sr-only"
              value={accentColor()}
              onInput={(e) => setAccentColor(e.currentTarget.value)}
          />
          </label>
        </Tip>
      </div>
    </div>
  );
}

// ── Material You scheme variant picker ──

function SchemeVariantPicker() {
  const isDark = () => {
    const mode = themeMode();
    if (mode === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches;
    return mode === 'dark';
  };

  return (
    <div class="px-4 py-4">
      <div class="mb-3">
        <p class="text-sm text-text font-medium">Scheme Variant</p>
        <p class="text-xs text-text-muted mt-0.5">How the accent color generates the full palette</p>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <For each={SCHEME_VARIANTS}>
          {(sv) => {
            const isActive = () => schemeVariant() === sv.value;
            const palette = createMemo(() =>
              generatePreviewPalette(accentColor(), isDark(), sv.value)
            );

            return (
              <button
                class={`scheme-card relative flex flex-col items-start p-3 rounded-xl border transition-all duration-200 text-left ${
                  isActive()
                    ? 'border-accent bg-surface-hover'
                    : 'border-border-subtle bg-surface hover:border-border-hover hover:bg-surface-hover/50'
                }`}
                onClick={() => setSchemeVariant(sv.value)}
                title={sv.description}
              >
                {/* Preview palette swatch bar */}
                <div class="flex w-full gap-0.5 mb-2.5 h-4 rounded-md overflow-hidden">
                  <div class="flex-1 rounded-l-md" style={{ background: palette().primary }} />
                  <div class="flex-1" style={{ background: palette().secondary }} />
                  <div class="flex-1" style={{ background: palette().tertiary }} />
                  <div class="flex-1" style={{ background: palette().container }} />
                  <div class="flex-1 rounded-r-md" style={{ background: palette().surface }} />
                </div>
                <span class={`text-xs font-medium ${isActive() ? 'text-accent' : 'text-text'}`}>
                  {sv.label}
                </span>
                {/* Active indicator dot */}
                <Show when={isActive()}>
                  <div class="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-accent" />
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

// ── Per-tool expansion row ──

function toolState(toolName: string): 'expanded' | 'collapsed' | 'default' {
  const defaults = toolExpansionDefaults();
  return defaults[toolName] || 'default';
}

function ToolExpansionRow(props: { tool: string; last?: boolean }) {
  const state = () => toolState(props.tool);

  const cycle = () => {
    const current = state();
    if (current === 'default') setToolExpansionDefault(props.tool, 'expanded');
    else if (current === 'expanded') setToolExpansionDefault(props.tool, 'collapsed');
    else setToolExpansionDefault(props.tool, 'expanded');
  };

  return (
    <div class={`flex items-center justify-between py-2.5 px-4 hover:bg-surface-hover/50 transition-colors ${props.last ? '' : 'border-b border-border-subtle'}`}>
      <span class="text-xs text-text-secondary font-mono">{getToolDisplayName(props.tool)}</span>
      <Tip content="Click to cycle: default -> expanded -> collapsed">
        <button
          class={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors ${
            state() === 'expanded'
              ? 'bg-success/15 text-success'
              : state() === 'collapsed'
              ? 'bg-warning/15 text-warning'
              : 'bg-surface-2 text-text-muted'
          }`}
          onClick={cycle}
        >
          {state() === 'expanded' ? 'Expanded' : state() === 'collapsed' ? 'Collapsed' : 'Default'}
        </button>
      </Tip>
    </div>
  );
}

// ── Main settings page ──

export default function SettingsPage() {
  const navigate = useNavigate();
  const isMaterial = () => themeStyle() === 'material';
  const toolsList = [...KNOWN_TOOLS];

  return (
    <div class="min-h-screen bg-background text-text">
      {/* Header */}
      <div class="border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/', { replace: true })} class="text-text-secondary hover:text-text transition-colors p-1 -ml-1 rounded-lg hover:bg-surface-hover">
          <BackArrowIcon class="w-5 h-5" />
        </button>
        <h1 class="text-lg font-semibold">Settings</h1>
      </div>

      {/* Settings content */}
      <div class="max-w-2xl mx-auto px-4 py-8">

        {/* ── Appearance ── */}
        <SettingSection title="Appearance" description="Control the visual style and color scheme">
          <SettingRow label="Theme" description="Color mode for the interface">
            <SelectButton
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' },
              ]}
              value={themeMode()}
              onChange={(v) => setThemeMode(v as ThemeMode)}
            />
          </SettingRow>

          <SettingRow label="Style" description="Design language for shape, motion, and surfaces" last>
            <SelectButton
              options={[
                { value: 'vercel', label: 'Vercel' },
                { value: 'material', label: 'Material You' },
              ]}
              value={themeStyle()}
              onChange={(v) => setThemeStyle(v as ThemeStyle)}
            />
          </SettingRow>
        </SettingSection>

        {/* ── Theme Palette ── */}
        <SettingSection
          title="Theme Palette"
          description={isMaterial()
            ? 'Material You generates an entire tonal palette from your seed color'
            : 'Choose the accent color for interactive elements'
          }
        >
          <AccentColorPicker isMaterial={isMaterial()} />
          <Show when={isMaterial()}>
            <SchemeVariantPicker />
          </Show>
        </SettingSection>

        {/* ── Editor ── */}
        <SettingSection title="Editor" description="Code display and tool behavior preferences">
          <SettingRow label="Diff View" description="How code diffs are displayed">
            <SelectButton
              options={[
                { value: 'unified', label: 'Unified' },
                { value: 'split', label: 'Split' },
              ]}
              value={diffView()}
              onChange={(v) => setDiffView(v as 'unified' | 'split')}
            />
          </SettingRow>

          <SettingRow label="Auto-collapse Tools" description="Collapse completed tool results by default">
            <Toggle
              checked={collapsedTools()}
              onChange={setCollapsedTools}
            />
          </SettingRow>

          <SettingRow label="Show System Prompts" description="Display system prompts in agent sidebar">
            <Toggle
              checked={showSystemPrompts()}
              onChange={setShowSystemPrompts}
            />
          </SettingRow>

          <SettingRow label="Show Thinking Blocks" description="Display LLM reasoning/thinking blocks in chat">
            <Toggle
              checked={showThinkingBlocks()}
              onChange={setShowThinkingBlocks}
            />
          </SettingRow>

          <SettingRow label="Thinking Indicator" description="Animation style while the agent is processing" last>
            <SelectButton
              options={[
                { value: 'comet', label: 'Comet' },
                { value: 'waveform', label: 'Wave' },
                { value: 'orbital', label: 'Orbit' },
              ]}
              value={thinkingStyle()}
              onChange={(v) => setThinkingStyle(v as ThinkingStyle)}
            />
          </SettingRow>
        </SettingSection>

        {/* ── Per-Tool Defaults ── */}
        <SettingSection title="Per-Tool Defaults" description="Override the global collapse setting for individual tools">
          <div class="px-4 py-3 flex gap-2 border-b border-border-subtle">
            <button
              class="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-surface-hover transition-colors"
              onClick={() => setAllToolExpansionDefaults(toolsList, 'expanded')}
            >
              Expand All
            </button>
            <button
              class="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-surface-hover transition-colors"
              onClick={() => setAllToolExpansionDefaults(toolsList, 'collapsed')}
            >
              Collapse All
            </button>
          </div>
          <For each={toolsList}>
            {(tool, i) => <ToolExpansionRow tool={tool} last={i() === toolsList.length - 1} />}
          </For>
        </SettingSection>

        {/* ── About ── */}
        <SettingSection title="About">
          <SettingRow label="AgentOps Console" description="Fantasy SDK native agent operations console" last>
            <span class="text-xs text-text-muted font-mono">v0.1.0</span>
          </SettingRow>
        </SettingSection>

      </div>
    </div>
  );
}
