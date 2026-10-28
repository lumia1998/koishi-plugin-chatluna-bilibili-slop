import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 只打客户端那点东西：dist/index.js + dist/style.css。
 * 服务端仍由 build.mjs(esbuild) 出 lib/index.cjs，两边互不干扰。
 *
 * 控制台的 loader 会 import(`/<uiPath>/@plugin-<id>/index.js`)，
 * 所以产物必须是 ESM，且 vue / @koishijs/client 不能打进来（与控制台共用实例）。
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: 'client/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['vue', 'vue-router', '@vueuse/core', '@koishijs/client'],
    },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2019',
  },
})
