/**
 * What circulatory autogen, and so CUFLynx, can run of a protocol: it drives an input that changes over time through
 * Myokit's pacing, which follows one variable, not a state, in each sub-experiment (myokit_helper.py). PhLynx can run
 * more, so these are warnings for a protocol meant for CUFLynx too.
 */

/**
 * Lists what CA would refuse to run in a protocol.
 *
 * @param {Object} view - From readProtocolInfo.
 * @param {Object} [options]
 * @param {Map<string, string>} [options.kinds] - Each parameter's kind ('state' or 'constant'), where known.
 * @returns {string[]}
 */
export function findCircAutogenLimits(view, { kinds = new Map() } = {}) {
  const messages = []
  view.experiments.forEach((experiment, e) =>
    experiment.subs.forEach((_, s) => {
      const changing = view.controls.filter(({ cells }) => cells[e][s].kind !== 'constant').map(({ parameter }) => parameter)
      if (changing.length > 1) {
        messages.push(
          `CUFLynx can't run experiment ${e + 1}, sub-experiment ${s + 1}: ${changing.join(' and ')} all change over time, and it follows only one at once.`
        )
      }
    })
  )
  for (const { parameter, cells } of view.controls) {
    if (kinds.get(parameter) === 'state' && cells.some((row) => row.some((cell) => cell.kind !== 'constant'))) {
      messages.push(`CUFLynx can't run ${parameter} changing over time, as it is a state.`)
    }
  }
  return messages
}
