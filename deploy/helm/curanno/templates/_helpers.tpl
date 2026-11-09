{{- define "curanno.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "curanno.fullname" -}}
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

{{- define "curanno.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "curanno.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "curanno.selectorLabels" -}}
app.kubernetes.io/name: {{ include "curanno.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "curanno.embedded" -}}
{{- if eq .Values.auth.mode "embedded" }}true{{- end }}
{{- end }}

{{/* Fails the render for settings that cannot work together. */}}
{{- define "curanno.validate" -}}
{{- if not (has .Values.auth.mode (list "external" "embedded")) }}
{{- fail "auth.mode must be external or embedded" }}
{{- end }}
{{- if and (include "curanno.embedded" .) .Values.zitadel.provision.enabled }}
{{- fail "zitadel.provision.enabled is for auth.mode=external" }}
{{- end }}
{{- if and (include "curanno.embedded" .) (not .Values.secrets.existingSecret) (lt (len (default "" .Values.secrets.authSecret)) 32) }}
{{- fail "secrets.authSecret (at least 32 characters) is required when auth.mode=embedded" }}
{{- end }}
{{- if not (has .Values.auth.signup (list "approval" "open" "closed")) }}
{{- fail "auth.signup must be approval, open or closed" }}
{{- end }}
{{- end }}

{{- define "curanno.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{- define "curanno.webImage" -}}
{{- printf "%s:%s" .Values.web.image.repository (default .Chart.AppVersion .Values.web.image.tag) }}
{{- end }}

{{- define "curanno.secretName" -}}
{{- default (include "curanno.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{/* Written by the Zitadel provisioning Job, not by Helm. */}}
{{- define "curanno.oidcConfigMap" -}}
{{- printf "%s-oidc" (include "curanno.fullname" .) }}
{{- end }}

{{/* The client id from the provisioning Job's ConfigMap, as the variable `name`. */}}
{{- define "curanno.provisionedClientId" -}}
- name: {{ .name }}
  valueFrom:
    configMapKeyRef:
      name: {{ include "curanno.oidcConfigMap" .root }}
      key: OIDC_CLIENT_ID
{{- end }}

{{/* Environment shared by the API container and the migration init container. */}}
{{- define "curanno.containerEnv" -}}
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: {{ include "curanno.secretName" . }}
        key: {{ .Values.secrets.databaseUrlKey }}
  {{- if .Values.zitadel.provision.enabled }}
  {{- include "curanno.provisionedClientId" (dict "root" . "name" "OIDC_CLIENT_ID") | nindent 2 }}
  {{- end }}
  {{- if include "curanno.embedded" . }}
  - name: AUTH_SECRET
    valueFrom:
      secretKeyRef:
        name: {{ include "curanno.secretName" . }}
        key: AUTH_SECRET
  {{- if and .Values.auth.mail.from (or .Values.secrets.smtpUrl .Values.secrets.existingSecret) }}
  - name: SMTP_URL
    valueFrom:
      secretKeyRef:
        name: {{ include "curanno.secretName" . }}
        key: SMTP_URL
        optional: true
  {{- end }}
  {{- range $id, $upper := dict "google" "GOOGLE" "github" "GITHUB" "oidc" "OIDC" }}
  {{- if (index $.Values.auth.providers $id).clientId }}
  - name: UPSTREAM_{{ $upper }}_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: {{ include "curanno.secretName" $ }}
        key: UPSTREAM_{{ $upper }}_CLIENT_SECRET
  {{- end }}
  {{- end }}
  {{- end }}
envFrom:
  - configMapRef:
      name: {{ include "curanno.fullname" . }}
{{- end }}
