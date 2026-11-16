// @vitest-environment node
// The CellDL editor and converter are megabytes of lazy chunks: only the CellDL service and its
// components may name them, and those import them dynamically, so the main bundle never holds them.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '../../../../src')
// The live conversion's worker is a bundle of its own, so may import them statically.
const ALLOWED = ['services/celldl/', 'components/celldl/', 'workers/celldlConvertWorker.js']
const PACKAGES = ['@celldl/editor', '@physiomelinks/bg2cellml']

/** `import … from '<pkg>'`, `import '<pkg>'` or `export … from '<pkg>'`, for a package or its subpaths. */
const STATIC_IMPORT = new RegExp(
  String.raw`^\s*(?:import|export)\s+(?:[^'"()]*?\bfrom\s+)?['"](?:${PACKAGES.map((name) => name.replace('/', '\\/')).join('|')})(?:\/[^'"]*)?['"]`,
  'm'
)

/** Every source file under `dir`, relative to src. */
function sourceFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(js|mjs|ts|vue)$/.test(entry.name) ? [path.relative(SRC, full).split(path.sep).join('/')] : []
  })
}

describe('CellDL packages are only imported dynamically', () => {
  it('recognises static imports, not dynamic ones', () => {
    expect(STATIC_IMPORT.test("import { CellDLEditor } from '@celldl/editor'")).toBe(true)
    expect(STATIC_IMPORT.test("import '@celldl/editor/style.css'")).toBe(true)
    expect(STATIC_IMPORT.test('import {\n  Converter,\n} from "@physiomelinks/bg2cellml"')).toBe(true)
    expect(STATIC_IMPORT.test("export { Converter } from '@physiomelinks/bg2cellml'")).toBe(true)
    expect(STATIC_IMPORT.test("const editor = await import('@celldl/editor')")).toBe(false)
    expect(STATIC_IMPORT.test("defineAsyncComponent(() => import('@celldl/editor'))")).toBe(false)
  })

  it('has no static import of them outside the CellDL service and components', () => {
    const offenders = sourceFiles()
      .filter((file) => !ALLOWED.some((dir) => file.startsWith(dir)))
      .filter((file) => STATIC_IMPORT.test(fs.readFileSync(path.join(SRC, file), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('has none in the CellDL service either', () => {
    const offenders = sourceFiles(path.join(SRC, 'services/celldl')).filter((file) =>
      STATIC_IMPORT.test(fs.readFileSync(path.join(SRC, file), 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})
