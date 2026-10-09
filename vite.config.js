import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import Markdown from 'unplugin-vue-markdown/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import LinkAttributes from 'markdown-it-link-attributes'
import MarkdownItAttrs from 'markdown-it-attrs'
import MarkdownItGitHubAlerts from 'markdown-it-github-alerts'
import packageJson from './package.json'
import { execSync } from 'child_process'
import { libopencorAssets } from './scripts/libopencorAssets.js'

const latestChangelogPath = path.resolve(__dirname, 'changelogs/latest.md')

let buildStateMarker = ''
if (fs.existsSync(latestChangelogPath)) {
  const content = fs.readFileSync(latestChangelogPath, 'utf8')
  if (content.trim().length > 0) {
    buildStateMarker = '*'
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    // Create a global constant. Strings must be JSON stringified.
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_STATE_MARKER__: JSON.stringify(buildStateMarker),
    __COMMIT_HASH__: JSON.stringify(execSync('git rev-parse --short HEAD').toString().trim()),
    __BRANCH__: JSON.stringify(execSync('git rev-parse --abbrev-ref HEAD').toString().trim()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  worker: {
    // The simulator's worker imports libOpenCOR's glue, an ES module, at run time.
    format: 'es',
  },
  optimizeDeps: {
    // Exclude the wasm-based library from pre-bundling
    exclude: ['vue3-libcellml.js'],
    esbuildOptions: {
      target: 'es2020',
    },
  },
  plugins: [
    vue({
      include: [/\.vue$/, /\.md$/],
    }),
    tailwindcss(),
    libopencorAssets(),
    Markdown({
      headEnabled: false, // Set true to manage <head> tags
      markdownItSetup(md) {
        // Enable the attribute syntax
        md.use(MarkdownItAttrs)
        md.use(LinkAttributes, {
          pattern: /^https?:\/\//,
          attrs: {
            target: '_blank',
            rel: 'noopener',
          },
        })
        md.use(MarkdownItGitHubAlerts)
      },
      markdownItOptions: {
        html: true,
        linkify: true,
        typographer: true,
      },
    }),
    visualizer(),
  ],
  resolve: {
    alias: {
      '@docs': path.resolve(__dirname, './docs'),
    },
    // One copy of protocol-kit's peers, PhLynx's, even when the package is linked from a checkout with its own.
    dedupe: ['vue', 'primevue', 'papaparse'],
  },
  server: {
    watch: {
      ignored: ['**/tests/playwright/**'],
    },
    fs: {
      // Allow serving files from one level up to the project root
      // allow: [
      // "..",
      // ],
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    exclude: ['tests/playwright/**', 'tests/e2e/**', 'node_modules/**'],
  },
})
