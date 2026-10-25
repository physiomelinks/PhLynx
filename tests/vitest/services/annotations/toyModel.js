import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')

// Which toy module each toy instance runs.
export const TOY_MODULES = {
  outside: 'pool',
  cell: 'pool',
  wall: 'wall',
  porter_in: 'porter',
  porter_out: 'porter',
  vessel: 'pool',
}

/**
 * Loads the toy ApiCoords and sidecars.
 *
 * @param {string} [apicoordsText] - Replaces the toy ApiCoords.
 * @returns {Promise<{ instances: Array, coords: Map, scopes: Map, sidecars: Map }>}
 */
export async function loadToy(apicoordsText = read('toy-apicoords.ttl')) {
  const { instances, coords, scopes } = await parseApiCoords(apicoordsText)
  const sidecars = new Map()
  for (const name of new Set(Object.values(TOY_MODULES))) {
    sidecars.set(
      name,
      await parseSidecar(read(`${name}.ttl`), { mathRef: `${name}.cellml:${name}`, cellml: read(`${name}.cellml`) })
    )
  }
  return {
    instances: instances.map((instance) => ({ ...instance, sidecar: sidecars.get(TOY_MODULES[instance.name]) })),
    coords,
    scopes,
    sidecars,
  }
}

export const readToy = read
