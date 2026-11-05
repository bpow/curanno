{{- define "annotations.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "annotations.fullname" -}}
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

{{- define "annotations.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "annotations.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "annotations.selectorLabels" -}}
app.kubernetes.io/name: {{ include "annotations.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "annotations.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{- define "annotations.webImage" -}}
{{- printf "%s:%s" .Values.web.image.repository (default .Chart.AppVersion .Values.web.image.tag) }}
{{- end }}

{{- define "annotations.secretName" -}}
{{- default (include "annotations.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{/* Written by the Zitadel provisioning Job, not by Helm. */}}
{{- define "annotations.oidcConfigMap" -}}
{{- printf "%s-oidc" (include "annotations.fullname" .) }}
{{- end }}

{{/* The client id from the provisioning Job's ConfigMap, as the variable `name`. */}}
{{- define "annotations.provisionedClientId" -}}
- name: {{ .name }}
  valueFrom:
    configMapKeyRef:
      name: {{ include "annotations.oidcConfigMap" .root }}
      key: OIDC_CLIENT_ID
{{- end }}

{{/* Environment shared by the API container and the migration init container. */}}
{{- define "annotations.containerEnv" -}}
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: {{ include "annotations.secretName" . }}
        key: {{ .Values.secrets.databaseUrlKey }}
  {{- if .Values.zitadel.provision.enabled }}
  {{- include "annotations.provisionedClientId" (dict "root" . "name" "OIDC_CLIENT_ID") | nindent 2 }}
  {{- end }}
envFrom:
  - configMapRef:
      name: {{ include "annotations.fullname" . }}
{{- end }}
