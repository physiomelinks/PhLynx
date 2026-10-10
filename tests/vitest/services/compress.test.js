import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { generateOmexArchive } from '../../../src/services/compress.js'
import { buildSimulationJson, SIM_STEPS } from '../../../src/services/export/simulation.js'
import { rehydrateSimulationConfig } from '../../../src/services/import/simulation.js'

vi.mock('../../../src/stores/omexStore.js', () => ({
  useOmexStore: () => ({
    preservedExtras: [],
  }),
}))

async function readArchive(blob) {
  return JSZip.loadAsync(await blob.arrayBuffer())
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('generateOmexArchive', () => {
  it('rehydrates simulation.json back into the plot and parameter scan config shapes', () => {
    const groups = [{ id: 'plot-1', name: 'Plot 1' }]
    const plotConfig = {
      selections: [
        {
          groupId: 'plot-1::Vm',
          key: 'dndnode_0::Vm',
          nodeId: 'dndnode_0',
          nodeName: 'membrane',
          variableName: 'Vm',
          units: 'mV',
          type: 'variable',
          plot: 'line',
          groupId: 'plot-1',
        },
      ],
    }
    const parameterScanConfig = {
      selections: [
        {
          key: 'dndnode_1::gNa',
          nodeId: 'dndnode_1',
          nodeName: 'membrane',
          parameterName: 'gNa',
          units: 'nS',
          type: 'parameter',
          min: 0.1,
          default: 1,
          max: 10,
        },
      ],
    }

    const simulationJson = buildSimulationJson(plotConfig, parameterScanConfig, {
      voi: { name: 'time', componentName: 'environment', units: 'seconds' },
      mappedParameters: { 'membrane/gNa': { name: 'gNa', componentName: 'parameters' } },
    })

    const rehydrated = rehydrateSimulationConfig(simulationJson, {
      groups,
      nodeNameToIdMap: new Map([['membrane', 'dndnode_0']]),
    })

    expect(rehydrated.plotConfig.selections).toEqual([
      {
        key: 'dndnode_0::Vm',
        nodeId: 'dndnode_0',
        nodeName: 'membrane',
        variableName: 'Vm',
        units: '',
        // type: 'variable',
        plot: true,
        groupId: 'plot-1',
      },
    ])
    expect(rehydrated.parameterScanConfig.selections).toEqual([
      {
        key: 'dndnode_0::gNa',
        nodeId: 'dndnode_0',
        nodeName: 'membrane',
        parameterName: 'gNa',
        units: '',
        type: 'parameter',
        selected: true,
        min: 0.1,
        default: 1,
        max: 10,
        step: (10 - 0.1) / SIM_STEPS,
      },
    ])
  })

  describe('the SED-ML simulation', () => {
    const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML"'
    const model = (math) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"><component name="c"><math ${MATHML}>${math}</math></component></model>`
    const ODE = model('<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><cn>1</cn></apply>')
    const ALGEBRAIC = model('<apply><eq/><ci>y</ci><cn>1</cn></apply>')
    const settings = { startingPoint: 0, endingPoint: 1, initialPoint: 0, pointInterval: 0.1 }
    const sedmlOf = async (cellml, voi) => {
      const archive = await readArchive(
        await generateOmexArchive({ blob: new Blob([cellml]) }, '{}', { simulationSettings: settings }, { extractedData: { voi, mappedParameters: {} }, cellmlFileName: 'model.cellml' })
      )
      return archive.file('document.sedml').async('string')
    }

    it('is a steady state for a model without ODEs', async () => {
      const sedml = await sedmlOf(ALGEBRAIC, null)
      expect(sedml).toContain('<steadyState id="simulation1"/>')
      expect(sedml).not.toContain('uniformTimeCourse')
    })

    it('stays a time course for a model with ODEs, even when the caller doesn’t know its VOI', async () => {
      expect(await sedmlOf(ODE, null)).toContain('<uniformTimeCourse id="simulation1"')
    })
  })

  it('uses the imported CellML filename when one is supplied in addInfo', async () => {
    const cellmlSource = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="imported_model">
  <component name="main" />
</model>`

    const archiveBlob = await generateOmexArchive(
      {
        finalName: 'imported-model.cellml',
        blob: new Blob([cellmlSource], { type: 'application/xml' }),
      },
      JSON.stringify({}),
      {
        simulationSettings: {
          startingPoint: 10,
          endingPoint: 20,
          initialPoint: 5,
          timeStep: 1,
          pointInterval: 1,
          solver: 'CVODE',
          tolerance: 1e-7,
          maxSteps: 500,
        },
      },
      {
        extractedData: {
          voi: { name: 'time', componentName: 'environment', units: 'seconds' },
        },
        cellmlFileName: 'imported-model.cellml',
      }
    )

    const archive = await readArchive(archiveBlob)
    const manifestXml = await archive.file('manifest.xml').async('string')

    expect(archive.files['imported-model.cellml']).toBeDefined()
    expect(manifestXml).toContain(
      '<content location="imported-model.cellml" format="http://identifiers.org/combine.specifications/cellml"/>'
    )

    const modelCellml = await archive.file('imported-model.cellml').async('string')
    expect(modelCellml).toBe(cellmlSource)

    const sedmlDocument = await archive.file('document.sedml').async('string')
    expect(sedmlDocument).toContain(
      '<model id="model1" language="urn:sedml:language:cellml" source="imported-model.cellml">'
    )
  })

  it('builds a Web OpenCOR OMEX archive with the expected core files and contents', async () => {
    const cellmlSource = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="test_model">
  <component name="main" />
</model>`

    const archiveBlob = await generateOmexArchive(
      {
        blob: new Blob([cellmlSource], { type: 'application/xml' }),
      },
      JSON.stringify({}),
      {
        simulationSettings: {
          startingPoint: 10,
          endingPoint: 20,
          initialPoint: 5,
          timeStep: 1,
          pointInterval: 1,
          solver: 'CVODE',
          tolerance: 1e-7,
          maxSteps: 500,
        },
        plotConfig: {
          groups: [{ id: 'plot-1', name: 'Plot 1' }],
          selections: [
            {
              key: 'node-1::Vm',
              nodeId: 'node-1',
              nodeName: 'membrane',
              variableName: 'Vm',
              groupId: 'plot-1',
            },
          ],
        },
        parameterScanConfig: {
          selections: [
            {
              key: 'node-1::gNa',
              nodeId: 'node-1',
              nodeName: 'membrane',
              parameterName: 'gNa',
              type: 'constant',
              min: 0.1,
              default: 1,
              max: 10,
            },
          ],
        },
      },
      {
        extractedData: {
          voi: { name: 'time', componentName: 'environment', units: 'seconds' },
          mappedParameters: { 'membrane/gNa': { name: 'gNa', componentName: 'parameters' } },
        },
        cellmlFileName: 'test-model.cellml',
      }
    )

    expect(archiveBlob).toBeInstanceOf(Blob)

    const archive = await readArchive(archiveBlob)
    const entryNames = Object.keys(archive.files).sort()

    expect(entryNames).toEqual([
      'changes.json',
      'document.sedml',
      'flow-snapshot.json',
      'manifest.xml',
      'simulation.json',
      'test-model.cellml',
    ])

    const manifestXml = await archive.file('manifest.xml').async('string')
    expect(manifestXml).toContain('<omexManifest')
    expect(manifestXml).toContain('<content location="." format="http://identifiers.org/combine.specifications/omex"/>')
    expect(manifestXml).toContain(
      '<content location="document.sedml" format="http://identifiers.org/combine.specifications/sed-ml" master="true"/>'
    )
    expect(manifestXml).toContain(
      '<content location="test-model.cellml" format="http://identifiers.org/combine.specifications/cellml"/>'
    )
    expect(manifestXml).toContain(
      '<content location="simulation.json" format="http://purl.org/NET/mediatypes/application/json"/>'
    )

    const modelCellml = await archive.file('test-model.cellml').async('string')
    expect(modelCellml).toBe(cellmlSource)

    const flowSnapshot = await archive.file('flow-snapshot.json').async('string')
    expect(flowSnapshot).toBe('{}')

    const sedmlDocument = await archive.file('document.sedml').async('string')
    expect(sedmlDocument).toContain('<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">')
    expect(sedmlDocument).toContain(
      '<model id="model1" language="urn:sedml:language:cellml" source="test-model.cellml">'
    )
    expect(sedmlDocument).toContain('<task id="task1" modelReference="model1" simulationReference="simulation1"/>')
    expect(sedmlDocument).toContain(
      '<uniformTimeCourse id="simulation1" initialTime="5" outputStartTime="10" outputEndTime="20" numberOfSteps="10">'
    )

    const simulationJson = await archive.file('simulation.json').async('string')
    const simulationData = JSON.parse(simulationJson)
    expect(simulationData).toHaveProperty('input')
    expect(simulationData).toHaveProperty('output')
    expect(simulationData).toHaveProperty('parameters')

    expect(simulationData.input).toEqual([
      {
        id: 'id__membrane__gNa',
        name: 'gNa',
        defaultValue: 1,
        minimumValue: 0.1,
        maximumValue: 10,
        stepValue: 9.9 / SIM_STEPS,
      },
    ])

    expect(simulationData.output.data).toEqual([
      {
        id: 'data__membrane__vm',
        name: 'membrane/Vm',
      },
      {
        id: 'voi__environment__time',
        name: 'environment/time',
      },
    ])

    expect(simulationData.output.plots).toEqual([
      {
        additionalTraces: [],
        name: 'membrane/Vm',
        xAxisTitle: '',
        xValue: 'voi__environment__time',
        yAxisTitle: '',
        yValue: 'data__membrane__vm',
      },
    ])

    expect(simulationData.parameters).toEqual([
      {
        value: 'id__membrane__gNa',
        name: 'parameters/gNa',
      },
    ])
  })
})
