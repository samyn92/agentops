// KubernetesBrowser — overlay panel for browsing Kubernetes cluster resources.
// Follows the same popover pattern as ResourceBrowser but navigates cluster resources
// via namespace selection and resource kind tabs. Allows selecting resources for
// per-turn context injection into agent prompts.
import { createSignal, createResource, Show, For, Switch, Match, createMemo } from 'solid-js';
import { kubernetesBrowse } from '../../lib/api';
import { toggleContextItem, isContextItemSelected, selectedContextCount, clearContextItems } from '../../stores/resources';
import type {
  K8sNamespace, K8sNamespaceSummary, K8sPod, K8sDeployment, K8sStatefulSet,
  K8sDaemonSet, K8sJob, K8sCronJob, K8sService, K8sIngress, K8sConfigMap,
  K8sSecret, K8sEvent, K8sResourceKind, ResourceContext,
} from '../../types';
import Spinner from '../shared/Spinner';
import Tip from '../shared/Tip';

// ── Constants ──

const K8S_BLUE = '#326CE5';

type ResourceCategory = 'workloads' | 'networking' | 'config' | 'events';

interface ResourceTab {
  id: K8sResourceKind;
  label: string;
  category: ResourceCategory;
  icon: string;
}

const RESOURCE_TABS: ResourceTab[] = [
  { id: 'deployments', label: 'Deploys', category: 'workloads', icon: 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z' },
  { id: 'pods', label: 'Pods', category: 'workloads', icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z' },
  { id: 'statefulsets', label: 'STS', category: 'workloads', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z' },
  { id: 'daemonsets', label: 'DS', category: 'workloads', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'jobs', label: 'Jobs', category: 'workloads', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { id: 'cronjobs', label: 'Crons', category: 'workloads', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'services', label: 'Svc', category: 'networking', icon: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z' },
  { id: 'ingresses', label: 'Ing', category: 'networking', icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064' },
  { id: 'configmaps', label: 'CM', category: 'config', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { id: 'secrets', label: 'Sec', category: 'config', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
  { id: 'events', label: 'Events', category: 'events', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
];

// ── Kubernetes Logo SVG ──

function KubernetesIcon(props: { class?: string }) {
  return (
    <svg class={props.class || 'w-4 h-4'} viewBox="0 0 722 702" fill="currentColor">
      <path d="M358.986 1.456c-10.627.472-19.969 4.96-28.832 10.08l-248.96 144a68.8 68.8 0 00-25.344 25.504 64.64 64.64 0 00-8.832 34.56v288a64.64 64.64 0 008.832 34.56 68.8 68.8 0 0025.344 25.504l248.96 144c8.64 5.024 17.952 9.312 28.352 10.08a68.8 68.8 0 0036.288-10.08l248.96-144a68.8 68.8 0 0025.344-25.504 64.64 64.64 0 008.832-34.56v-288a64.64 64.64 0 00-8.832-34.56 68.8 68.8 0 00-25.344-25.504l-248.96-144c-9.152-5.344-18.816-9.152-28.768-10.08a78.08 78.08 0 00-7.04 0z" fill={K8S_BLUE}/>
      <path d="M361.134 126.688a26.4 26.4 0 00-5.12.48 27.04 27.04 0 00-20.16 18.88l-3.04 11.68-.96 7.68c-.8 6.56-1.44 13.12-2.56 19.52a15.36 15.36 0 01-5.12 9.6c-.32.32-.64.64-.64.96a179.2 179.2 0 00-94.4 39.2l-.96-.48c-2.88-1.6-5.44-4-8.96-5.28-5.76-2.24-11.52-4.32-17.44-6.08l-7.36-2.4-11.04-5.12a27.04 27.04 0 00-27.36 2.56 26.72 26.72 0 00-7.04 35.2l.32.48 6.24 10.08 4.8 6.24c4 5.12 7.84 10.24 12.16 15.04a15.36 15.36 0 012.88 10.56v.96c-14.4 28.64-22.24 60.64-22.4 93.44h-.48l-.48.48c-2.72 2.24-5.76 3.68-8.96 5.44-5.44 2.72-10.72 5.76-15.84 8.96l-6.72 4-10.56 6.72a26.72 26.72 0 00-9.12 34.56 27.04 27.04 0 0032 13.92l.48-.16 11.36-3.84 6.88-3.36c5.76-2.56 11.2-5.44 17.12-7.52a15.36 15.36 0 0110.72.96l.64.32c30.88 23.2 67.84 37.12 106.56 39.68v.48c.48 3.2.32 6.72 1.12 10.08 1.44 6.4 3.04 12.64 5.12 18.72l2.4 7.36 4.32 11.36a27.04 27.04 0 0025.28 17.44 26.72 26.72 0 0026.56-16.48l.16-.48 4.48-11.36 2.56-7.36c2.08-6.08 3.68-12.32 5.12-18.72.8-3.36.64-6.88 1.12-10.08v-.48c38.72-2.56 75.68-16.48 106.56-39.68l.64-.32c3.36-1.76 7.36-2.08 10.72-.96 5.92 2.08 11.36 4.96 17.12 7.52l6.88 3.36 11.36 3.84.48.16a27.04 27.04 0 0032-13.92 26.72 26.72 0 00-9.12-34.56l-10.56-6.72-6.72-4c-5.12-3.2-10.4-6.24-15.84-8.96-3.2-1.76-6.24-3.2-8.96-5.44l-.48-.48h-.48c-.16-32.8-8-64.8-22.4-93.44v-.96a15.36 15.36 0 012.88-10.56c4.32-4.8 8.16-9.92 12.16-15.04l4.8-6.24 6.24-10.08.32-.48a26.72 26.72 0 00-7.04-35.2 27.04 27.04 0 00-27.36-2.56l-11.04 5.12-7.36 2.4c-5.92 1.76-11.68 3.84-17.44 6.08-3.52 1.28-6.08 3.68-8.96 5.28l-.96.48a179.2 179.2 0 00-94.4-39.2c0-.32-.32-.64-.64-.96a15.36 15.36 0 01-5.12-9.6c-1.12-6.4-1.76-12.96-2.56-19.52l-.96-7.68-3.04-11.68a27.04 27.04 0 00-20.16-18.88 26.4 26.4 0 00-5.6-.48z" fill="#fff"/>
      <path d="M361.454 226.208a8 8 0 013.84 1.44l78.72 57.12a8 8 0 013.04 6.72l-2.08 96a8 8 0 01-3.84 6.4l-82.72 48.16a8 8 0 01-8 0l-82.72-48.16a8 8 0 01-3.84-6.4l-2.08-96a8 8 0 013.04-6.72l78.72-57.12a8 8 0 013.84-1.44h12.08z" fill={K8S_BLUE}/>
    </svg>
  );
}

// ── Selection checkbox (reuse same style as ResourceBrowser) ──

function SelectionCheckbox(props: { checked: boolean; onChange: () => void; class?: string }) {
  return (
    <button
      class={`flex-shrink-0 w-3.5 h-3.5 rounded border transition-all ${
        props.checked
          ? 'border-[#326CE5] text-white'
          : 'border-border-subtle hover:border-[#326CE5]/50 bg-transparent'
      } ${props.class || ''}`}
      style={props.checked ? { 'background-color': K8S_BLUE } : {}}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        props.onChange();
      }}
    >
      <Show when={props.checked}>
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
        </svg>
      </Show>
    </button>
  );
}

// ── Status coloring helpers ──

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['running', 'active', 'ready', 'bound', 'complete', 'available', 'succeeded'].some(k => s.includes(k))) {
    return 'text-success';
  }
  if (['pending', 'containercreating', 'waiting', 'init', 'suspend'].some(k => s.includes(k))) {
    return 'text-warning';
  }
  if (['failed', 'error', 'crashloopbackoff', 'imagepullbackoff', 'evicted', 'oomkilled', 'terminated'].some(k => s.includes(k))) {
    return 'text-error';
  }
  return 'text-text-secondary';
}

function eventTypeColor(type: string): string {
  if (type === 'Warning') return 'text-warning';
  if (type === 'Normal') return 'text-success';
  return 'text-text-muted';
}

// ── Make resource context for k8s items ──

function makeK8sContext(namespace: string, kind: string, name: string, extra?: Partial<ResourceContext>): ResourceContext {
  return {
    resource_name: 'kubernetes',
    kind: 'kubernetes',
    item_type: kind,
    path: `${namespace}/${name}`,
    title: name,
    description: `${kind} in ${namespace}`,
    ...extra,
  };
}

// ── Deployment Browser ──

function DeploymentBrowser(props: { namespace: string }) {
  const [deployments] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.deployments(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={deployments.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!deployments.loading}>
        <For each={deployments() || []}>
          {(d) => {
            const ctx = () => makeK8sContext(d.namespace, 'deployment', d.name, { description: `Deployment ${d.ready} ready, images: ${d.images.join(', ')}` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <svg class="w-3.5 h-3.5 text-[#326CE5]/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z" />
                  </svg>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-text font-medium truncate">{d.name}</span>
                      <span class={`text-[10px] font-mono ${d.ready.startsWith(d.ready.split('/')[1]) ? 'text-success' : 'text-warning'}`}>
                        {d.ready}
                      </span>
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="text-[10px] text-text-muted truncate">{d.images[0]}</span>
                      <span class="text-[10px] text-text-muted/60">{d.age}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(deployments() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No deployments</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Pod Browser ──

function PodBrowser(props: { namespace: string }) {
  const [pods] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.pods(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={pods.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!pods.loading}>
        <For each={pods() || []}>
          {(p) => {
            const ctx = () => makeK8sContext(p.namespace, 'pod', p.name, {
              description: `Pod ${p.phase}, ${p.ready} ready, ${p.restarts} restarts, node: ${p.node}`,
            });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <span class={`text-[10px] font-mono px-1.5 py-0.5 rounded ${statusColor(p.phase)} bg-current/5`}>
                    {p.phase}
                  </span>
                  <div class="flex-1 min-w-0">
                    <span class="text-xs text-text truncate block">{p.name}</span>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="text-[10px] text-text-muted">{p.ready}</span>
                      <Show when={p.restarts > 0}>
                        <span class={`text-[10px] ${p.restarts > 3 ? 'text-error' : 'text-warning'}`}>
                          {p.restarts} restarts
                        </span>
                      </Show>
                      <span class="text-[10px] text-text-muted/60">{p.age}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(pods() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No pods</div>
        </Show>
      </Show>
    </div>
  );
}

// ── StatefulSet Browser ──

function StatefulSetBrowser(props: { namespace: string }) {
  const [sts] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.statefulsets(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={sts.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!sts.loading}>
        <For each={sts() || []}>
          {(s) => {
            const ctx = () => makeK8sContext(s.namespace, 'statefulset', s.name, { description: `StatefulSet ${s.ready} ready` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <span class="text-xs text-text font-medium truncate flex-1">{s.name}</span>
                  <span class="text-[10px] font-mono text-text-muted">{s.ready}</span>
                  <span class="text-[10px] text-text-muted/60">{s.age}</span>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(sts() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No statefulsets</div>
        </Show>
      </Show>
    </div>
  );
}

// ── DaemonSet Browser ──

function DaemonSetBrowser(props: { namespace: string }) {
  const [ds] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.daemonsets(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={ds.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!ds.loading}>
        <For each={ds() || []}>
          {(d) => {
            const ctx = () => makeK8sContext(d.namespace, 'daemonset', d.name, { description: `DaemonSet ${d.ready}/${d.desired} ready` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <span class="text-xs text-text font-medium truncate flex-1">{d.name}</span>
                  <span class="text-[10px] font-mono text-text-muted">{d.ready}/{d.desired}</span>
                  <span class="text-[10px] text-text-muted/60">{d.age}</span>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(ds() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No daemonsets</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Job Browser ──

function JobBrowser(props: { namespace: string }) {
  const [jobs] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.jobs(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={jobs.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!jobs.loading}>
        <For each={jobs() || []}>
          {(j) => {
            const ctx = () => makeK8sContext(j.namespace, 'job', j.name, { description: `Job ${j.status}, ${j.succeeded} succeeded, ${j.failed} failed` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <span class={`text-[10px] font-mono px-1.5 py-0.5 rounded ${statusColor(j.status)} bg-current/5`}>
                    {j.status}
                  </span>
                  <span class="text-xs text-text truncate flex-1">{j.name}</span>
                  <span class="text-[10px] text-text-muted/60">{j.age}</span>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(jobs() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No jobs</div>
        </Show>
      </Show>
    </div>
  );
}

// ── CronJob Browser ──

function CronJobBrowser(props: { namespace: string }) {
  const [cjs] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.cronjobs(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={cjs.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!cjs.loading}>
        <For each={cjs() || []}>
          {(c) => {
            const ctx = () => makeK8sContext(c.namespace, 'cronjob', c.name, { description: `CronJob schedule: ${c.schedule}` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <span class="text-xs text-text truncate flex-1">{c.name}</span>
                  <span class="text-[10px] font-mono text-text-muted bg-surface-2 px-1.5 rounded">{c.schedule}</span>
                  <Show when={c.suspend}>
                    <span class="text-[10px] text-warning">suspended</span>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(cjs() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No cronjobs</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Service Browser ──

function ServiceBrowser(props: { namespace: string }) {
  const [svcs] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.services(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={svcs.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!svcs.loading}>
        <For each={svcs() || []}>
          {(s) => {
            const portsStr = s.ports.map(p => `${p.port}/${p.protocol}`).join(', ');
            const ctx = () => makeK8sContext(s.namespace, 'service', s.name, { description: `Service ${s.type}, ${s.clusterIP}, ports: ${portsStr}` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-text font-medium truncate">{s.name}</span>
                      <span class="text-[10px] font-mono text-text-muted bg-surface-2 px-1 rounded">{s.type}</span>
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="text-[10px] text-text-muted font-mono">{s.clusterIP}</span>
                      <span class="text-[10px] text-text-muted/60">{portsStr}</span>
                    </div>
                  </div>
                  <span class="text-[10px] text-text-muted/60">{s.age}</span>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(svcs() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No services</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Ingress Browser ──

function IngressBrowser(props: { namespace: string }) {
  const [ings] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.ingresses(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={ings.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!ings.loading}>
        <For each={ings() || []}>
          {(ing) => {
            const hostsStr = ing.hosts.map(h => h.host + (h.path || '')).join(', ');
            const ctx = () => makeK8sContext(ing.namespace, 'ingress', ing.name, { description: `Ingress hosts: ${hostsStr}, TLS: ${ing.tls}` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <div class="flex-1 min-w-0">
                    <span class="text-xs text-text font-medium truncate block">{ing.name}</span>
                    <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                      <For each={ing.hosts}>
                        {(h) => (
                          <span class="text-[10px] font-mono text-[#326CE5] bg-[#326CE5]/10 px-1 rounded">
                            {h.host}{h.path || ''}
                          </span>
                        )}
                      </For>
                      <Show when={ing.tls}>
                        <svg class="w-2.5 h-2.5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      </Show>
                    </div>
                  </div>
                  <span class="text-[10px] text-text-muted/60">{ing.age}</span>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(ings() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No ingresses</div>
        </Show>
      </Show>
    </div>
  );
}

// ── ConfigMap Browser ──

function ConfigMapBrowser(props: { namespace: string }) {
  const [cms] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.configmaps(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={cms.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!cms.loading}>
        <For each={cms() || []}>
          {(cm) => {
            const ctx = () => makeK8sContext(cm.namespace, 'configmap', cm.name, { description: `ConfigMap keys: ${cm.keys.join(', ')}` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <div class="flex-1 min-w-0">
                    <span class="text-xs text-text font-medium truncate block">{cm.name}</span>
                    <span class="text-[10px] text-text-muted truncate block mt-0.5">{cm.keys.length} keys</span>
                  </div>
                  <span class="text-[10px] text-text-muted/60">{cm.age}</span>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(cms() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No configmaps</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Secret Browser ──

function SecretBrowser(props: { namespace: string }) {
  const [secrets] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.secrets(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={secrets.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!secrets.loading}>
        <For each={secrets() || []}>
          {(s) => {
            const ctx = () => makeK8sContext(s.namespace, 'secret', s.name, { description: `Secret type: ${s.type}, keys: ${s.keys.join(', ')}` });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-center gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} />
                  <svg class="w-3 h-3 text-warning/60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <div class="flex-1 min-w-0">
                    <span class="text-xs text-text font-medium truncate block">{s.name}</span>
                    <span class="text-[10px] text-text-muted truncate block mt-0.5">{s.type}</span>
                  </div>
                  <span class="text-[10px] text-text-muted/60">{s.age}</span>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(secrets() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No secrets</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Event Browser ──

function EventBrowser(props: { namespace: string }) {
  const [events] = createResource(
    () => props.namespace,
    async (ns) => kubernetesBrowse.events(ns)
  );

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={events.loading}>
        <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
      </Show>
      <Show when={!events.loading}>
        <For each={events() || []}>
          {(e) => {
            const ctx = () => makeK8sContext(props.namespace, 'event', e.object, {
              title: `${e.reason}: ${e.message}`,
              description: `Event ${e.type} on ${e.object}: ${e.message} (${e.count}x)`,
            });
            const checked = () => isContextItemSelected(ctx());
            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${checked() ? 'bg-[#326CE5]/5' : ''}`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-start gap-2">
                  <SelectionCheckbox checked={checked()} onChange={() => toggleContextItem(ctx())} class="mt-0.5" />
                  <span class={`text-[10px] font-mono px-1 py-0.5 rounded flex-shrink-0 ${eventTypeColor(e.type)} bg-current/5`}>
                    {e.type}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-[10px] font-medium text-text">{e.reason}</span>
                      <span class="text-[10px] text-text-muted font-mono">{e.object}</span>
                    </div>
                    <p class="text-[10px] text-text-muted truncate mt-0.5">{e.message}</p>
                  </div>
                  <div class="flex flex-col items-end flex-shrink-0">
                    <Show when={e.count > 1}>
                      <span class="text-[9px] text-text-muted">{e.count}x</span>
                    </Show>
                    <span class="text-[9px] text-text-muted/60">{e.lastSeen}</span>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={(events() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No events</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Main KubernetesBrowser component ──

interface KubernetesBrowserProps {
  open: boolean;
  onClose: () => void;
  class?: string;
  /** When true, skip rendering backdrop and header (parent panel handles those) */
  embedded?: boolean;
}

export default function KubernetesBrowser(props: KubernetesBrowserProps) {
  const [selectedNamespace, setSelectedNamespace] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<K8sResourceKind>('deployments');
  const [showNsPicker, setShowNsPicker] = createSignal(true);

  const ctxCount = () => selectedContextCount();

  // Fetch namespaces
  const [namespaces] = createResource(
    () => props.open,
    async (open) => {
      if (!open) return [];
      return kubernetesBrowse.namespaces();
    }
  );

  // Fetch summary for selected namespace
  const [summary] = createResource(
    () => selectedNamespace(),
    async (ns) => {
      if (!ns) return null;
      return kubernetesBrowse.namespaceSummary(ns);
    }
  );

  function selectNamespace(ns: string) {
    setSelectedNamespace(ns);
    setShowNsPicker(false);
    setActiveTab('deployments');
  }

  function goBackToNamespaces() {
    setShowNsPicker(true);
  }

  // Visible tabs based on what's in the namespace
  const visibleTabs = createMemo(() => {
    const s = summary();
    if (!s) return RESOURCE_TABS;
    return RESOURCE_TABS.filter(tab => {
      const count = s[tab.id as keyof K8sNamespaceSummary];
      return count === undefined || count > 0;
    });
  });

  return (
    <Show when={props.open}>
      {/* Backdrop — skip in embedded mode */}
      <Show when={!props.embedded}>
        <div class="fixed inset-0 z-40" onClick={() => props.onClose()} />
      </Show>

      {/* Browser panel */}
      <div
        class={`${props.embedded ? '' : 'absolute z-50'} resource-browser-panel bg-surface ${props.embedded ? '' : 'border border-border rounded-xl shadow-lg'} overflow-hidden animate-popover-in ${props.class || ''}`}
        style={props.embedded ? { width: '100%', height: '100%' } : { width: '440px', height: '500px' }}
      >
        {/* Header — skip in embedded mode */}
        <Show when={!props.embedded}>
        <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-2/80">
          <div class="flex items-center gap-2">
            <Show when={!showNsPicker() && selectedNamespace()}>
              <Tip content="Back to namespaces">
                <button
                  class="p-0.5 text-text-muted hover:text-text rounded transition-colors"
                  onClick={goBackToNamespaces}
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </Tip>
            </Show>
            <KubernetesIcon class="w-4 h-4 text-[#326CE5]" />
            <span class="text-xs font-semibold text-text uppercase tracking-wide">Kubernetes</span>
            <Show when={selectedNamespace() && !showNsPicker()}>
              <span class="text-[10px] font-mono text-[#326CE5] bg-[#326CE5]/10 px-1.5 py-0.5 rounded">
                {selectedNamespace()}
              </span>
            </Show>
            <Show when={ctxCount() > 0}>
              <span class="text-[10px] font-medium text-white px-1.5 py-0.5 rounded-full leading-none" style={{ 'background-color': K8S_BLUE }}>
                {ctxCount()}
              </span>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <Show when={ctxCount() > 0}>
              <Tip content="Clear all selections">
                <button
                  class="text-[10px] text-text-muted hover:text-error transition-colors"
                  onClick={() => clearContextItems()}
                >
                  Clear
                </button>
              </Tip>
            </Show>
            <button
              class="p-1 text-text-muted hover:text-text rounded transition-colors"
              onClick={() => props.onClose()}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        </Show>

        {/* Embedded sub-header: back + namespace badge when drilled in */}
        <Show when={props.embedded && !showNsPicker() && selectedNamespace()}>
          <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-surface-2/50">
            <Tip content="Back to namespaces">
              <button
                class="p-0.5 text-text-muted hover:text-text rounded transition-colors"
                onClick={goBackToNamespaces}
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </Tip>
            <span class="text-[10px] font-mono text-[#326CE5] bg-[#326CE5]/10 px-1.5 py-0.5 rounded">
              {selectedNamespace()}
            </span>
          </div>
        </Show>

        {/* Namespace Picker View */}
        <Show when={showNsPicker()}>
          <div class="flex-1 overflow-y-auto" style={{ height: 'calc(100% - 44px)' }}>
            <div class="px-3 py-2 text-[10px] text-text-muted uppercase tracking-wider font-semibold border-b border-border-subtle bg-surface-2/30">
              Select Namespace
            </div>
            <Show when={namespaces.loading}>
              <div class="flex items-center justify-center py-8"><Spinner size="sm" /></div>
            </Show>
            <Show when={!namespaces.loading}>
              <For each={namespaces() || []}>
                {(ns) => (
                  <button
                    class={`w-full text-left px-3 py-2 text-xs hover:bg-surface-hover transition-colors flex items-center gap-2 border-b border-border-subtle ${
                      selectedNamespace() === ns.name ? 'bg-[#326CE5]/5' : ''
                    }`}
                    onClick={() => selectNamespace(ns.name)}
                  >
                    <span class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ns.status === 'Active' ? 'bg-success' : 'bg-warning'}`} />
                    <span class="text-text font-medium font-mono flex-1">{ns.name}</span>
                    <span class="text-[10px] text-text-muted/60">{ns.age}</span>
                    <svg class="w-3 h-3 text-text-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </For>
              <Show when={(namespaces() || []).length === 0}>
                <div class="px-3 py-6 text-center text-[11px] text-text-muted">No namespaces found</div>
              </Show>
            </Show>
          </div>
        </Show>

        {/* Resource Browser View */}
        <Show when={!showNsPicker() && selectedNamespace()}>
          {/* Resource kind tabs — scrollable horizontal */}
          <div class="flex items-center border-b border-border-subtle overflow-x-auto" style={{ 'scrollbar-width': 'none' }}>
            <For each={visibleTabs()}>
              {(tab) => (
                <button
                  class={`resource-tab flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium transition-colors relative whitespace-nowrap flex-shrink-0 ${
                    activeTab() === tab.id
                      ? 'text-[#326CE5]'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d={tab.icon} />
                  </svg>
                  {tab.label}
                  <Show when={activeTab() === tab.id}>
                    <div class="absolute bottom-0 left-1 right-1 h-[2px] rounded-full" style={{ 'background-color': K8S_BLUE }} />
                  </Show>
                </button>
              )}
            </For>
          </div>

          {/* Tab content */}
          <div class="flex-1 overflow-hidden" style={{ height: 'calc(100% - 88px)' }}>
            <Switch>
              <Match when={activeTab() === 'deployments'}>
                <DeploymentBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'pods'}>
                <PodBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'statefulsets'}>
                <StatefulSetBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'daemonsets'}>
                <DaemonSetBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'jobs'}>
                <JobBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'cronjobs'}>
                <CronJobBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'services'}>
                <ServiceBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'ingresses'}>
                <IngressBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'configmaps'}>
                <ConfigMapBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'secrets'}>
                <SecretBrowser namespace={selectedNamespace()!} />
              </Match>
              <Match when={activeTab() === 'events'}>
                <EventBrowser namespace={selectedNamespace()!} />
              </Match>
            </Switch>
          </div>
        </Show>
      </div>
    </Show>
  );
}
