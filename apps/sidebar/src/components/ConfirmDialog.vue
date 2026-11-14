<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  AlertDialogTrigger,
} from 'reka-ui';

/** Asks before a destructive action; the slot is the button that opens it. */
defineProps<{ title: string; description: string; action: string }>();
const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
  <AlertDialogRoot>
    <AlertDialogTrigger as-child>
      <slot />
    </AlertDialogTrigger>
    <AlertDialogPortal>
      <AlertDialogOverlay class="confirm-overlay" />
      <AlertDialogContent class="confirm">
        <AlertDialogTitle class="confirm-title">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription class="confirm-description">{{
          description
        }}</AlertDialogDescription>
        <div class="confirm-actions">
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <AlertDialogAction type="button" class="danger" @click="emit('confirm')">
            {{ action }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<!-- Not scoped: the dialog is drawn in a portal outside any component. -->
<style>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgb(0 0 0 / 0.35);
}

.confirm {
  position: fixed;
  z-index: 21;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(22rem, calc(100vw - 2rem));
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
}

.confirm-title {
  margin: 0 0 0.4rem;
  font-size: 1rem;
}

.confirm-description {
  margin: 0 0 0.9rem;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
