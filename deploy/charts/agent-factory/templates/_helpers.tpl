{{/*
Generate a prefixed name for factory resources.
*/}}
{{- define "agent-factory.fullname" -}}
{{- printf "%s" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "agent-factory.agentName" -}}
{{- printf "%s-%s" (include "agent-factory.fullname" .) .name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "agent-factory.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
agentops.dev/factory: {{ include "agent-factory.fullname" . }}
agentops.dev/domain: {{ .Values.factory.domain }}
{{- end }}
