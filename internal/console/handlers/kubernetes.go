// Kubernetes resource browsing handlers — provides structured cluster resource data
// for the console's Kubernetes resource browser panel.
package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// ── Namespace listing (enhanced) ──

// ListNamespacesEnhanced returns namespaces with resource counts.
func (h *Handlers) ListNamespacesEnhanced(w http.ResponseWriter, r *http.Request) {
	nsList, err := h.k8s.ListNamespaces(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list namespaces: %s", err)
		return
	}

	type nsInfo struct {
		Name   string `json:"name"`
		Status string `json:"status"`
		Age    string `json:"age"`
	}

	resp := make([]nsInfo, 0, len(nsList.Items))
	for _, ns := range nsList.Items {
		resp = append(resp, nsInfo{
			Name:   ns.Name,
			Status: string(ns.Status.Phase),
			Age:    humanAge(ns.CreationTimestamp.Time),
		})
	}

	// Sort alphabetically
	sort.Slice(resp, func(i, j int) bool { return resp[i].Name < resp[j].Name })

	writeJSON(w, http.StatusOK, resp)
}

// ── Workloads: Deployments ──

func (h *Handlers) ListDeployments(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	deploys, err := h.k8s.ListDeployments(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list deployments: %s", err)
		return
	}

	type deployInfo struct {
		Name      string            `json:"name"`
		Namespace string            `json:"namespace"`
		Ready     string            `json:"ready"`
		UpToDate  int32             `json:"upToDate"`
		Available int32             `json:"available"`
		Age       string            `json:"age"`
		Images    []string          `json:"images"`
		Labels    map[string]string `json:"labels,omitempty"`
	}

	resp := make([]deployInfo, 0, len(deploys.Items))
	for _, d := range deploys.Items {
		images := make([]string, 0)
		for _, c := range d.Spec.Template.Spec.Containers {
			images = append(images, c.Image)
		}
		resp = append(resp, deployInfo{
			Name:      d.Name,
			Namespace: d.Namespace,
			Ready:     fmt.Sprintf("%d/%d", d.Status.ReadyReplicas, d.Status.Replicas),
			UpToDate:  d.Status.UpdatedReplicas,
			Available: d.Status.AvailableReplicas,
			Age:       humanAge(d.CreationTimestamp.Time),
			Images:    images,
			Labels:    d.Labels,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Workloads: StatefulSets ──

func (h *Handlers) ListStatefulSets(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	sts, err := h.k8s.ListStatefulSets(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list statefulsets: %s", err)
		return
	}

	type stsInfo struct {
		Name      string            `json:"name"`
		Namespace string            `json:"namespace"`
		Ready     string            `json:"ready"`
		Age       string            `json:"age"`
		Images    []string          `json:"images"`
		Labels    map[string]string `json:"labels,omitempty"`
	}

	resp := make([]stsInfo, 0, len(sts.Items))
	for _, s := range sts.Items {
		images := make([]string, 0)
		for _, c := range s.Spec.Template.Spec.Containers {
			images = append(images, c.Image)
		}
		resp = append(resp, stsInfo{
			Name:      s.Name,
			Namespace: s.Namespace,
			Ready:     fmt.Sprintf("%d/%d", s.Status.ReadyReplicas, s.Status.Replicas),
			Age:       humanAge(s.CreationTimestamp.Time),
			Images:    images,
			Labels:    s.Labels,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Workloads: DaemonSets ──

func (h *Handlers) ListDaemonSets(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	ds, err := h.k8s.ListDaemonSets(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list daemonsets: %s", err)
		return
	}

	type dsInfo struct {
		Name      string            `json:"name"`
		Namespace string            `json:"namespace"`
		Desired   int32             `json:"desired"`
		Current   int32             `json:"current"`
		Ready     int32             `json:"ready"`
		Available int32             `json:"available"`
		Age       string            `json:"age"`
		Labels    map[string]string `json:"labels,omitempty"`
	}

	resp := make([]dsInfo, 0, len(ds.Items))
	for _, d := range ds.Items {
		resp = append(resp, dsInfo{
			Name:      d.Name,
			Namespace: d.Namespace,
			Desired:   d.Status.DesiredNumberScheduled,
			Current:   d.Status.CurrentNumberScheduled,
			Ready:     d.Status.NumberReady,
			Available: d.Status.NumberAvailable,
			Age:       humanAge(d.CreationTimestamp.Time),
			Labels:    d.Labels,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Workloads: Jobs ──

func (h *Handlers) ListJobs(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	jobs, err := h.k8s.ListJobs(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list jobs: %s", err)
		return
	}

	type jobInfo struct {
		Name      string            `json:"name"`
		Namespace string            `json:"namespace"`
		Status    string            `json:"status"`
		Succeeded int32             `json:"succeeded"`
		Failed    int32             `json:"failed"`
		Age       string            `json:"age"`
		Duration  string            `json:"duration,omitempty"`
		Labels    map[string]string `json:"labels,omitempty"`
	}

	resp := make([]jobInfo, 0, len(jobs.Items))
	for _, j := range jobs.Items {
		status := "Running"
		if j.Status.Succeeded > 0 && (j.Spec.Completions == nil || j.Status.Succeeded >= *j.Spec.Completions) {
			status = "Complete"
		} else if j.Status.Failed > 0 {
			status = "Failed"
		}

		var duration string
		if j.Status.StartTime != nil && j.Status.CompletionTime != nil {
			duration = j.Status.CompletionTime.Sub(j.Status.StartTime.Time).Round(time.Second).String()
		}

		resp = append(resp, jobInfo{
			Name:      j.Name,
			Namespace: j.Namespace,
			Status:    status,
			Succeeded: j.Status.Succeeded,
			Failed:    j.Status.Failed,
			Age:       humanAge(j.CreationTimestamp.Time),
			Duration:  duration,
			Labels:    j.Labels,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Workloads: CronJobs ──

func (h *Handlers) ListCronJobs(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	cjs, err := h.k8s.ListCronJobs(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list cronjobs: %s", err)
		return
	}

	type cronInfo struct {
		Name         string `json:"name"`
		Namespace    string `json:"namespace"`
		Schedule     string `json:"schedule"`
		Suspend      bool   `json:"suspend"`
		Active       int    `json:"active"`
		LastSchedule string `json:"lastSchedule,omitempty"`
		Age          string `json:"age"`
	}

	resp := make([]cronInfo, 0, len(cjs.Items))
	for _, c := range cjs.Items {
		var lastSchedule string
		if c.Status.LastScheduleTime != nil {
			lastSchedule = humanAge(c.Status.LastScheduleTime.Time) + " ago"
		}
		suspend := false
		if c.Spec.Suspend != nil {
			suspend = *c.Spec.Suspend
		}
		resp = append(resp, cronInfo{
			Name:         c.Name,
			Namespace:    c.Namespace,
			Schedule:     c.Spec.Schedule,
			Suspend:      suspend,
			Active:       len(c.Status.Active),
			LastSchedule: lastSchedule,
			Age:          humanAge(c.CreationTimestamp.Time),
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Workloads: Pods (enhanced) ──

func (h *Handlers) ListPodsEnhanced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	pods, err := h.k8s.ListPods(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list pods: %s", err)
		return
	}

	type containerInfo struct {
		Name   string `json:"name"`
		Image  string `json:"image"`
		Ready  bool   `json:"ready"`
		State  string `json:"state"`
		Reason string `json:"reason,omitempty"`
	}

	type podInfo struct {
		Name       string            `json:"name"`
		Namespace  string            `json:"namespace"`
		Phase      string            `json:"phase"`
		Ready      string            `json:"ready"`
		Restarts   int32             `json:"restarts"`
		Node       string            `json:"node"`
		Age        string            `json:"age"`
		IP         string            `json:"ip,omitempty"`
		Containers []containerInfo   `json:"containers"`
		Labels     map[string]string `json:"labels,omitempty"`
	}

	resp := make([]podInfo, 0, len(pods.Items))
	for _, p := range pods.Items {
		readyCount := int32(0)
		totalRestarts := int32(0)
		containers := make([]containerInfo, 0, len(p.Status.ContainerStatuses))

		for _, cs := range p.Status.ContainerStatuses {
			if cs.Ready {
				readyCount++
			}
			totalRestarts += cs.RestartCount

			state := "waiting"
			reason := ""
			if cs.State.Running != nil {
				state = "running"
			} else if cs.State.Waiting != nil {
				state = "waiting"
				reason = cs.State.Waiting.Reason
			} else if cs.State.Terminated != nil {
				state = "terminated"
				reason = cs.State.Terminated.Reason
			}

			containers = append(containers, containerInfo{
				Name:   cs.Name,
				Image:  cs.Image,
				Ready:  cs.Ready,
				State:  state,
				Reason: reason,
			})
		}

		resp = append(resp, podInfo{
			Name:       p.Name,
			Namespace:  p.Namespace,
			Phase:      string(p.Status.Phase),
			Ready:      fmt.Sprintf("%d/%d", readyCount, len(p.Spec.Containers)),
			Restarts:   totalRestarts,
			Node:       p.Spec.NodeName,
			Age:        humanAge(p.CreationTimestamp.Time),
			IP:         p.Status.PodIP,
			Containers: containers,
			Labels:     p.Labels,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Networking: Services ──

func (h *Handlers) ListServicesK8s(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	svcs, err := h.k8s.ListServices(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list services: %s", err)
		return
	}

	type portInfo struct {
		Port       int32  `json:"port"`
		TargetPort string `json:"targetPort"`
		Protocol   string `json:"protocol"`
		Name       string `json:"name,omitempty"`
	}

	type svcInfo struct {
		Name       string            `json:"name"`
		Namespace  string            `json:"namespace"`
		Type       string            `json:"type"`
		ClusterIP  string            `json:"clusterIP"`
		ExternalIP string            `json:"externalIP,omitempty"`
		Ports      []portInfo        `json:"ports"`
		Age        string            `json:"age"`
		Selector   map[string]string `json:"selector,omitempty"`
		Labels     map[string]string `json:"labels,omitempty"`
	}

	resp := make([]svcInfo, 0, len(svcs.Items))
	for _, s := range svcs.Items {
		ports := make([]portInfo, 0, len(s.Spec.Ports))
		for _, p := range s.Spec.Ports {
			ports = append(ports, portInfo{
				Port:       p.Port,
				TargetPort: p.TargetPort.String(),
				Protocol:   string(p.Protocol),
				Name:       p.Name,
			})
		}

		extIP := ""
		if len(s.Spec.ExternalIPs) > 0 {
			extIP = strings.Join(s.Spec.ExternalIPs, ",")
		} else if s.Spec.Type == "LoadBalancer" {
			ips := make([]string, 0)
			for _, ing := range s.Status.LoadBalancer.Ingress {
				if ing.IP != "" {
					ips = append(ips, ing.IP)
				} else if ing.Hostname != "" {
					ips = append(ips, ing.Hostname)
				}
			}
			extIP = strings.Join(ips, ",")
		}

		resp = append(resp, svcInfo{
			Name:       s.Name,
			Namespace:  s.Namespace,
			Type:       string(s.Spec.Type),
			ClusterIP:  s.Spec.ClusterIP,
			ExternalIP: extIP,
			Ports:      ports,
			Age:        humanAge(s.CreationTimestamp.Time),
			Selector:   s.Spec.Selector,
			Labels:     s.Labels,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Networking: Ingresses ──

func (h *Handlers) ListIngresses(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	ings, err := h.k8s.ListIngresses(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list ingresses: %s", err)
		return
	}

	type ingressRuleInfo struct {
		Host string `json:"host"`
		Path string `json:"path"`
	}

	type ingressInfo struct {
		Name      string            `json:"name"`
		Namespace string            `json:"namespace"`
		Class     string            `json:"class,omitempty"`
		Hosts     []ingressRuleInfo `json:"hosts"`
		TLS       bool              `json:"tls"`
		Age       string            `json:"age"`
		Labels    map[string]string `json:"labels,omitempty"`
	}

	resp := make([]ingressInfo, 0, len(ings.Items))
	for _, ing := range ings.Items {
		hosts := make([]ingressRuleInfo, 0)
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP != nil {
				for _, path := range rule.HTTP.Paths {
					hosts = append(hosts, ingressRuleInfo{
						Host: rule.Host,
						Path: path.Path,
					})
				}
			} else {
				hosts = append(hosts, ingressRuleInfo{Host: rule.Host})
			}
		}

		class := ""
		if ing.Spec.IngressClassName != nil {
			class = *ing.Spec.IngressClassName
		}

		resp = append(resp, ingressInfo{
			Name:      ing.Name,
			Namespace: ing.Namespace,
			Class:     class,
			Hosts:     hosts,
			TLS:       len(ing.Spec.TLS) > 0,
			Age:       humanAge(ing.CreationTimestamp.Time),
			Labels:    ing.Labels,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Config: ConfigMaps ──

func (h *Handlers) ListConfigMaps(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	cms, err := h.k8s.ListConfigMaps(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list configmaps: %s", err)
		return
	}

	type cmInfo struct {
		Name      string   `json:"name"`
		Namespace string   `json:"namespace"`
		Keys      []string `json:"keys"`
		Age       string   `json:"age"`
	}

	resp := make([]cmInfo, 0, len(cms.Items))
	for _, cm := range cms.Items {
		keys := make([]string, 0, len(cm.Data))
		for k := range cm.Data {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		resp = append(resp, cmInfo{
			Name:      cm.Name,
			Namespace: cm.Namespace,
			Keys:      keys,
			Age:       humanAge(cm.CreationTimestamp.Time),
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Config: Secrets (metadata only, no data exposed) ──

func (h *Handlers) ListSecretsMetadata(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	secrets, err := h.k8s.ListSecrets(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list secrets: %s", err)
		return
	}

	type secretInfo struct {
		Name      string   `json:"name"`
		Namespace string   `json:"namespace"`
		Type      string   `json:"type"`
		Keys      []string `json:"keys"`
		Age       string   `json:"age"`
	}

	resp := make([]secretInfo, 0, len(secrets.Items))
	for _, s := range secrets.Items {
		keys := make([]string, 0, len(s.Data))
		for k := range s.Data {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		resp = append(resp, secretInfo{
			Name:      s.Name,
			Namespace: s.Namespace,
			Type:      string(s.Type),
			Keys:      keys,
			Age:       humanAge(s.CreationTimestamp.Time),
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Events ──

func (h *Handlers) ListEventsK8s(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	events, err := h.k8s.ListEvents(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list events: %s", err)
		return
	}

	type eventInfo struct {
		Type      string `json:"type"`
		Reason    string `json:"reason"`
		Object    string `json:"object"`
		Message   string `json:"message"`
		Count     int32  `json:"count"`
		FirstSeen string `json:"firstSeen"`
		LastSeen  string `json:"lastSeen"`
		Source    string `json:"source,omitempty"`
	}

	resp := make([]eventInfo, 0, len(events.Items))
	for _, e := range events.Items {
		object := ""
		if e.InvolvedObject.Kind != "" {
			object = fmt.Sprintf("%s/%s", strings.ToLower(e.InvolvedObject.Kind), e.InvolvedObject.Name)
		}

		source := ""
		if e.Source.Component != "" {
			source = e.Source.Component
		}

		resp = append(resp, eventInfo{
			Type:      e.Type,
			Reason:    e.Reason,
			Object:    object,
			Message:   e.Message,
			Count:     e.Count,
			FirstSeen: humanAge(e.FirstTimestamp.Time),
			LastSeen:  humanAge(e.LastTimestamp.Time),
			Source:    source,
		})
	}

	// Sort by last seen (most recent first)
	sort.Slice(resp, func(i, j int) bool {
		return resp[i].LastSeen < resp[j].LastSeen
	})

	writeJSON(w, http.StatusOK, resp)
}

// ── All resources summary for a namespace ──

// ListNamespaceResourceSummary returns a summary count of all resource types in a namespace.
func (h *Handlers) ListNamespaceResourceSummary(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	ctx := r.Context()

	type summary struct {
		Pods         int `json:"pods"`
		Deployments  int `json:"deployments"`
		StatefulSets int `json:"statefulSets"`
		DaemonSets   int `json:"daemonSets"`
		Jobs         int `json:"jobs"`
		CronJobs     int `json:"cronJobs"`
		Services     int `json:"services"`
		Ingresses    int `json:"ingresses"`
		ConfigMaps   int `json:"configMaps"`
		Secrets      int `json:"secrets"`
	}

	s := summary{}

	if pods, err := h.k8s.ListPods(ctx, ns); err == nil {
		s.Pods = len(pods.Items)
	}
	if deps, err := h.k8s.ListDeployments(ctx, ns); err == nil {
		s.Deployments = len(deps.Items)
	}
	if sts, err := h.k8s.ListStatefulSets(ctx, ns); err == nil {
		s.StatefulSets = len(sts.Items)
	}
	if ds, err := h.k8s.ListDaemonSets(ctx, ns); err == nil {
		s.DaemonSets = len(ds.Items)
	}
	if jobs, err := h.k8s.ListJobs(ctx, ns); err == nil {
		s.Jobs = len(jobs.Items)
	}
	if cj, err := h.k8s.ListCronJobs(ctx, ns); err == nil {
		s.CronJobs = len(cj.Items)
	}
	if svcs, err := h.k8s.ListServices(ctx, ns); err == nil {
		s.Services = len(svcs.Items)
	}
	if ings, err := h.k8s.ListIngresses(ctx, ns); err == nil {
		s.Ingresses = len(ings.Items)
	}
	if cms, err := h.k8s.ListConfigMaps(ctx, ns); err == nil {
		s.ConfigMaps = len(cms.Items)
	}
	if secs, err := h.k8s.ListSecrets(ctx, ns); err == nil {
		s.Secrets = len(secs.Items)
	}

	writeJSON(w, http.StatusOK, s)
}

// ── Helpers ──

func humanAge(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		days := int(d.Hours() / 24)
		return fmt.Sprintf("%dd", days)
	}
}
