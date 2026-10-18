/**
 * circulatory_autogen (CA) rules that PhLynx follows only where it reads or writes CA's files: a heart's entrance
 * slots, and warnings about the junction types and multi_port shapes CA wires by vessel type. PhLynx's own coupling
 * (utils/edges.js) and CellML know none of them.
 */
import { BASE_SUBTYPE_KEY } from '../utils/config'
import { PORT_TYPE_OPTIONS } from '../utils/constants'
import { notify } from '../utils/notify'
import { isHeart, listNamed } from './export/caCellml'

export { isHeart }

/** The heart's entrance port whose slots (ivc, svc, pulmonary) CA gives by place in its inp_vessels. */
export const HEART_PORT = 'vessel_port'
/** The heart's ivc flow, which CA feeds from its zero_flow module when the heart has two inputs. */
export const HEART_IVC_FLOW = 'v_ivc'
// The names CA needs at least one of among the heart's inputs.
const HEART_VENOUS_INPUTS = ['venous_ivc', 'venous_svc']
// The pulmonary vein CA adds as the last input of a heart with fewer than two outputs.
const PULMONARY_VEIN = 'pvn'

// Port labels carrying a flow, and the module types CA gives flow rules (terminal, junction, venous).
const FLOW_PORTS = new Set(['vessel_port', 'flow_port'])
const FLOW_RULE_TYPE = /terminal|junction|^venous/i

/**
 * Splits a module array's inp_instances or out_instances into names.
 *
 * @param {string} [names]
 * @returns {string[]}
 */
export function instanceNames(names) {
  return (names ?? '').split(/\s+/).filter(Boolean)
}

/**
 * Lists a heart's inputs as CA wires them: with fewer than two outputs, CA adds a pulmonary vein input last.
 *
 * @param {string[]} inputs - The heart's inp_instances.
 * @param {number} outputCount - How many out_instances it has.
 * @returns {string[]}
 */
export function caHeartInputs(inputs, outputCount) {
  return outputCount < 2 ? [...inputs, PULMONARY_VEIN] : inputs
}

/**
 * Gets the heart entrance slot CA gives an input: its place in the heart's inputs, one later with two inputs, as CA
 * then feeds the ivc slot from zero_flow.
 *
 * @param {string[]} inputs - The heart's inputs as CA wires them (see caHeartInputs), ordered ivc, svc, pulmonary.
 * @param {string} name - The input.
 * @returns {number} The slot, or -1 when the name is not an input.
 */
export function heartEntranceSlot(inputs, name) {
  const index = inputs.indexOf(name)
  return index === -1 ? -1 : index + (inputs.length === 2 ? 1 : 0)
}

/**
 * Gets the coupling that pins a heart's input to the entrance slot CA gives it, for resolvePortCouplings to prefer.
 *
 * @param {Array} heartPorts - The heart's ports.
 * @param {string[]} inputs - Its inputs as CA wires them.
 * @param {string} name - The input.
 * @returns {Array} The pinning coupling, or none when the name is not an input or has no slot.
 */
export function heartSlotPin(heartPorts, inputs, name) {
  const slot = heartEntranceSlot(inputs, name)
  const group = (heartPorts ?? []).filter((p) => p.portType === 'entrance_ports' && p.label === HEART_PORT)
  return group[slot] ? [{ targetPort: group[slot], targetSlot: slot }] : []
}

/**
 * Drops a parameters file's ivc flow rows of hearts whose ivc flow CA feeds from zero_flow, as CA deletes that
 * parameter.
 *
 * @param {Array<{variable_name: string}>} rows - Parameters file rows, `<variable>_<instance>`.
 * @param {string[]} hearts - The names of the hearts whose ivc flow is zeroed (see buildWorkflowGraph).
 * @returns {Array} The other rows.
 */
export function withoutZeroedIvcRows(rows, hearts) {
  // Matched as applyParametersToNodes matches a row to an instance's variable.
  const variableOf = (name, heart) => name.slice(0, -heart.length).replace(/_+$/, '').trim()
  const isZeroedIvc = (name) =>
    hearts.some((heart) => name.endsWith(heart) && variableOf(name, heart) === HEART_IVC_FLOW)
  return Array.from(rows ?? []).filter((row) => !isZeroedIvc(row.variable_name?.trimEnd() ?? ''))
}

/**
 * Checks a module array's hearts as CA does: at most one, with an input named venous_ivc or venous_svc.
 *
 * @param {Array<{name: string, module_type: string, inp_instances: string}>} rows
 * @throws {Error} naming the hearts, or the heart without a venous input.
 */
export function checkHearts(rows) {
  const hearts = rows.filter((row) => isHeart(row.module_type ?? ''))
  if (hearts.length > 1) {
    throw new Error(`CA allows one heart module, but ${listNamed(hearts.map((row) => row.name))} are hearts.`)
  }
  const [heart] = hearts
  if (heart && !instanceNames(heart.inp_instances).some((name) => HEART_VENOUS_INPUTS.includes(name))) {
    throw new Error(`CA needs venous_ivc, venous_svc or both, by those names, as inputs to the heart "${heart.name}".`)
  }
}

