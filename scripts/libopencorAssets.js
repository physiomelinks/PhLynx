/**
 * Vite plugin serving libOpenCOR's WebAssembly build at /libopencor/<version>/: from node_modules in dev,
 * and copied into the build. The glue starts its threads from its own URL, so it stays unbundled.
 */
import fs from 'fs'
import path from 'path'

const PACKAGE_DIR = path.resolve(import.meta.dirname, '../node_modules/@opencor/libopencor')
const FILES = { 'libopencor.js': 'text/javascript', 'libopencor.wasm': 'application/wasm' }
// Copied with the build, as libOpenCOR's Apache-2.0 licence asks of redistributions.
const LICENCE = 'LICENSE.txt'

/**
 * Gets the installed libOpenCOR version.
 *
 * @returns {string}
 */
export function getLibOpenCORVersion() {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')).version
}

/**
 * Creates the plugin, and defines __LIBOPENCOR_BASE__ as the URL the files are served from.
 *
 * @returns {import('vite').Plugin}
 */
export function libopencorAssets() {
  const base = `/libopencor/${getLibOpenCORVersion()}/`
  let outDir = null

  return {
    name: 'libopencor-assets',
    config: () => ({ define: { __LIBOPENCOR_BASE__: JSON.stringify(base) } }),
    configResolved(config) {
      // Only a build writes files; Vitest closes its server with a placeholder outDir.
      if (config.command === 'build') outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use(base, (req, res, next) => {
        const name = req.url.split('?')[0].replace(/^\//, '')
        if (!FILES[name]) return next()
        res.setHeader('Content-Type', FILES[name])
        fs.createReadStream(path.join(PACKAGE_DIR, 'dist', name)).pipe(res)
      })
    },
    closeBundle() {
      if (!outDir) return
      const target = path.join(outDir, base)
      fs.mkdirSync(target, { recursive: true })
      for (const name of Object.keys(FILES)) fs.copyFileSync(path.join(PACKAGE_DIR, 'dist', name), path.join(target, name))
      fs.copyFileSync(path.join(PACKAGE_DIR, LICENCE), path.join(target, LICENCE))
    },
  }
}
