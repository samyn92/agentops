---
title: "Providers"
linkTitle: "Providers"
weight: 2
description: "Provider CRD, supported backends, endpoint configuration, and per-call defaults."
---

A **Provider** extracts LLM provider configuration from individual Agent CRs into a shared, reusable Kubernetes resource. Instead of repeating provider type, credentials, and endpoint settings across every agent, you define them once in a Provider CR and reference it from any number of agents via `spec.providerRefs`.

## Provider CRD spec

The Provider CRD (`providers.agents.agentops.io`, short name `prov`) maps directly to the Fantasy SDK's provider surface. Here is a representative example:

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Provider
metadata:
  name: anthropic
  namespace: agents
spec:
  # ── Backend ──
  type: anthropic                 # Fantasy SDK provider backend

  # ── Credentials ──
  apiKeySecret:
    name: llm-api-keys
    key: ANTHROPIC_API_KEY

  # ── Per-call defaults (optional) ──
  defaults:
    anthropic:
      effort: high                # extended thinking effort
      thinkingBudgetTokens: 8192
```

### Spec reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `anthropic` \| `openai` \| `google` \| `azure` \| `bedrock` \| `openrouter` \| `openaicompat` | Yes | -- | Fantasy SDK backend type. |
| `apiKeySecret` | SecretKeyRef | Yes | -- | Secret containing the API key. Validated on reconcile. |
| `endpoint` | ProviderEndpoint | No | -- | API endpoint overrides (base URL, custom headers). |
| `config` | ProviderConfig | No | -- | Type-specific configuration (org, project, Vertex, Bedrock, Responses API). |
| `defaults` | ProviderCallDefaults | No | -- | Per-call options applied to all agents using this provider. |

See the [CRD Reference]({{< relref "../reference/crds#provider" >}}) for the full field-level specification.

## Supported backends

The Provider CRD supports all seven backends in the Fantasy SDK v0.17.1:

| Type | SDK Package | Description |
|------|-------------|-------------|
| `anthropic` | `fantasy/providers/anthropic` | Anthropic API (Claude models). Supports Vertex AI and Bedrock via `config`. |
| `openai` | `fantasy/providers/openai` | OpenAI API (GPT, o-series models). Supports Responses API, organization/project headers. |
| `google` | `fantasy/providers/google` | Google Gemini API. Supports Vertex AI via `config.vertex`. |
| `azure` | `fantasy/providers/azure` | Azure OpenAI. Wraps the OpenAI SDK with Azure-specific auth and API versioning. |
| `bedrock` | `fantasy/providers/bedrock` | AWS Bedrock. Wraps the Anthropic SDK with Bedrock auth. |
| `openrouter` | `fantasy/providers/openrouter` | OpenRouter API. Routes to multiple backends via a single API key. |
| `openaicompat` | `fantasy/providers/openaicompat` | Any OpenAI-compatible API. Requires `endpoint.baseURL`. |

## How agents reference providers

Agents reference providers via `spec.providerRefs`:

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Agent
metadata:
  name: my-agent
  namespace: agents
spec:
  model: anthropic/claude-sonnet-4-20250514
  providerRefs:
    - name: anthropic
    - name: openai
  fallbackModels:
    - openai/gpt-4o
```

The operator resolves each referenced Provider CR, validates it is `Ready`, and builds an enriched config.json for the agent runtime. The runtime uses the provider's `type` field for type-based SDK dispatch with full option wiring --- base URL, headers, Vertex/Bedrock config, Responses API, and per-call defaults are all passed to the SDK constructor.

### Per-agent overrides

Agents can override a provider's call defaults without modifying the shared Provider CR:

```yaml
providerRefs:
  - name: anthropic
    overrides:
      anthropic:
        effort: max
        thinkingBudgetTokens: 16384
```

The merge order is: Provider CR defaults (lowest) then agent-level overrides (highest). The operator merges them into the agent's config.json at reconcile time.

## Provider examples

### OpenAI-compatible (Kimi, Ollama, vLLM)

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Provider
metadata:
  name: kimi
  namespace: agents
spec:
  type: openaicompat
  apiKeySecret:
    name: llm-api-keys
    key: KIMI_API_KEY
  endpoint:
    baseURL: "https://api.moonshot.ai/v1"
```

### Anthropic with extended thinking

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Provider
metadata:
  name: anthropic
  namespace: agents
spec:
  type: anthropic
  apiKeySecret:
    name: llm-api-keys
    key: ANTHROPIC_API_KEY
  defaults:
    anthropic:
      effort: high
      thinkingBudgetTokens: 8192
```

### Google Vertex AI

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Provider
metadata:
  name: google-vertex
  namespace: agents
spec:
  type: google
  apiKeySecret:
    name: llm-api-keys
    key: GOOGLE_API_KEY
  config:
    vertex:
      project: my-gcp-project
      location: us-central1
```

### Azure OpenAI with Responses API

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Provider
metadata:
  name: azure-openai
  namespace: agents
spec:
  type: azure
  apiKeySecret:
    name: llm-api-keys
    key: AZURE_API_KEY
  endpoint:
    baseURL: "https://my-deployment.openai.azure.com"
  config:
    azureAPIVersion: "2025-01-01-preview"
    useResponsesAPI: true
```

## Operator behavior

The Provider controller reconciles the following:

| Check | Result |
|-------|--------|
| Secret exists and contains the expected key | Phase → `Ready` |
| Secret missing or key not found | Phase → `Failed`, condition message explains the issue |
| Agent references a non-existent Provider | Agent condition `ProvidersReady` → `False` |
| Agent references a Provider in `Failed` phase | Agent condition `ProvidersReady` → `False` |

The controller also watches Secrets and Agents. When a Secret changes, all Providers referencing it are re-reconciled. When an Agent changes, the `status.boundAgents` count on referenced Providers is updated.

```bash
kubectl get providers -n agents
```

```
NAME        TYPE           PHASE   AGENTS   AGE
anthropic   anthropic      Ready   2        5m
kimi        openaicompat   Ready   6        5m
```
