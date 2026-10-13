import { readSolverSettings } from '../simulation/sedParameters'

/**
 * Reads the solver settings of a time course's algorithm.
 *
 * @param {Element} timeCourse - A uniformTimeCourse element.
 * @returns {Object} Some of `{ solver, timeStep, tolerance, maxSteps }`.
 */
function readAlgorithm(timeCourse) {
  const algorithm = [...timeCourse.children].find((child) => child.localName === 'algorithm')
  if (!algorithm) return {}
  const parameters = new Map(
    [...algorithm.getElementsByTagNameNS(algorithm.namespaceURI, 'algorithmParameter')].map((parameter) => [
      parameter.getAttribute('kisaoID'),
      parameter.getAttribute('value'),
    ])
  )
  return readSolverSettings(algorithm.getAttribute('kisaoID'), parameters)
}

export function extractSimData(sedmlData, filename, options = {}) {
  let simData = {
    startingPoint: null,
    endingPoint: null,
    pointInterval: null,
    initialPoint: null,
  }

  if (sedmlData) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(sedmlData, 'application/xml')
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      throw new Error(`Failed to parse SED-ML XML: ${parseError.textContent}`)
    }

    const sedmlElement = doc.documentElement
    if (sedmlElement?.localName !== 'sedML' || !(sedmlElement?.namespaceURI === 'http://sed-ml.org/sed-ml/level1/version4' || sedmlElement?.namespaceURI === 'http://sed-ml.org/sed-ml/level1/version3')) {
      throw new Error(`Invalid SED-ML file: root element is not <sedML> in the expected namespace ( found namespace: ${sedmlElement?.namespaceURI})`)
    }

    simData.sedml = sedmlData

    const simulationSettingsElement = sedmlElement.querySelector('listOfSimulations > uniformTimeCourse')
    if (simulationSettingsElement) {
      simData = {
        initialPoint: parseFloat(simulationSettingsElement.getAttribute('initialTime')),
        startingPoint: parseFloat(simulationSettingsElement.getAttribute('outputStartTime')),
        endingPoint: parseFloat(simulationSettingsElement.getAttribute('outputEndTime')),
        pointInterval: (parseFloat(simulationSettingsElement.getAttribute('outputEndTime')) - parseFloat(simulationSettingsElement.getAttribute('outputStartTime'))) / parseInt(simulationSettingsElement.getAttribute('numberOfSteps'), 10),
        ...readAlgorithm(simulationSettingsElement),
      }
    }
  }

  return simData
}
