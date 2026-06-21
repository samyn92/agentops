{{/*
Expand the name of the chart.
*/}}
{{- define "agentops-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "agentops-platform.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "agentops-platform.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agentops-platform.labels" -}}
helm.sh/chart: {{ include "agentops-platform.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: agentops-platform
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

{{/*
Memory service name — used by both the Service template and the console env wiring.
*/}}
{{- define "agentops-platform.memory.serviceName" -}}
{{- printf "%s-memory" (include "agentops-platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Memory in-cluster URL — resolved from the service name and agent namespace.
*/}}
{{- define "agentops-platform.memory.url" -}}
{{- printf "http://%s.%s.svc.cluster.local:7437" (include "agentops-platform.memory.serviceName" .) .Values.agentNamespace }}
{{- end }}

{{/*
Tempo in-cluster URL — resolved from the release name.
*/}}
{{- define "agentops-platform.tempo.url" -}}
{{- printf "http://%s-tempo.%s.svc.cluster.local:3200" .Release.Name .Release.Namespace }}
{{- end }}

{{/*
Tempo OTLP gRPC endpoint — for agent tracing.
*/}}
{{- define "agentops-platform.tempo.otlpEndpoint" -}}
{{- printf "%s-tempo.%s.svc.cluster.local:4317" .Release.Name .Release.Namespace }}
{{- end }}

{{/*
NATS in-cluster URL — used by runtime (publisher) and console (subscriber).
*/}}
{{- define "agentops-platform.nats.url" -}}
{{- printf "nats://%s-nats.%s.svc.cluster.local:4222" .Release.Name .Release.Namespace }}
{{- end }}
