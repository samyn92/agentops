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
Resolve the integration name based on explicit role first, then agent mode:
  integrationRole: planner → planner integration
  integrationRole: coder   → coder integration
  default daemon           → planner integration
  default task             → coder integration
*/}}
{{- define "factory.integrationFor" -}}
{{- $role := default "" .integrationRole -}}
{{- if eq $role "planner" -}}
{{ include "factory.fullname" .root }}-planner
{{- else if eq $role "coder" -}}
{{ include "factory.fullname" .root }}-coder
{{- else if eq .mode "daemon" -}}
{{ include "factory.fullname" .root }}-planner
{{- else -}}
{{ include "factory.fullname" .root }}-coder
{{- end -}}
{{- end }}
