import { loggerMessages } from '../../utils/libcellmlLogger'

/** Each message once: libCellML reports a misspelt name at each place the math uses it. */
const unique = (messages) => [...new Set(messages)]

/** What checkModel finds in a math with nothing wrong. */
export const NO_FINDINGS = Object.freeze({ invalid: Object.freeze([]), imbalances: Object.freeze([]) })

/**
 * Checks a math's model, its library units added (see withLibraryUnits): whether it's valid CellML, and, if it is,
 * which equations' units don't balance. Imports nothing from the app, so the check worker can run it.
 *
 * Invalid is what the Parser and Validator report, such as a variable the math uses but doesn't declare, or a
 * units no units file defines; the export rejects such math. The Analyser's own errors (a state with no initial
 * value, a variable it can't classify) aren't reported: on its own a math lacks the values its parameter rows and
 * connections give it.
 *
 * Imbalances are equations such as `dx/dt = k*x` with k in seconds, as the Analyser reports them. That includes
 * terms that differ only in scale (ms and s), which libCellML doesn't convert inside an equation. A units the
 * Analyser can't work out, such as a power with a variable exponent, isn't reported. The Analyser checks units
 * only in valid math, so invalid math has none.
 *
 * @param {Object} libcellml - The libCellML instance.
 * @param {string} xml - A math as withLibraryUnits gives it.
 * @returns {{ invalid: string[], imbalances: string[] }} libCellML's descriptions.
 */
export function checkModel(libcellml, xml) {
  if (typeof xml !== 'string' || !xml.trim()) return NO_FINDINGS

  const parser = new libcellml.Parser(false)
  const validator = new libcellml.Validator()
  const analyser = new libcellml.Analyser()
  let model = null
  try {
    model = parser.parseModel(xml)
    if (!model || parser.errorCount()) return { invalid: unique(loggerMessages(parser)), imbalances: [] }

    validator.validateModel(model)
    if (validator.errorCount()) return { invalid: unique(loggerMessages(validator)), imbalances: [] }

    analyser.analyseModel(model)
    const unitsRule = libcellml.Issue.ReferenceRule.ANALYSER_UNITS.value
    const warning = libcellml.Issue.Level.WARNING.value
    const imbalances = []
    for (let i = 0; i < analyser.issueCount(); i++) {
      const issue = analyser.issue(i)
      const description = issue.description()
      // "may not be equivalent": libCellML can't tell, e.g. pow(x, n) with n a variable.
      if (
        issue.referenceRule().value === unitsRule &&
        issue.level().value === warning &&
        !description.includes('may not be equivalent')
      ) {
        imbalances.push(description)
      }
      issue.delete()
    }
    return imbalances.length ? { invalid: [], imbalances: unique(imbalances) } : NO_FINDINGS
  } finally {
    model?.delete()
    analyser.delete()
    validator.delete()
    parser.delete()
  }
}