/**
 * Whether a module type is one of CA's Min_, Nout_ or MinNout_ junctions, which CA wires through its own junction
 * rules; deprecated in favour of multiport Sum and Multiply.
 *
 * @param {string} moduleType
 * @returns {boolean}
 */
export function isDeprecatedJunction(moduleType) {
  return /^(Min|Nout|MinNout)_/.test(moduleType ?? '') || /(Min|Nout)_junction/.test(moduleType ?? '')
}

/**
 * Lists the config entries, as `module_type:module_subtype`, of a terminal, junction or venous type with a flow port
 * whose multi_port is a whole-port True: CA's legacy shape, which CA's terminal rule sums but PhLynx links as one
 * value. Deprecated junctions are left to warnDeprecatedJunctions.
 *
 * @param {Object[]} configs - Module config entries.
 * @returns {string[]}
 */
export function legacyFlowPortModules(configs) {
  const isTrue = (value) => value === true || (typeof value === 'string' && value.toLowerCase() === 'true')
  return [
    ...new Set(
      (Array.isArray(configs) ? configs : [])
        .filter((entry) => FLOW_RULE_TYPE.test(entry?.module_type ?? '') && !isDeprecatedJunction(entry.module_type))
        .filter((entry) =>
          PORT_TYPE_OPTIONS.flatMap(({ value }) => entry[value] ?? []).some(
            (port) => FLOW_PORTS.has(port.port_type) && isTrue(port.multi_port)
          )
        )
        .map((entry) => `${entry.module_type}:${entry.module_subtype}`)
    ),
  ]
}

/**
 * Lists the entries of some config files that the library would add: the first entry of each ref it doesn't hold, as
 * libraryStore.addConfigFile keeps a module it already has and skips an entry without a component_file. A variant the
 * CA export wrote adds the module it stands in for, after the files' own entries.
 *
 * @param {Iterable<{payload: Object[]}>} files - Config files, staged or in an import payload; read before adding.
 * @param {(moduleRef: string) => boolean} hasModule - Whether the library holds a module ref.
 * @returns {Object[]}
 */
export function newConfigEntries(files, hasModule) {
  const seen = new Set()
  const entries = [...(files ?? [])]
    .flatMap((file) => (Array.isArray(file?.payload) ? file.payload : []))
    .filter((entry) => entry?.component_file && typeof entry.component_file === 'string')
  const isVariant = (entry) => typeof entry[BASE_SUBTYPE_KEY] === 'string' && entry[BASE_SUBTYPE_KEY] !== ''
  return [...entries.filter((entry) => !isVariant(entry)), ...entries.filter(isVariant)].filter((entry) => {
    const ref = `${entry.module_type}:${isVariant(entry) ? entry[BASE_SUBTYPE_KEY] : entry.module_subtype}`
    if (hasModule(ref) || seen.has(ref)) return false
    seen.add(ref)
    return true
  })
}

/**
 * The note about the deprecated junction types among some module types, each named once.
 *
 * @param {string[]} moduleTypes
 * @returns {{title: string, items: string[]}|null} Null without any.
 */
export function deprecatedJunctionsNote(moduleTypes) {
  const types = [...new Set(moduleTypes.filter(isDeprecatedJunction))]
  if (!types.length) return null
  const isOne = types.length === 1
  return {
    title: 'Deprecated Junction Types',
    items: [`${listNamed(types)} ${isOne ? 'is a' : 'are'} circulatory_autogen Min_/Nout_ junction type${isOne ? '' : 's'}, which ${isOne ? 'is' : 'are'} deprecated: PhLynx doesn't apply CA's junction rules, so it links their flows as one value. Use a multiport Sum (or Multiply) port instead.`],
  }
}

/**
 * Warns, once, about the deprecated junction types among some module types.
 *
 * @param {string[]} moduleTypes
 */
export function warnDeprecatedJunctions(moduleTypes) {
  const note = deprecatedJunctionsNote(moduleTypes)
  if (note) notify.warning(note)
}

/**
 * Warns about imported config entries in CA's legacy shapes: deprecated junction types, and flow ports linked by a
 * whole-port True (see legacyFlowPortModules).
 *
 * @param {Object[]} configs - Module config entries.
 * @param {Object} [options]
 * @param {boolean} [options.junctions=true] - Whether to warn about junction types, left out where the module array
 *   imported next warns about those it uses.
 */
export function warnLegacyConfigs(configs, { junctions = true } = {}) {
  const entries = Array.isArray(configs) ? configs : []
  if (junctions) warnDeprecatedJunctions(entries.map((entry) => entry?.module_type ?? ''))
  const legacy = legacyFlowPortModules(entries)
  if (!legacy.length) return
  notify.warning({
    title: 'Legacy Flow Ports',
    items: [`${listNamed(legacy)} link${legacy.length === 1 ? 's' : ''} flow through a whole-port "True" multi_port, which circulatory_autogen sums for terminals but PhLynx links as one value. Sum the flow instead, e.g. multi_port ["sum", "True"] on [v_in, u].`],
  })
}
