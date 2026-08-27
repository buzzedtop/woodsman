<script lang="ts">
  import { onMount } from 'svelte';
  let { children } = $props();

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('ServiceWorker registration successful');
        })
        .catch(err => {
          console.log('ServiceWorker registration failed: ', err);
        });
    }
  });
</script>
{@render children()}
<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: #000;
    color: #fff;
    font-family: sans-serif;
  }
</style>
