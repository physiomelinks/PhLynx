/**
 * The descriptions of a logger's errors, deleting each Issue handle. Imports nothing, so workers can use it.
 *
 * @param {Object} logger - A libCellML Parser, Validator, Importer, Analyser or other logger.
 * @returns {string[]}
 */
export function loggerMessages(logger) {
  const messages = []
  for (let i = 0; i < logger.errorCount(); i++) {
    const issue = logger.error(i)
    messages.push(issue.description())
    issue.delete()
  }
  return messages
}
