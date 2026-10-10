import { buildAlgorithm, buildUniformTimeCourse } from '../simulation/sedParameters'

/**
 * Writes the SED-ML simulation for a model without ODEs: a steady state, solved once, as libOpenCOR writes it.
 *
 * @returns {string}
 */
const steadyStateSimulation = () => '    <steadyState id="simulation1"/>'

/**
 * Writes the SED-ML simulation for a model with ODEs: a uniform course over its variable of integration, with its solver. SED-ML calls it a time course whatever the VoI is.
 *
 * @param {Object} simData - Simulation settings.
 * @returns {string}
 */
function timeCourseSimulation(simData) {
  const { initialTime, outputStartTime, outputEndTime, numberOfSteps } = buildUniformTimeCourse(simData)
  const { solver, parameters: algorithmParameters } = buildAlgorithm(simData)
  const parameters = algorithmParameters.map(
    ({ kisaoId, value }) => `          <algorithmParameter kisaoID="${kisaoId}" value="${value}"/>`
  ).join('\n')
  return `    <uniformTimeCourse id="simulation1" initialTime="${initialTime}" outputStartTime="${outputStartTime}" outputEndTime="${outputEndTime}" numberOfSteps="${numberOfSteps}">
      <algorithm kisaoID="${solver.kisaoId}">
        <listOfAlgorithmParameters>
${parameters}
        </listOfAlgorithmParameters>
      </algorithm>
    </uniformTimeCourse>`
}

/**
 * Writes the SED-ML document for a model and its simulation settings.
 *
 * @param {Object} simData - Simulation settings (simulationSettingsStore.simulationSettings).
 * @param {string} [cellmlFileName='model.cellml']
 * @param {{isSteadyState?: boolean}} [options] - isSteadyState: the model has no ODEs, so it is solved once
 *   rather than over a variable of integration, and the course settings don't apply.
 * @returns {string}
 */
export function generateSedmlData(simData, cellmlFileName = 'model.cellml', { isSteadyState = false } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfModels>
    <model id="model1" language="urn:sedml:language:cellml" source="${cellmlFileName}">
    </model>
  </listOfModels>
  <listOfSimulations>
${isSteadyState ? steadyStateSimulation() : timeCourseSimulation(simData)}
  </listOfSimulations>
  <listOfTasks>
    <task id="task1" modelReference="model1" simulationReference="simulation1"/>
  </listOfTasks>
</sedML>`
}
