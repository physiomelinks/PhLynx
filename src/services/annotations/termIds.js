/**
 * Checks that the ontology terms a side-car cites are well formed, such as OPB:00340 and GO:0005737, and that OLS
 * knows its ChEBI and GO terms. Only a check: nothing is changed.
 */

import { splitCurie } from './iris.js'
import { displayLabel } from './labels.js'

// UniProt's accession format.
export const ACCESSION_PATTERN = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/

// Each prefix's local id format, and an id that fits it.
const ID_FORMATS = {
  OPB: { pattern: /^\d{5}$/, example: 'OPB:00340' },
  GO: { pattern: /^\d{7}$/, example: 'GO:0005737' },
  CHEBI: { pattern: /^\d+$/, example: 'CHEBI:29101' },
  SBO: { pattern: /^\d{7}$/, example: 'SBO:0000290' },
  CL: { pattern: /^\d{7}$/, example: 'CL:0000066' },
  UBERON: { pattern: /^\d{7}$/, example: 'UBERON:0000160' },
  ILX: { pattern: /^\d{7}$/, example: 'ILX:0101431' },
  uniprot: { pattern: ACCESSION_PATTERN, example: 'uniprot:P13866' },
}

// The prefixes OLS can look up.
const OLS_PREFIXES = new Set(['CHEBI', 'GO'])

/**
 * Why a term's id doesn't fit its ontology, e.g. "OPB:0006096 doesn’t fit OPB’s ids, such as OPB:00340".
 *
 * @param {string|null} curie - A canonical CURIE.
 * @returns {string|null} Null when it fits, or its prefix is not one checked.
 */
export function termIdProblem(curie) {
  const [prefix, id] = splitCurie(curie)
  const format = ID_FORMATS[prefix]
  if (!format || format.pattern.test(id)) return null
  return `${curie} doesn’t fit ${prefix}’s ids, such as ${format.example}`
}

/**
 * The ontology term of a place, or null for the module itself.
 *
 * @param {string|null} location - 'self', 'self+GO:…' or a CURIE.
 * @returns {string|null}
 */
const placeTerm = (location) =>
  !location || location === 'self' ? null : location.startsWith('self+') ? location.slice(5) : location

/**
 * The terms a table entry cites: its property, species and places.
 *
 * @param {{ property?: string|null, species?: string[], location?: string|null, from?: string|null }|null} entry
 * @returns {string[]}
 */
export function entryTerms(entry) {
  if (!entry) return []
  const terms = [entry.property, ...(entry.species ?? []), placeTerm(entry.location), placeTerm(entry.from)]
  return [...new Set(terms.filter(Boolean))]
}

/**
 * The terms a side-car variable cites, its process's and participants' included.
 *
 * @param {Object} variable - A readSidecar variable.
 * @returns {string[]}
 */
export function variableTerms(variable) {
  const participants = ['sources', 'sinks', 'mediators'].flatMap((role) => variable.process?.[role] ?? [])
  return [
    ...new Set([
      ...entryTerms(variable),
      ...(variable.entity?.is ?? []),
      ...(variable.process?.isVersionOf ?? []),
      ...participants.flatMap((participant) => [...(participant.species ?? []), placeTerm(participant.location)]),
    ]),
  ].filter(Boolean)
}

/**
 * The terms a parsed side-car cites, each with what cites it: the module's name or a variable's.
 *
 * @param {Object|null} sidecar - From parseSidecar.
 * @returns {Array<{ where: string, curie: string }>}
 */
export function sidecarTerms(sidecar) {
  const terms = []
  const component = sidecar?.component
  if (component) {
    const where = sidecar.componentName ?? 'module'
    const curies = new Set([...component.is, ...component.isVersionOf, component.spaceKind].filter(Boolean))
    curies.forEach((curie) => terms.push({ where, curie }))
  }
  for (const variable of sidecar?.variables ?? []) {
    variableTerms(variable).forEach((curie) => terms.push({ where: variable.variable, curie }))
  }
  return terms
}

/**
 * The terms whose ids don't fit their ontology.
 *
 * @param {Array<{ where: string, curie: string }>} terms
 * @returns {Array<{ where: string, curie: string, problem: string }>}
 */
export function termIdProblems(terms) {
  return terms.flatMap((term) => {
    const problem = termIdProblem(term.curie)
    return problem ? [{ ...term, problem }] : []
  })
}

/**
 * Whether OLS could look a term up: a well-formed ChEBI or GO id.
 *
 * @param {string} curie
 * @returns {boolean}
 */
export function isOlsTerm(curie) {
  return OLS_PREFIXES.has(splitCurie(curie)[0]) && !termIdProblem(curie)
}

/**
 * Says a term OLS doesn't know.
 *
 * @param {string} curie
 * @returns {string}
 */
export const unknownTermProblem = (curie) => `OLS has no term ${curie}`

/**
 * Looks up the well-formed ChEBI and GO terms without a known label on OLS, and lists those it doesn't know. A
 * lookup that fails, such as offline, counts as known.
 *
 * @param {Array<{ where: string, curie: string }>} terms
 * @param {(curie: string) => Promise<Object|null>} lookup - Null when OLS has no such term, as ols.lookupTerm.
 * @returns {Promise<Array<{ where: string, curie: string, problem: string }>>}
 */
export async function findUnknownTerms(terms, lookup) {
  const curies = [...new Set(terms.map(({ curie }) => curie))].filter(
    (curie) => isOlsTerm(curie) && displayLabel(curie) === curie
  )
  const found = await Promise.all(curies.map((curie) => Promise.resolve(curie).then(lookup).catch(() => true)))
  const unknown = new Set(curies.filter((_, i) => !found[i]))
  return terms
    .filter(({ curie }) => unknown.has(curie))
    .map((term) => ({ ...term, problem: unknownTermProblem(term.curie) }))
}
