// Loads modules, units and configs from the module library
// (physiomelinks/circulatory-autogen-modules) through its manifest.
// Switched on with VITE_LOAD_MODULE_LIBRARY; see the README for the settings.
const GITHUB_ORG = 'physiomelinks'
const REPO = 'circulatory-autogen-modules'
const DEFAULT_REF = 'main'
const CURRENT_MANIFEST_PATH = `manifests/vitalworkshop.json`

// import.meta.env only exists under Vite; keep this module importable from Node.
const ENV = import.meta.env ?? {}

// Manifest collections loaded at startup. The manifest's `parameters` apply to
// workspace nodes, so they are not loaded here.
const LIBRARY_COLLECTIONS = ['modules', 'units', 'configs']

function buildModuleLibraryBaseUrl(ref = DEFAULT_REF) {
  return `https://cdn.jsdelivr.net/gh/${GITHUB_ORG}/${REPO}@${ref}/`
}

function getModuleLibrarySettings(env = ENV) {
  const ref = env.VITE_MODULE_LIBRARY_REF || DEFAULT_REF
  const customUrl = env.VITE_MODULE_LIBRARY_URL
  return {
    enabled: String(env.VITE_LOAD_MODULE_LIBRARY ?? '').toLowerCase() === 'true',
    ref,
    baseUrl: customUrl ? customUrl.replace(/\/?$/, '/') : buildModuleLibraryBaseUrl(ref),
    manifestPath: CURRENT_MANIFEST_PATH,
  }
}

function getUrlForResource(path, settings = getModuleLibrarySettings()) {
  return settings.baseUrl + (path ?? settings.manifestPath)
}

function getPurgedUrlForResource(path, settings = getModuleLibrarySettings()) {
  return getUrlForResource(path, settings).replace('://cdn.', '://purge.')
}

async function fetchOk(url, fetchFn) {
  const response = await fetchFn(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`)
  }
  return response
}

async function loadManifest(settings = getModuleLibrarySettings(), fetchFn = globalThis.fetch) {
  const response = await fetchOk(getUrlForResource(settings.manifestPath, settings), fetchFn)
  const manifest = await response.json()
  return manifest.collections
}

/**
 * Fetch the module library's CellML modules, units and module configs listed
 * in its manifest. Never throws: every failure (manifest or file) is returned
 * in `failures` so the caller can warn and carry on with the bundled assets.
 *
 * @returns {Promise<{modules: Array, units: Array, configs: Array, failures: Array}>}
 *   Each loaded entry is the manifest entry plus `url` and `content` (text for
 *   CellML, the parsed JSON array for configs).
 */
async function fetchModuleLibraryResources({ settings = getModuleLibrarySettings(), fetchFn = globalThis.fetch } = {}) {
  const result = { modules: [], units: [], configs: [], failures: [] }

  let collections
  try {
    collections = await loadManifest(settings, fetchFn)
  } catch (error) {
    result.failures.push({ collection: 'manifest', url: getUrlForResource(settings.manifestPath, settings), error })
    return result
  }

  const tasks = []
  for (const collection of LIBRARY_COLLECTIONS) {
    for (const entry of collections?.[collection] ?? []) {
      const url = getUrlForResource(entry.path, settings)
      tasks.push(
        (async () => {
          try {
            const response = await fetchOk(url, fetchFn)
            const content = collection === 'configs' ? await response.json() : await response.text()
            result[collection].push({ ...entry, url, content })
          } catch (error) {
            result.failures.push({ collection, name: entry.name, file: entry.file, url, error })
          }
        })()
      )
    }
  }
  await Promise.all(tasks)

  return result
}

export {
  buildModuleLibraryBaseUrl,
  fetchModuleLibraryResources,
  getModuleLibrarySettings,
  getPurgedUrlForResource,
  getUrlForResource,
  loadManifest,
}
