/**
 * Ontology IRIs: namespaces, canonical CURIEs and the OPB, CHEBI and GO terms the annotations use.
 */

export const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  bqbiol: 'http://biomodels.net/biology-qualifiers/',
  api: 'https://apinatomy.org/uris/elements/',
  dcterms: 'http://purl.org/dc/terms/',
}

export const BQBIOL = {
  is: `${NS.bqbiol}is`,
  isVersionOf: `${NS.bqbiol}isVersionOf`,
  isPropertyOf: `${NS.bqbiol}isPropertyOf`,
  isPartOf: `${NS.bqbiol}isPartOf`,
}

export const RDF_TYPE = `${NS.rdf}type`

// Canonical IRI for each CURIE prefix; expandCurie writes these.
const CANONICAL_IRI = {
  CHEBI: 'http://purl.obolibrary.org/obo/CHEBI_',
  GO: 'http://purl.obolibrary.org/obo/GO_',
  SBO: 'http://purl.obolibrary.org/obo/SBO_',
  CL: 'http://purl.obolibrary.org/obo/CL_',
  UBERON: 'http://purl.obolibrary.org/obo/UBERON_',
  OPB: 'http://identifiers.org/opb/OPB_',
  uniprot: 'http://identifiers.org/uniprot/',
  ILX: 'http://uri.interlex.org/base/ilx_',
}

const PREFIX_CASE = Object.fromEntries(Object.keys(CANONICAL_IRI).map((prefix) => [prefix.toLowerCase(), prefix]))

const OBO_PREFIXES = ['CHEBI', 'GO', 'SBO', 'CL', 'UBERON', 'OPB']

const IRI_PATTERNS = [
  // http://purl.obolibrary.org/obo/CHEBI_17634
  [/^https?:\/\/purl\.obolibrary\.org\/obo\/([A-Za-z]+)_(\w+)$/, (m) => [m[1], m[2]]],
  // http://identifiers.org/CHEBI:17634, /chebi/CHEBI:17634, /opb/OPB_00340, /opb:OPB_00340, /biomodels.sbo/SBO:0000290
  [
    /^https?:\/\/identifiers\.org\/(?:[\w.]+[/:])?([A-Za-z]+)[:_](\w+)$/,
    (m) => (OBO_PREFIXES.includes(m[1].toUpperCase()) ? [m[1], m[2]] : null),
  ],
  // http://identifiers.org/uniprot/P11168, identifiers.org/uniprot:P11168, purl.uniprot.org/uniprot/P11168
  [
    /^https?:\/\/(?:identifiers\.org\/uniprot[/:]|purl\.uniprot\.org\/uniprot\/|www\.uniprot\.org\/uniprot\/)(\w+)$/,
    (m) => ['uniprot', m[1]],
  ],
  // http://uri.interlex.org/base/ilx_0774562
  [/^https?:\/\/uri\.interlex\.org\/base\/ilx_(\w+)$/, (m) => ['ILX', m[1]]],
]

/**
 * Returns the canonical CURIE for an ontology IRI or CURIE, e.g. 'CHEBI:17634' or 'uniprot:P11168'.
 *
 * @param {string} iriOrCurie - Any supported IRI form, or a CURIE in any prefix case.
 * @returns {string} The CURIE, or the input unchanged when it is not a known ontology term.
 */
export function canonicalCurie(iriOrCurie) {
  if (typeof iriOrCurie !== 'string') return iriOrCurie
  for (const [pattern, toParts] of IRI_PATTERNS) {
    const match = iriOrCurie.match(pattern)
    const parts = match && toParts(match)
    if (parts) return formatCurie(parts[0], parts[1])
  }
  const curie = iriOrCurie.match(/^([A-Za-z]+)[:_](\w+)$/)
  if (curie && PREFIX_CASE[curie[1].toLowerCase()]) return formatCurie(curie[1], curie[2])
  return iriOrCurie
}

function formatCurie(prefix, id) {
  const canonicalPrefix = PREFIX_CASE[prefix.toLowerCase()] ?? prefix
  return `${canonicalPrefix}:${id}`
}

/**
 * Returns the canonical IRI for a CURIE.
 *
 * @param {string} curie - e.g. 'GO:0005737'.
 * @returns {string} The IRI, or the input unchanged when its prefix is unknown.
 */
export function expandCurie(curie) {
  const [prefix, id] = splitCurie(curie)
  return prefix && CANONICAL_IRI[prefix] ? `${CANONICAL_IRI[prefix]}${id}` : curie
}

/**
 * Splits a canonical CURIE into prefix and local id.
 *
 * @param {string} curie
 * @returns {[string|null, string]} The prefix, or null when the value is not a known CURIE.
 */
export function splitCurie(curie) {
  const index = typeof curie === 'string' ? curie.indexOf(':') : -1
  const prefix = index > 0 ? curie.slice(0, index) : null
  if (!prefix || !CANONICAL_IRI[prefix]) return [null, curie]
  return [prefix, curie.slice(index + 1)]
}

/**
 * Whether a value is a canonical CURIE with the given prefix.
 *
 * @param {string} curie
 * @param {string} prefix - e.g. 'CHEBI'.
 * @returns {boolean}
 */
export function hasPrefix(curie, prefix) {
  return splitCurie(curie)[0] === prefix
}

/**
 * Splits a subject IRI into its file name and fragment.
 *
 * @param {string} iri
 * @returns {{ file: string, fragment: string }|null}
 */
export function splitSubject(iri) {
  const hash = iri.indexOf('#')
  if (hash < 0) return null
  const path = iri.slice(0, hash)
  return {
    file: decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)),
    fragment: decodeURIComponent(iri.slice(hash + 1)),
  }
}

// TO-VERIFY: none of these OPB ids has been confirmed against the OPB release yet.
export const OPB = {
  concentration: 'OPB:00340',
  molarFlowRate: 'OPB:00592',
  fluidVolume: 'OPB:00154',
  spatialArea: 'OPB:00295',
  electricalPotential: 'OPB:00506',
  chargeFlowRate: 'OPB:00318',
}

export const FLOW_PROPERTIES = new Set([OPB.molarFlowRate, OPB.chargeFlowRate])

/**
 * Whether an OPB property is a flow (a rate into the located entity).
 *
 * @param {string} property - A canonical OPB CURIE.
 * @returns {boolean}
 */
export function isFlowProperty(property) {
  return FLOW_PROPERTIES.has(property)
}

export const CHEBI = {
  sodium: 'CHEBI:29101',
  potassium: 'CHEBI:29103',
  glucose: 'CHEBI:17634',
  proton: 'CHEBI:15378',
  atp: 'CHEBI:15422',
  adp: 'CHEBI:16761',
  phosphate: 'CHEBI:43474',
}

export const GO = {
  cytoplasm: 'GO:0005737',
  extracellularRegion: 'GO:0005576',
  plasmaMembrane: 'GO:0005886',
  glucoseSodiumSymporter: 'GO:0005412',
  glucoseTransporter: 'GO:0055056',
  sodiumPotassiumAtpase: 'GO:0005391',
  inwardRectifierPotassiumChannel: 'GO:0005242',
  glycolysis: 'GO:0006096',
}

/** GO cellular components that locate a quantity relative to an instance. */
export const GO_LOCATIONS = new Set([GO.cytoplasm, GO.extracellularRegion, GO.plasmaMembrane])

export const SBO = {
  physicalCompartment: 'SBO:0000290',
}
