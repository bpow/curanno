<script setup lang="ts">
import { bookmarkletUrl } from '@curanno/guest';
import { onMounted, ref } from 'vue';
import { NuxtLink } from '#components';
import { useRuntimeConfig } from '#imports';

/**
 * The bookmarklet is built in the browser from this site's origin: the
 * guest bundle and the sidebar are served under it by the API (ADR 0021).
 * The server renders the page without it, since the origin is the client's.
 */
const config = useRuntimeConfig();
const bookmarklet = ref<string>();
const viewer = ref<string>(config.public.pdfViewerUrl);
onMounted(() => {
  const origin = config.public.apiBase || window.location.origin;
  bookmarklet.value = bookmarkletUrl({
    bundleUrl: `${origin}/guest.js`,
    sidebarOrigin: new URL(origin).origin,
    sidebarPath: '/sidebar/',
    ...(viewer.value ? { pdfViewerUrl: viewer.value } : {}),
  });
});
</script>

<template>
  <section class="prose">
    <h1>Annotation platform</h1>
    <p>
      Annotate web pages and PDFs, share what you write, and work in groups. Everything here goes
      through the public API with your own login.
    </p>
    <h2>Install the bookmarklet</h2>
    <p>
      Drag <a v-if="bookmarklet" class="bookmarklet" :href="bookmarklet">Annotate</a
      ><span v-else class="bookmarklet">Annotate</span> to your bookmarks bar, then click it on any
      page to open the annotation sidebar. It holds no credentials; you sign in from the sidebar.
    </p>
    <p v-if="viewer">
      For a PDF, open <a :href="viewer">the viewer</a> and give it the file's address, or choose a
      file from your computer. The user guide (<code>docs/user-guide.md</code>) has the details.
    </p>
    <h2>Manage</h2>
    <p>
      <NuxtLink to="/groups">Groups</NuxtLink> · <NuxtLink to="/browse">Annotations</NuxtLink> ·
      <NuxtLink to="/me">Your account</NuxtLink>
    </p>
  </section>
</template>

<style scoped>
.bookmarklet {
  display: inline-block;
  padding: 0.2rem 0.7rem;
  border: 1px solid currentColor;
  border-radius: 4px;
  font-weight: 600;
  text-decoration: none;
}
</style>
