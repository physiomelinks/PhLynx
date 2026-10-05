export const isSimulationJsonFile = async (fileObject) => {
  if (!fileObject || typeof fileObject.async !== 'function') {
    return false
  }

  try {
    const fileText = await fileObject.async('string')
    const parsed = JSON.parse(fileText)

    return (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.input) &&
      Array.isArray(parsed.parameters) &&
      typeof parsed.output === 'object' &&
      Array.isArray(parsed.output.data) &&
      Array.isArray(parsed.output.plots)
    )
  } catch {
    return false
  }
}

// May not need this function, but leaving it here for now in case we want to check for Phlynx Flow Snapshot files in the future.
export const isModuleConfigFile = async (fileObject, location = '') => {
  if (!fileObject || typeof fileObject.async !== 'function') {
    return false
  }

  try {
    const fileText = await fileObject.async('string')
    const parsed = JSON.parse(fileText)

    if (Array.isArray(parsed) && parsed.length > 0) {
      const firstEntry = parsed[0]
      return (
        firstEntry &&
        typeof firstEntry === 'object' &&
        'entrance_ports' in firstEntry &&
        'exit_ports' in firstEntry &&
        'general_ports' in firstEntry &&
        'module_subtype' in firstEntry &&
        'module_type' in firstEntry &&
        'module_format' in firstEntry &&
        'component_file' in firstEntry &&
        'component_type' in firstEntry
      )
    }
  } catch {
    return false
  }

  return false
}

/**
 * Checks a dotted version number against a minimum, part by part.
 *
 * @param {string} version - e.g. '1.1.0'.
 * @param {string} minimum - e.g. '1.0.0'.
 * @returns {boolean} False when `version` isn't a dotted number.
 */
function isAtLeastVersion(version, minimum) {
  if (!/^\d+(\.\d+)*$/.test(version)) return false
  const parts = version.split('.').map(Number)
  const minimumParts = minimum.split('.').map(Number)
  for (let i = 0; i < Math.max(parts.length, minimumParts.length); i++) {
    const difference = (parts[i] ?? 0) - (minimumParts[i] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}

export const isPhlynxFlowSnapshotFile = async (fileObject) => {
  if (!fileObject || typeof fileObject.async !== 'function') {
    return false
  }

  try {
    const fileText = await fileObject.async('string')
    const parsed = JSON.parse(fileText)
    return (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.nodeData) &&
      Array.isArray(parsed.edges) &&
      typeof parsed.id === 'string' &&
      typeof parsed.version === 'string' &&
      parsed.id === 'phlynx-flow-snapshot' &&
      isAtLeastVersion(parsed.version, '1.0.0')
    )
  } catch {
    return false
  }
}
