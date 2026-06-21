// Icons — centralized SVG icon system
// Every icon accepts a `class` prop for Tailwind styling
import { Show } from 'solid-js';

interface IconProps {
  class?: string;
}

// ── Navigation ──

export function HamburgerIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function BackArrowIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  );
}

export function SettingsGearIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

// ── Actions ──

export function BoardIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.75 4.5h4.5v15h-4.5zM9.75 4.5h4.5v9h-4.5zM15.75 4.5h4.5v12h-4.5z" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3 h-3'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
    </svg>
  );
}

// ── Status / Indicators ──

export function LightningBoltIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

export function LightningBoltFilledIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3 h-3'} fill="currentColor" viewBox="0 0 24 24">
      <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3 h-3'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function DelegationIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3 h-3'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5" />
    </svg>
  );
}

export function CircleDotIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3 h-3'} fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function ExclamationCircleIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-8 h-8'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m0 0l-7 7m7-7l7 7" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function CursorClickIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-10 h-10'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
    </svg>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h16.5M3.75 3v11.25m16.5-11.25v11.25M20.25 3h-16.5m16.5 0v11.25m0 0A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
    </svg>
  );
}

export function BrainIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.375 3.375 0 01-2.386.988H9.856a3.375 3.375 0 01-2.386-.988L5 14.5m14 0l.228-.303a3 3 0 00.547-1.992 3.368 3.368 0 00-.21-1.143L19 9.5m0 5l.341-.455a3.003 3.003 0 00.434-2.785L19 9.5m0 0l-.597-.334A3 3 0 0016 6.42V4.5" />
    </svg>
  );
}

// ── Git / Forge ──

export function GitBranchIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3H9m-3 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
    </svg>
  );
}

export function GitHubIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-[18px] h-[18px]'} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

export function GitLabIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-[18px] h-[18px]'} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
    </svg>
  );
}

export function KubernetesIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3.5 h-3.5'} viewBox="0 0 722 702" fill="#326CE5">
      <path d="M358.986 1.456c-10.627.472-19.969 4.96-28.832 10.08l-248.96 144a68.8 68.8 0 00-25.344 25.504 64.64 64.64 0 00-8.832 34.56v288a64.64 64.64 0 008.832 34.56 68.8 68.8 0 0025.344 25.504l248.96 144c8.64 5.024 17.952 9.312 28.352 10.08a68.8 68.8 0 0036.288-10.08l248.96-144a68.8 68.8 0 0025.344-25.504 64.64 64.64 0 008.832-34.56v-288a64.64 64.64 0 00-8.832-34.56 68.8 68.8 0 00-25.344-25.504l-248.96-144c-9.152-5.344-18.816-9.152-28.768-10.08a78.08 78.08 0 00-7.04 0z"/>
    </svg>
  );
}

// ── Channel types ──

export function TelegramIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-2.5 h-2.5'} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
    </svg>
  );
}

export function SlackIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-2.5 h-2.5'} fill="currentColor" viewBox="0 0 24 24">
      <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.163 0a2.528 2.528 0 012.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.163 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 01-2.52-2.523 2.527 2.527 0 012.52-2.52h6.315A2.528 2.528 0 0124 15.163a2.528 2.528 0 01-2.522 2.523h-6.315z"/>
    </svg>
  );
}

// ── Composite / Domain ──

/** Run source icon (channel, agent delegation, schedule, unknown) */
export function SourceIcon(props: { source: string; class?: string }) {
  const title = () => {
    switch (props.source) {
      case 'channel': return 'From channel';
      case 'agent': return 'Agent delegation';
      case 'schedule': return 'Scheduled';
      default: return 'Manual';
    }
  };

  return (
    <span class="flex-shrink-0 w-4 h-4 flex items-center justify-center" title={title()}>
      <Show when={props.source === 'channel'}>
        <LightningBoltFilledIcon class="w-3 h-3 text-warning" />
      </Show>
      <Show when={props.source === 'agent'}>
        <DelegationIcon class="w-3 h-3 text-info" />
      </Show>
      <Show when={props.source === 'schedule'}>
        <ClockIcon class="w-3 h-3 text-text-muted" />
      </Show>
      <Show when={props.source === 'unknown'}>
        <CircleDotIcon class="w-3 h-3 text-text-muted/50" />
      </Show>
    </span>
  );
}

/** Forge icon (GitHub/GitLab/git) shown left of branch tags */
export function ForgeIcon(props: { forge: 'github' | 'gitlab' | 'git' }) {
  return (
    <span class="flex-shrink-0 w-5 h-5 flex items-center justify-center">
      <Show when={props.forge === 'github'}>
        <GitHubIcon class="w-[18px] h-[18px] text-text-secondary" />
      </Show>
      <Show when={props.forge === 'gitlab'}>
        <GitLabIcon class="w-[18px] h-[18px] text-[#FC6D26]" />
      </Show>
      <Show when={props.forge === 'git'}>
        <svg class="w-[18px] h-[18px] text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3H9m-3 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
        </svg>
      </Show>
    </span>
  );
}

/** Subtle forge logo watermark in the bottom-right corner of run cards */
export function ForgeWatermark(props: { forge: 'github' | 'gitlab' | 'git' }) {
  return (
    <div class={`run-card__watermark run-card__watermark--${props.forge}`}>
      <Show when={props.forge === 'github'}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
        </svg>
      </Show>
      <Show when={props.forge === 'gitlab'}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
        </svg>
      </Show>
      <Show when={props.forge === 'git'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3H9m-3 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
        </svg>
      </Show>
    </div>
  );
}

/** Tree connector for trace delegation trees (child → parent line) */
export function TreeConnectorIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-3 h-3'} viewBox="0 0 12 12">
      <path d="M3 0 L3 6 L10 6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** Small upward arrow for parent-agent attribution */
export function ArrowUpIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-2.5 h-2.5'} viewBox="0 0 10 10" fill="none" stroke="currentColor">
      <path d="M5 8 L5 2 M2.5 4.5 L5 2 L7.5 4.5" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** Channel type icon for sidebar pills */
export function ChannelTypeIcon(props: { type: string }) {
  const t = () => props.type?.toLowerCase();

  return (
    <Show when={t() === 'gitlab'} fallback={
      <Show when={t() === 'github'} fallback={
        <Show when={t() === 'slack'} fallback={
          <Show when={t() === 'telegram'} fallback={
            <LightningBoltFilledIcon class="w-2.5 h-2.5" />
          }>
            <TelegramIcon />
          </Show>
        }>
          <SlackIcon />
        </Show>
      }>
        <GitHubIcon class="w-2.5 h-2.5" />
      </Show>
    }>
      <GitLabIcon class="w-2.5 h-2.5" />
    </Show>
  );
}

// ── Attachment / Resources ──

export function PaperclipIcon(props: IconProps) {
  return (
    <svg class={props.class || 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  );
}
