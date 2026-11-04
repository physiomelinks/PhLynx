import { TOY_MODULES, readToy } from '../annotations/toyModel.js'

const STANDARD_UNITS = new Set(['second', 'dimensionless', 'mole', 'metre', 'litre', 'volt', 'ampere'])

/**
 * A units model defining every non-standard units name the maths use, as plain dimensionless units.
 *
 * @param {string[]} maths - CellML texts.
 * @returns {string}
 */
export function unitsFor(maths) {
  const names = new Set(maths.flatMap((math) => [...math.matchAll(/\bunits="([^"]+)"/g)].map((m) => m[1])))
  const defined = [...names].filter((name) => !STANDARD_UNITS.has(name))
  return `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
${defined.map((name) => `  <units name="${name}"><unit units="dimensionless"/></units>`).join('\n')}
</model>`
}

const TOY_MATHS = [...new Set(Object.values(TOY_MODULES))]
export const TOY_UNITS = unitsFor(TOY_MATHS.map((name) => readToy(`${name}.cellml`)))

/**

/**
 * Puts the toy maths and their sidecars in the library, and makes one node per toy instance.
 *
 * @param {Object} library - A libraryStore.
 * @returns {{ nodes: Array }}
 */
export function toyWorkspace(library) {
  library.addUnitsFile({ componentFile: 'units.cellml', model: TOY_UNITS })
  for (const name of TOY_MATHS) {
    library.addMathFile(`${name}.cellml`, [{ name, math: readToy(`${name}.cellml`) }])
    library.setModuleAnnotations(`${name}.cellml:${name}`, readToy(`${name}.ttl`))
  }
  const nodes = Object.entries(TOY_MODULES).map(([name, module], i) => ({
    id: `n${i}`,
    type: 'instanceNode',
    position: { x: 0, y: 0 },
    data: { name, mathRef: `${module}.cellml:${module}`, variables: [], ports: [] },
  }))
  return { nodes }
}
