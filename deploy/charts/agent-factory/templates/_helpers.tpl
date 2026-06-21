{{/*
agent-factory helpers
*/}}

{{- define "factory.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "factory.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
agentops.dev/factory: {{ include "factory.fullname" . }}
agentops.dev/domain: {{ .Values.factory.domain }}
{{- end }}

{{/*
Resolve the integration name based on agent mode:
  daemon → planner integration (read-only)
  task → coder integration (read-write)
*/}}
{{- define "factory.integrationFor" -}}
{{- if eq .mode "daemon" -}}
{{ include "factory.fullname" .root }}-planner
{{- else -}}
{{ include "factory.fullname" .root }}-coder
{{- end -}}
{{- end }}
