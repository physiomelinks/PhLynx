import { readFileSync } from 'fs'
import { resolve } from 'path'
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
 * Loads the toy sidecars.
 *
 * @returns {Promise<{ sidecars: Map<string, Object> }>} Each toy module's parsed sidecar, by module name.
 */
export async function loadToy() {
  const sidecars = new Map()
  for (const name of new Set(Object.values(TOY_MODULES))) {
    sidecars.set(
      name,
      await parseSidecar(read(`${name}.ttl`), { mathRef: `${name}.cellml:${name}`, cellml: read(`${name}.cellml`) })
    )
  }
  return { sidecars }
}

export const readToy = read
