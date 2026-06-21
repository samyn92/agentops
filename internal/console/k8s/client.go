// K8s client with controller-runtime informer cache for CRD access.
package k8s

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"reflect"
	"strings"
	"time"

	agentsv1alpha1 "github.com/samyn92/agentops/api/v1alpha1"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

var scheme = runtime.NewScheme()

func init() {
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(agentsv1alpha1.AddToScheme(scheme))
}

// Client wraps a controller-runtime cached client for CRD access.
type Client struct {
	client    client.Client
	cache     cache.Cache
	namespace string // optional namespace restriction
	devMode   bool   // dev mode: resolve service URLs via ClusterIP instead of DNS
	watcher   *Watcher
}

// NewClient creates a K8s client with informer-backed cache.
func NewClient(kubeconfig string, namespace string, devMode bool) (*Client, error) {
	cfg, err := buildConfig(kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("build kubeconfig: %w", err)
	}

	// Cache options
	cacheOpts := cache.Options{
		Scheme: scheme,
	}
	if namespace != "" {
		cacheOpts.DefaultNamespaces = map[string]cache.Config{
			namespace: {},
		}
	}

	c, err := cache.New(cfg, cacheOpts)
	if err != nil {
		return nil, fmt.Errorf("create cache: %w", err)
	}

	cl, err := client.New(cfg, client.Options{
		Scheme: scheme,
		Cache: &client.CacheOptions{
			Reader: c,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}

	return &Client{
		client:    cl,
		cache:     c,
		namespace: namespace,
		devMode:   devMode,
		watcher:   NewWatcher(),
	}, nil
}

func buildConfig(kubeconfig string) (*rest.Config, error) {
	if kubeconfig != "" {
		return clientcmd.BuildConfigFromFlags("", kubeconfig)
	}
	// Try in-cluster first
	cfg, err := rest.InClusterConfig()
	if err == nil {
		return cfg, nil
	}
	// Fall back to default kubeconfig location
	home, _ := os.UserHomeDir()
	return clientcmd.BuildConfigFromFlags("", home+"/.kube/config")
}

// Start starts the informer cache and registers event handlers.
// Must be called before any reads. Blocks until cache is synced or timeout.
func (c *Client) Start(ctx context.Context) error {
	go func() {
		if err := c.cache.Start(ctx); err != nil {
			slog.Error("cache start failed", "error", err)
		}
	}()

	// Register informer event handlers for CRDs
	c.registerWatchers(ctx)

	// Wait for cache sync
	syncCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	if !c.cache.WaitForCacheSync(syncCtx) {
		return fmt.Errorf("cache sync timeout")
	}
	slog.Info("k8s cache synced")
	return nil
}

// Watcher returns the CRD event watcher for SSE subscriptions.
func (c *Client) Watcher() *Watcher {
	return c.watcher
}

func (c *Client) registerWatchers(ctx context.Context) {
	registerInformerHandler[*agentsv1alpha1.Agent](c, ctx, "Agent")
	registerInformerHandler[*agentsv1alpha1.AgentRun](c, ctx, "AgentRun")
	registerInformerHandler[*agentsv1alpha1.Channel](c, ctx, "Channel")
	registerInformerHandler[*agentsv1alpha1.Integration](c, ctx, "Integration")
}

func registerInformerHandler[T client.Object](c *Client, ctx context.Context, kind string) {
	var obj T
	// Create a new instance (the pointer is nil, we need the type for GetInformer)
	obj = newObj[T]()
	informer, err := c.cache.GetInformer(ctx, obj)
	if err != nil {
		slog.Warn("failed to get informer", "kind", kind, "error", err)
		return
	}

	handler := newResourceHandler(kind, c.watcher)
	if _, err := informer.AddEventHandler(handler); err != nil {
		slog.Warn("failed to add event handler", "kind", kind, "error", err)
	}
}

// newObj allocates a new instance of a pointer type T.
// For types like *Agent, the zero value is nil — cache.GetInformer
// requires a non-nil pointer, so we use reflect to allocate one.
func newObj[T client.Object]() T {
	var zero T
	t := reflect.TypeOf(zero)
	if t.Kind() == reflect.Ptr {
		return reflect.New(t.Elem()).Interface().(T)
	}
	return zero
}

// ── Agent operations ──

func (c *Client) ListAgents(ctx context.Context) (*agentsv1alpha1.AgentList, error) {
	list := &agentsv1alpha1.AgentList{}
	opts := &client.ListOptions{}
	if c.namespace != "" {
		opts.Namespace = c.namespace
	}
	if err := c.client.List(ctx, list, opts); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) GetAgent(ctx context.Context, namespace, name string) (*agentsv1alpha1.Agent, error) {
	agent := &agentsv1alpha1.Agent{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, agent); err != nil {
		return nil, err
	}
	return agent, nil
}

// GetAgentServiceURL returns the URL to reach an agent's HTTP server.
// Supports 4 modes: AGENT_URL_OVERRIDE (dev), KUBECTL_PROXY_URL (dev multi-agent),
// dev mode ClusterIP lookup, and in-cluster DNS.
func (c *Client) GetAgentServiceURL(agent *agentsv1alpha1.Agent) string {
	// Mode 1: Single-agent dev override
	if override := os.Getenv("AGENT_URL_OVERRIDE"); override != "" {
		return override
	}

	// Mode 2: kubectl proxy URL rewriting
	if proxyURL := os.Getenv("KUBECTL_PROXY_URL"); proxyURL != "" {
		return fmt.Sprintf("%s/api/v1/namespaces/%s/services/%s:4096/proxy",
			strings.TrimRight(proxyURL, "/"), agent.Namespace, agent.Name)
	}

	// Mode 3: Dev mode — resolve ClusterIP from the Service object
	if c.devMode {
		svc := &corev1.Service{}
		key := client.ObjectKey{Namespace: agent.Namespace, Name: agent.Name}
		if err := c.client.Get(context.Background(), key, svc); err == nil && svc.Spec.ClusterIP != "" {
			port := int32(4096)
			for _, p := range svc.Spec.Ports {
				port = p.Port
				break
			}
			url := fmt.Sprintf("http://%s:%d", svc.Spec.ClusterIP, port)
			slog.Debug("dev mode: resolved agent service URL via ClusterIP", "agent", agent.Name, "url", url)
			return url
		}
		slog.Warn("dev mode: could not resolve ClusterIP, falling back to DNS", "agent", agent.Name)
	}

	// Mode 4: In-cluster DNS
	if agent.Status.ServiceURL != "" {
		return agent.Status.ServiceURL
	}
	return fmt.Sprintf("http://%s.%s.svc:4096", agent.Name, agent.Namespace)
}

// ── AgentRun operations ──

func (c *Client) ListAgentRuns(ctx context.Context) (*agentsv1alpha1.AgentRunList, error) {
	list := &agentsv1alpha1.AgentRunList{}
	opts := &client.ListOptions{}
	if c.namespace != "" {
		opts.Namespace = c.namespace
	}
	if err := c.client.List(ctx, list, opts); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) GetAgentRun(ctx context.Context, namespace, name string) (*agentsv1alpha1.AgentRun, error) {
	run := &agentsv1alpha1.AgentRun{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, run); err != nil {
		return nil, err
	}
	return run, nil
}

// CreateAgentRun creates an AgentRun CR. The caller sets GenerateName (the
// operator allocates the suffix) so concurrent dispatches never collide. The
// console SA must have create permission on agentruns (it does — see the
// console-dev/console ClusterRole). Returns the created object (with its
// server-assigned name) so the handler can echo it back.
func (c *Client) CreateAgentRun(ctx context.Context, run *agentsv1alpha1.AgentRun) (*agentsv1alpha1.AgentRun, error) {
	if err := c.client.Create(ctx, run); err != nil {
		return nil, err
	}
	return run, nil
}

// ── Channel operations ──

func (c *Client) ListChannels(ctx context.Context) (*agentsv1alpha1.ChannelList, error) {
	list := &agentsv1alpha1.ChannelList{}
	opts := &client.ListOptions{}
	if c.namespace != "" {
		opts.Namespace = c.namespace
	}
	if err := c.client.List(ctx, list, opts); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) GetChannel(ctx context.Context, namespace, name string) (*agentsv1alpha1.Channel, error) {
	ch := &agentsv1alpha1.Channel{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, ch); err != nil {
		return nil, err
	}
	return ch, nil
}

// ── Integration operations ──

func (c *Client) ListIntegrations(ctx context.Context) (*agentsv1alpha1.IntegrationList, error) {
	list := &agentsv1alpha1.IntegrationList{}
	opts := &client.ListOptions{}
	if c.namespace != "" {
		opts.Namespace = c.namespace
	}
	if err := c.client.List(ctx, list, opts); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) GetIntegration(ctx context.Context, namespace, name string) (*agentsv1alpha1.Integration, error) {
	intg := &agentsv1alpha1.Integration{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, intg); err != nil {
		return nil, err
	}
	return intg, nil
}

// ListIntegrationsForAgent returns the Integration CRs bound to a specific agent.
func (c *Client) ListIntegrationsForAgent(ctx context.Context, agent *agentsv1alpha1.Agent) ([]agentsv1alpha1.Integration, error) {
	all, err := c.ListIntegrations(ctx)
	if err != nil {
		return nil, err
	}

	// Build a set of bound integration names from the agent's integrations
	boundNames := make(map[string]bool, len(agent.Spec.Integrations))
	for _, binding := range agent.Spec.Integrations {
		boundNames[binding.Name] = true
	}

	var matched []agentsv1alpha1.Integration
	for _, intg := range all.Items {
		if boundNames[intg.Name] && intg.Namespace == agent.Namespace {
			matched = append(matched, intg)
		}
	}
	return matched, nil
}

// GetIntegrationCredentials reads the secret referenced by an Integration's credentials field.
func (c *Client) GetIntegrationCredentials(ctx context.Context, namespace string, intg *agentsv1alpha1.Integration) (string, error) {
	if intg.Spec.Credentials == nil {
		return "", fmt.Errorf("integration %s has no credentials configured", intg.Name)
	}
	secret := &corev1.Secret{}
	if err := c.client.Get(ctx, client.ObjectKey{
		Namespace: namespace,
		Name:      intg.Spec.Credentials.Name,
	}, secret); err != nil {
		return "", fmt.Errorf("secret %s not found: %w", intg.Spec.Credentials.Name, err)
	}
	val, ok := secret.Data[intg.Spec.Credentials.Key]
	if !ok {
		return "", fmt.Errorf("key %s not found in secret %s", intg.Spec.Credentials.Key, intg.Spec.Credentials.Name)
	}
	return string(val), nil
}

// ── Kubernetes resource browsing ──

func (c *Client) ListNamespaces(ctx context.Context) (*corev1.NamespaceList, error) {
	list := &corev1.NamespaceList{}
	if err := c.client.List(ctx, list); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListPods(ctx context.Context, namespace string) (*corev1.PodList, error) {
	list := &corev1.PodList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListDeployments(ctx context.Context, namespace string) (*appsv1.DeploymentList, error) {
	list := &appsv1.DeploymentList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListStatefulSets(ctx context.Context, namespace string) (*appsv1.StatefulSetList, error) {
	list := &appsv1.StatefulSetList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListDaemonSets(ctx context.Context, namespace string) (*appsv1.DaemonSetList, error) {
	list := &appsv1.DaemonSetList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListJobs(ctx context.Context, namespace string) (*batchv1.JobList, error) {
	list := &batchv1.JobList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListCronJobs(ctx context.Context, namespace string) (*batchv1.CronJobList, error) {
	list := &batchv1.CronJobList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListServices(ctx context.Context, namespace string) (*corev1.ServiceList, error) {
	list := &corev1.ServiceList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListIngresses(ctx context.Context, namespace string) (*networkingv1.IngressList, error) {
	list := &networkingv1.IngressList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) GetConfigMap(ctx context.Context, namespace, name string) (*corev1.ConfigMap, error) {
	cm := &corev1.ConfigMap{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, cm); err != nil {
		return nil, err
	}
	return cm, nil
}

func (c *Client) ListConfigMaps(ctx context.Context, namespace string) (*corev1.ConfigMapList, error) {
	list := &corev1.ConfigMapList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListSecrets(ctx context.Context, namespace string) (*corev1.SecretList, error) {
	list := &corev1.SecretList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) ListEvents(ctx context.Context, namespace string) (*corev1.EventList, error) {
	list := &corev1.EventList{}
	if err := c.client.List(ctx, list, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	return list, nil
}

// ── Resource event handler factory ──

type resourceHandler struct {
	kind    string
	watcher *Watcher
}

func newResourceHandler(kind string, w *Watcher) *resourceHandler {
	return &resourceHandler{kind: kind, watcher: w}
}

func (h *resourceHandler) OnAdd(obj interface{}, _ bool) {
	meta, ok := obj.(metav1.ObjectMetaAccessor)
	if !ok {
		return
	}
	h.watcher.Notify(ResourceEvent{
		Type:         EventAdded,
		ResourceKind: h.kind,
		Namespace:    meta.GetObjectMeta().GetNamespace(),
		Name:         meta.GetObjectMeta().GetName(),
		Resource:     obj,
	})
}

func (h *resourceHandler) OnUpdate(_, newObj interface{}) {
	meta, ok := newObj.(metav1.ObjectMetaAccessor)
	if !ok {
		return
	}
	h.watcher.Notify(ResourceEvent{
		Type:         EventModified,
		ResourceKind: h.kind,
		Namespace:    meta.GetObjectMeta().GetNamespace(),
		Name:         meta.GetObjectMeta().GetName(),
		Resource:     newObj,
	})
}

func (h *resourceHandler) OnDelete(obj interface{}) {
	meta, ok := obj.(metav1.ObjectMetaAccessor)
	if !ok {
		return
	}
	h.watcher.Notify(ResourceEvent{
		Type:         EventDeleted,
		ResourceKind: h.kind,
		Namespace:    meta.GetObjectMeta().GetNamespace(),
		Name:         meta.GetObjectMeta().GetName(),
		Resource:     obj,
	})
}
