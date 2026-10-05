import { Parser } from 'htmlparser2'
export function createEmptyAnalysis() {
  return {
    componentName: '',
    declared: [],
    referenced: [],
    references: [],
    stateVariables: [],
    unresolved: [],
    assigned: [],
    voi: [],
    dependencies: [],
  }
}

const stripNamespacePrefix = (qualifiedName) => qualifiedName.slice(qualifiedName.indexOf(':') + 1)

function buildAnalysis({ componentName, declared, referenced, references, stateVariables, assigned, voi, dependencies }) {
  const unitsByName = new Map(declared.map((variable) => [variable.name, variable.units]))
  const referencedNames = Array.from(referenced)
  return {
    componentName,
    declared,
    referenced: referencedNames,
    references,
    stateVariables: Array.from(stateVariables),
    unresolved: referencedNames.filter((name) => !unitsByName.get(name)),
    assigned: Array.from(assigned),
    voi: Array.from(voi),
    dependencies,
  }
}

/**
 * Analyzes CellML XML in one streaming pass, giving the same result as cellml-text-editor's
 * analyzeModel without needing a DOM, so it can run in a worker. The parser is lenient, so
 * malformed XML gives a best-effort result. It also gives `references`: every `<ci>` name in
 * document order, repeats included, which is what `detectRenames` compares.
 *
 * @param {string} xml - CellML model XML.
 * @returns {(import('cellml-text-editor').ModelAnalysis & { references: string[] })|null} The analysis, or null for empty input.
 */
export function analyzeMathXml(xml) {
  if (typeof xml !== 'string' || !xml.trim()) return null

  const collected = {
    componentName: '',
    declared: [],
    referenced: new Set(),
    references: [],
    stateVariables: new Set(),
    assigned: new Set(),
    voi: new Set(),
    dependencies: [],
  }

  let hasSeenComponent = false
  let isComponentDone = false
  let ciText = null
  const stack = []

  const parser = new Parser(
    {
      onopentag(rawName, attributes) {
        const name = stripNamespacePrefix(rawName)
        const parent = stack[stack.length - 1]
        const frame = {
          name,
          children: 0,
          first: null,
          inComponent: parent?.inComponent ?? false,
          inMath: (parent?.inMath ?? false) || name === 'math',
          inBvar: (parent?.inBvar ?? false) || name === 'bvar',
          inLhs: parent?.inLhs ?? false,
          equation: parent?.equation ?? null, // the enclosing top-level apply
          eqTarget: null, // on a top-level apply: the name its equation defines
          eqUses: null, // on a top-level apply: the names its equation uses
          isEqTarget: false,
          isTopLevelApply: false,
          isStateSettled: false,
          isStateCandidate: false,
          isComponent: false,
        }

        if (parent) {
          const index = parent.children++
          if (index === 0) parent.first = name

          // In <apply><diff/><bvar/><ci>x</ci></apply>, the first non-bvar operand is the state.
          if (parent.name === 'apply' && parent.first === 'diff' && index > 0 && !parent.isStateSettled && name !== 'bvar') {
            parent.isStateSettled = true
            frame.isStateCandidate = name === 'ci'
          }
          if (parent.isTopLevelApply && parent.first === 'eq' && index === 1) {
            frame.inLhs = true
            frame.isEqTarget = name === 'ci'
          }
          if (parent.name === 'math' && name === 'apply') {
            frame.isTopLevelApply = true
            frame.equation = frame
            frame.eqUses = new Set()
          }
        }

        if (name === 'component' && !hasSeenComponent && !isComponentDone) {
          hasSeenComponent = true
          frame.isComponent = true
          frame.inComponent = true
          collected.componentName = attributes.name ?? ''
        }

        if (frame.inComponent) {
          if (name === 'variable' && !frame.inMath && attributes.name) {
            collected.declared.push({
              name: attributes.name,
              units: attributes.units ?? '',
              interface: attributes.interface ?? '',
              initialValue: attributes.initial_value ?? '',
            })
          } else if (name === 'ci' && frame.inMath) {
            ciText = ''
          }
        }

        stack.push(frame)
      },
      ontext(text) {
        if (ciText !== null) ciText += text
      },
      onclosetag() {
        const frame = stack.pop()
        if (!frame) return

        if (frame.name === 'ci' && ciText !== null) {
          const ciName = ciText.trim()
          ciText = null
          if (ciName) {
            collected.referenced.add(ciName)
            collected.references.push(ciName)
            if (frame.isStateCandidate) collected.stateVariables.add(ciName)
            if (frame.inBvar) collected.voi.add(ciName)
            else if (frame.inLhs) collected.assigned.add(ciName)

            if (frame.isEqTarget) frame.equation.eqTarget = ciName
            else frame.equation?.eqUses.add(ciName)
          }
        }

        if (frame.isTopLevelApply && frame.inComponent && frame.first === 'eq') {
          collected.dependencies.push({ target: frame.eqTarget, uses: Array.from(frame.eqUses) })
        }

        if (frame.isComponent) isComponentDone = true
      },
    },
    { xmlMode: true, decodeEntities: true }
  )

  parser.write(xml)
  parser.end()

  return hasSeenComponent ? buildAnalysis(collected) : createEmptyAnalysis()
}

/**
 * Analyzes several pieces of math, keeping their order.
 */
export function analyzeMathBatch(items) {
  return items.map(({ key, xml }) => ({ key, analysis: analyzeMathXml(xml) }))
}
