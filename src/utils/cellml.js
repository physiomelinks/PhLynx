import { isEmpty } from './variables.js'
import { getVariableMultiportTypes, isPerVariableMultiport } from './config'
import {
  STANDARD_UNITS,
  AFFINE_UNIT_CONVERSIONS,
  CELLML_NS,
  MATHML_NS,
  PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME,
  PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME,
  INSTANCE_PARAMETER_COMPONENT_NAMES,
  GLOBAL_PARAMETER_COMPONENT_NAMES,
} from './constants.js'

let _libcellml = null

export function initLibCellML(instance) {
  _libcellml = instance
}

/**
 * Builds a Map from CellML element id -> variable name by parsing the raw CellML XML.
 * Used to resolve annotation variable ids to human-readable names.
 */
export function buildVariableIdMap(cellmlString) {
  const doc = new DOMParser().parseFromString(cellmlString, 'application/xml')
  const map = new Map()
  Array.from(doc.getElementsByTagNameNS(CELLML_NS, 'variable')).forEach((v) => {
    const id = v.getAttribute('id')
    const name = v.getAttribute('name')
    if (id && name) map.set(id, name)
  })
  return map
}

export function extractParametersFromCellML(cellmlString, filename) {
  const doc = new DOMParser().parseFromString(cellmlString, 'application/xml')
  const model = doc.getElementsByTagName('model')[0]
  if (!model) return []

  const params = []
  for (const node of model.childNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE || node.localName !== 'component') continue
    for (const variable of node.getElementsByTagName('variable')) {
      const initialValue = variable.getAttribute('initial_value')
      if (!initialValue || isNaN(parseFloat(initialValue))) continue
      params.push({
        variable_name: variable.getAttribute('name'),
        units: variable.getAttribute('units'),
        value: initialValue,
        data_reference: filename,
      })
    }
  }
  return params
}

export function inferPrimaryComponentName(cellmlString) {
  const doc = new DOMParser().parseFromString(cellmlString, 'application/xml')
  const model = doc.getElementsByTagName('model')[0]
  if (!model) return null
  for (const node of model.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.localName === 'component') {
      return node.getAttribute('name')
    }
  }
  return null
}

export function inferComponentNameFromConnections(cellmlString, paramsComponentName) {
  const doc = new DOMParser().parseFromString(cellmlString, 'application/xml')

  // CellML 2.0: component names on <map_components> child of <connection>
  for (const mapComponents of doc.getElementsByTagName('map_components')) {
    const c1 = mapComponents.getAttribute('component_1')
    const c2 = mapComponents.getAttribute('component_2')
    if (c2 === paramsComponentName) return c1
    if (c1 === paramsComponentName) return c2
  }

  // CellML 1.x: component names directly on <connection>
  for (const connection of doc.getElementsByTagName('connection')) {
    const c1 = connection.getAttribute('component_1')
    const c2 = connection.getAttribute('component_2')
    if (c2 === paramsComponentName) return c1
    if (c1 === paramsComponentName) return c2
  }

  return null
}

/**
 * Parses a CellML file once and extracts both component and units data.
 *
 * @param {string} cellmlString - Raw CellML XML string.
 */
export function processCellMLData(cellmlString) {
  const parser = new _libcellml.Parser(false)
  let model = null

  // --- Parse ---
  try {
    model = parser.parseModel(cellmlString)
  } catch (err) {
    parser.delete()
    return {
      type: 'parser',
      issues: [{ description: 'Failed to parse model. Reason: ' + err.message }],
    }
  }

  if (parser.errorCount()) {
    const issues = []
    for (let i = 0; i < parser.errorCount(); i++) {
      const e = parser.error(i)
      issues.push({ description: e.description() })
      e.delete()
    }
    parser.delete()
    model.delete()
    return { type: 'parser', issues }
  }

  parser.delete()

  // --- Extract components ---
  const components = extractComponentsFromCellmlString(cellmlString)

  // --- Extract units into a stripped model ---
  const unitsModel = new _libcellml.Model()
  unitsModel.setName('OnlyUnitsFrom_' + model.name())
  const unitsCount = model.unitsCount()

  for (let i = 0; i < unitsCount; i++) {
    const units = model.unitsByIndex(i)
    const cloned = units.clone()
    unitsModel.addUnits(cloned)
    units.delete()
    cloned.delete()
  }

  const printer = new _libcellml.Printer()
  const unitsModelString = printer.printModel(unitsModel, false)

  model.delete()
  unitsModel.delete()
  printer.delete()

  return {
    type: 'success',
    components: components.xml,
    units: {
      model: unitsModelString,
      count: unitsCount,
    },
  }
}

export function isCellML(content) {
  if (!_libcellml) {
    throw new Error("LibCellML is not ready or hasn't been initialized.")
  }
  let parser = new _libcellml.Parser(false)
  let model = null
  try {
    model = parser.parseModel(content)
  } catch (err) {
    parser.delete()
    return false
  }
  const errorCount = parser.errorCount()
  const isValid = model !== null && errorCount === 0

  parser.delete()
  model.delete()

  return isValid
}

function isStandardUnit(name) {
  return STANDARD_UNITS.includes(name)
}

function isAffineUnit(name) {
  return name in AFFINE_UNIT_CONVERSIONS
}

function nextAvailableVarName(component, baseName) {
  let candidateName = baseName
  let index = 1
  let currentCandidate = component.variableByName(candidateName)
  while (currentCandidate !== null) {
    candidateName = `${baseName}_${index}`
    index++
    currentCandidate.delete()
    currentCandidate = component.variableByName(candidateName)
  }
  return candidateName
}

function nextAvailableComponentName(model, baseName) {
  let candidateName = baseName
  let index = 1
  let currentCandidate = model.componentByName(candidateName, true)
  while (currentCandidate !== null) {
    candidateName = `${baseName}_${index}`
    index++
    currentCandidate.delete()
    currentCandidate = model.componentByName(candidateName, true)
  }
  return candidateName
}

function sanitiseCellMLIdentifier(name) {
  let sanitised = (name ?? '').trim().replace(/[^a-zA-Z0-9_]/g, '_')
  if (!/^[a-zA-Z_]/.test(sanitised)) {
    sanitised = `_${sanitised}`
  }
  return sanitised || 'inspection_module'
}

function createAffineConversionComponent(model, v1, v2, v1CompName, v2CompName) {
  const garbageCollector = new Set()
  try {
    const units1 = v1.units()
    const units2 = v2.units()
    garbageCollector.add(units1)
    garbageCollector.add(units2)

    const u1 = units1.name()
    const u2 = units2.name()

    const conv1 = AFFINE_UNIT_CONVERSIONS[u1]
    const conv2 = AFFINE_UNIT_CONVERSIONS[u2]

    if (!conv1 && !conv2) return false

    const v1Name = v1.name()
    const v2Name = v2.name()

    let inVarCompName, inVarName, outVarCompName, outVarName
    let scale, offset, inUnitName, outUnitName

    if (conv1 && conv2) {
      if (conv1.baseUnit !== conv2.baseUnit) {
        throw new Error(
          `Cannot convert between ${u1} and ${u2}: incompatible base units (${conv1.baseUnit} vs ${conv2.baseUnit})`
        )
      }
      inVarCompName = v1CompName
      inVarName = v1Name
      inUnitName = u1
      outVarCompName = v2CompName
      outVarName = v2Name
      outUnitName = u2
      scale = conv1.scale / conv2.scale
      offset = (conv1.offset - conv2.offset) / conv2.scale

      // Both sides share the same affine unit
      if (scale === 1 && offset === 0) {
        _libcellml.Variable.addEquivalence(v1, v2)
        return true
      }
    } else {
      const conv = conv1 ?? conv2
      // Base unit is input (computed), affine unit is output (derived display value)
      inVarCompName = conv1 ? v2CompName : v1CompName // base unit side
      inVarName = conv1 ? v2Name : v1Name
      inUnitName = conv1 ? u2 : u1
      outVarCompName = conv1 ? v1CompName : v2CompName // affine unit side
      outVarName = conv1 ? v1Name : v2Name
      outUnitName = conv1 ? u1 : u2
      scale = 1 / conv.scale
      offset = -conv.offset / conv.scale
    }

    if (!inVarName || !outVarName || !inVarCompName || !outVarCompName) {
      throw new Error(
        `Affine conversion: failed to resolve variable or component names (in: ${inVarName}@${inVarCompName}, out: ${outVarName}@${outVarCompName})`
      )
    }

    // Get or create the single shared affine conversions component
    let convComp = model.componentByName('affine_unit_conversions', true)
    const isNew = convComp === null
    if (isNew) {
      convComp = new _libcellml.Component()
      convComp.setName('affine_unit_conversions')
    }
    garbageCollector.add(convComp)

    // Create uniquely named local variables within the shared component
    const inNewName = nextAvailableVarName(convComp, inVarName)

    const inLocalVar = new _libcellml.Variable()
    garbageCollector.add(inLocalVar)
    inLocalVar.setName(inNewName)
    inLocalVar.setUnitsByName(inUnitName)
    inLocalVar.setInterfaceTypeByString('public')
    convComp.addVariable(inLocalVar)

    const outNewName = nextAvailableVarName(convComp, outVarName)
    const outLocalVar = new _libcellml.Variable()
    garbageCollector.add(outLocalVar)
    outLocalVar.setName(outNewName)
    outLocalVar.setUnitsByName(outUnitName)
    outLocalVar.setInterfaceTypeByString('public')
    convComp.addVariable(outLocalVar)

    const mathML = `<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply>
        <eq/>
        <ci>${outNewName}</ci>
        <apply>
          <plus/>
          <apply>
            <times/>
            <cn cellml:units="dimensionless">${scale}</cn>
            <ci>${inNewName}</ci>
          </apply>
          <cn cellml:units="${outUnitName}">${offset}</cn>
        </apply>
      </apply>
    </math>`

    convComp.appendMath(mathML)

    // Only add to model if newly created
    if (isNew) {
      model.addComponent(convComp)
    }

    // Look up fresh references for equivalence wiring
    const freshConvComp = model.componentByName('affine_unit_conversions', true)
    garbageCollector.add(freshConvComp)
    const freshInLocal = freshConvComp.variableByName(inNewName)
    garbageCollector.add(freshInLocal)
    const freshOutLocal = freshConvComp.variableByName(outNewName)
    garbageCollector.add(freshOutLocal)
    const inVarComponent = model.componentByName(inVarCompName, true)
    garbageCollector.add(inVarComponent)
    const freshInVar = inVarComponent.variableByName(inVarName)
    garbageCollector.add(freshInVar)
    const outVarComponent = model.componentByName(outVarCompName, true)
    garbageCollector.add(outVarComponent)
    const freshOutVar = outVarComponent.variableByName(outVarName)
    garbageCollector.add(freshOutVar)

    _libcellml.Variable.addEquivalence(freshInLocal, freshInVar)
    _libcellml.Variable.addEquivalence(freshOutLocal, freshOutVar)
  } finally {
    garbageCollector.forEach((obj) => obj?.delete())
  }

  return true
}

/**
 * Creates (or appends to) a shared 'generated_multiplications' component that
 * scales a source variable by a constant factor.
    outLocalVar.delete()
    convComp.delete()
  }

  return true
}

/**
 * Creates (or appends to) a shared 'generated_multiplications' component that
 * scales a source variable by a constant factor.
 *
 * Generated MathML pattern:
 *   scaled_<sourceVarName> = factor * in_<sourceVarName>
 *
 * Does NOT wire the output variable to any target — the caller is responsible
 * for that, which allows the scaled output to be fed into a summation component
 * rather than directly to a target variable.
 *
 * @param {libcellml.Model}     model           - The model being built.
 * @param {libcellml.Component} sourceComp      - Component owning the variable to scale.
 * @param {string}              sourceVarName   - Name of the variable in sourceComp.
 * @param {number}              factor          - Numeric scaling factor (e.g. 2).
 * @returns {{ outputVarName: string }}         - Name of the scaled output variable
 *                                                inside 'generated_multiplications'.
 */
function createMultiplyComponent(model, sourceComp, sourceVarName, factor) {
  // Get or create the shared multiplications component
  let mulComp = model.componentByName('generated_multiplications', true)
  if (mulComp === null) {
    mulComp = new _libcellml.Component()
    mulComp.setName('generated_multiplications')
    model.addComponent(mulComp)
  }

  // Determine units from the source variable
  const sourceVar = sourceComp.variableByName(sourceVarName)
  const sourceUnits = sourceVar.units()
  const unitsName = sourceUnits.name() || 'dimensionless'
  sourceUnits.delete()

  // Input variable — wired to sourceComp
  const inputVarName = nextAvailableVarName(mulComp, `in_${sourceVarName}`)
  const inputVar = new _libcellml.Variable()
  inputVar.setName(inputVarName)
  inputVar.setUnitsByName(unitsName)
  inputVar.setInterfaceTypeByString('public')
  mulComp.addVariable(inputVar)
  _libcellml.Variable.addEquivalence(inputVar, sourceVar)
  inputVar.delete()
  sourceVar.delete()

  // Output variable — left unwired here; caller connects it to its destination
  const outputVarName = nextAvailableVarName(mulComp, `scaled_${sourceVarName}`)
  const outputVar = new _libcellml.Variable()
  outputVar.setName(outputVarName)
  outputVar.setUnitsByName(unitsName)
  outputVar.setInterfaceTypeByString('public')
  mulComp.addVariable(outputVar)
  outputVar.delete()

  // MathML: scaled_var = factor * in_var
  const mathML = `<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
    <apply>
      <eq/>
      <ci>${outputVarName}</ci>
      <apply>
        <times/>
        <cn cellml:units="dimensionless">${factor}</cn>
        <ci>${inputVarName}</ci>
      </apply>
    </apply>
  </math>`

  mulComp.appendMath(mathML)
  mulComp.delete()

  return { outputVarName }
}

function createSummationComponent(model, sourceComp, sourceVarName, targetComponentVarNameMap) {
  // Create the Component
  let sumComp = model.componentByName('generated_summations', true)
  if (sumComp === null) {
    sumComp = new _libcellml.Component()
    sumComp.setName('generated_summations')
    model.addComponent(sumComp)
  }

  // Setup Variables
  const referenceVar = sourceComp.variableByName(sourceVarName)
  const referenceUnits = referenceVar.units()
  const unitsName = referenceUnits.name() || 'dimensionless'
  referenceUnits.delete()

  const sumVarName = nextAvailableVarName(sumComp, `sum_of_${sourceVarName}`)
  const sumVar = new _libcellml.Variable()
  sumVar.setName(sumVarName)
  sumVar.setUnitsByName(unitsName)
  sumVar.setInterfaceTypeByString('public')
  sumComp.addVariable(sumVar)
  _libcellml.Variable.addEquivalence(referenceVar, sumVar)

  // Create Input Variables in the Sum Component.
  // Every term is added, whichever side of the edge the Sum port is on and
  // whether or not the term comes through a Multiply port, as in
  // circulatory_autogen: e.g. an upstream Sum port's v_out_sum = +(sum of the
  // downstream flows).
  const addVarNames = []

  targetComponentVarNameMap.forEach(({ component, varName: targetVarName }) => {
    const localVarName = nextAvailableVarName(sumComp, `op_${targetVarName}`)
    addVarNames.push(localVarName)

    const opVar = new _libcellml.Variable()
    opVar.setName(localVarName)
    opVar.setUnitsByName(unitsName)
    opVar.setInterfaceTypeByString('public')
    sumComp.addVariable(opVar)

    const tmpVar = component.variableByName(targetVarName)
    _libcellml.Variable.addEquivalence(opVar, tmpVar)
    opVar.delete()
    tmpVar.delete()
  })

  referenceVar.delete()
  sumVar.delete()

  // Generate MathML: sum = a1 + a2 + ..., or 0 with no terms.
  let rhsMathML
  if (addVarNames.length === 0) {
    rhsMathML = `<cn cellml:units="${unitsName}">0</cn>`
  } else {
    rhsMathML = `<apply>
        <plus/>
        ${addVarNames.map((name) => `<ci>${name}</ci>`).join('\n        ')}
      </apply>`
  }

  const mathML = `<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
    <apply>
      <eq/>
      <ci>${sumVarName}</ci>
      ${rhsMathML}
    </apply>
  </math>`

  sumComp.appendMath(mathML)
  sumComp.delete()
}

/**
 * Creates a dedicated component — named after the user-provided inspection
 * module name — that sums or subtracts selected variables.
 *
 * @param {libcellml.Model} model
 * @param {{ name: string, units: string, variables: Array<{ nodeId: string, variableName: string, sign?: number, units?: string }> }} module
 * @param {Map<string, libcellml.Component>} nodeComponentMap - NodeID -> component
 */
function createInspectionModuleComponent(model, module, nodeComponentMap) {
  let inspectionComp = model.componentByName('inspection_modules', true)
  if (inspectionComp === null) {
    inspectionComp = new _libcellml.Component()
    inspectionComp.setName('inspection_modules')
    model.addComponent(inspectionComp)
  }

  const unitsName = module.units || 'dimensionless'
  const sumVarName = nextAvailableVarName(inspectionComp, sanitiseCellMLIdentifier(module.name))

  const sumVar = new _libcellml.Variable()
  sumVar.setName(sumVarName)
  sumVar.setUnitsByName(unitsName)
  sumVar.setInterfaceTypeByString('public')
  inspectionComp.addVariable(sumVar)
  sumVar.delete()

  const addVarNames = []
  const subVarNames = []

  for (const entry of module.variables ?? []) {
    const sourceComp = nodeComponentMap.get(entry.nodeId)
    if (!sourceComp) continue

    const sourceVar = sourceComp.variableByName(entry.variableName)
    if (!sourceVar) continue

    const localVarName = nextAvailableVarName(inspectionComp, `op_${entry.variableName}`)
    const opVar = new _libcellml.Variable()
    opVar.setName(localVarName)
    const varUnits = entry.units || unitsName
    opVar.setUnitsByName(model.hasUnitsByName(varUnits) || isStandardUnit(varUnits) ? varUnits : unitsName)
    opVar.setInterfaceTypeByString('public')
    inspectionComp.addVariable(opVar)

    _libcellml.Variable.addEquivalence(opVar, sourceVar)

    opVar.delete()
    sourceVar.delete()

    if (entry.sign === -1) {
      subVarNames.push(localVarName)
    } else {
      addVarNames.push(localVarName)
    }
  }

  let rhsMathML
  if (addVarNames.length === 0 && subVarNames.length === 0) {
    rhsMathML = `<cn cellml:units="${unitsName}">0</cn>`
  } else if (subVarNames.length === 0) {
    rhsMathML =
      addVarNames.length === 1
        ? `<ci>${addVarNames[0]}</ci>`
        : `<apply><plus/>${addVarNames.map((n) => `<ci>${n}</ci>`).join('')}</apply>`
  } else if (addVarNames.length === 0) {
    const subSum =
      subVarNames.length === 1
        ? `<ci>${subVarNames[0]}</ci>`
        : `<apply><plus/>${subVarNames.map((n) => `<ci>${n}</ci>`).join('')}</apply>`
    rhsMathML = `<apply><minus/>${subSum}</apply>`
  } else {
    const addsPart =
      addVarNames.length === 1
        ? `<ci>${addVarNames[0]}</ci>`
        : `<apply><plus/>${addVarNames.map((n) => `<ci>${n}</ci>`).join('')}</apply>`
    const subsPart =
      subVarNames.length === 1
        ? `<ci>${subVarNames[0]}</ci>`
        : `<apply><plus/>${subVarNames.map((n) => `<ci>${n}</ci>`).join('')}</apply>`
    rhsMathML = `<apply><minus/>${addsPart}${subsPart}</apply>`
  }

  const mathML = `<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
    <apply>
      <eq/>
      <ci>${sumVarName}</ci>
      ${rhsMathML}
    </apply>
  </math>`

  inspectionComp.appendMath(mathML)
  inspectionComp.delete()
}

function extractUnitsFromMath(multiBlockMathString) {
  const wrappedString = `<root>${multiBlockMathString}</root>`

  // Parse the XML String
  const parser = new DOMParser()
  const doc = parser.parseFromString(wrappedString, 'application/xml')

  // Check for parsing errors (optional safety)
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    console.error('XML Parse Error:', parserError.textContent)
    throw new Error('XML Parse Error:', parserError.textContent)
  }

  // Find all <cn> elements
  // We use getElementsByTagNameNS to be strictly safe,
  // ensuring we only get MathML <cn> tags, not other tags named 'cn'.
  const cnElements = doc.getElementsByTagNameNS(MATHML_NS, 'cn')

  // Extract Unique Units
  const foundUnits = new Set()

  for (const cn of cnElements) {
    const unitName = cn.getAttributeNS(CELLML_NS, 'units')

    if (unitName) {
      foundUnits.add(unitName)
    }
  }

  return Array.from(foundUnits)
}

function handleLoggerErrors(logger, headerMessage, dontThrow = false) {
  const errMessages = [headerMessage]
  console.log(headerMessage)
  for (let i = 0; i < logger.errorCount(); i++) {
    const error = logger.error(i)
    console.log(`[${i + 1}]: ${error.description()}`)
    if (!dontThrow) {
      errMessages.push(`[${i + 1}]: ${error.description()}`)
    }
    error.delete()
  }
  if (!dontThrow) {
    throw new Error(errMessages.join('\n'))
  }
}

function addEnvironmentComponent(model) {
  const environmentComp = new _libcellml.Component()
  environmentComp.setName('environment')
  model.addComponent(environmentComp)

  const timeVar = new _libcellml.Variable()
  timeVar.setName('time')
  timeVar.setUnitsByName('second')
  timeVar.setInterfaceTypeByString('public')
  environmentComp.addVariable(timeVar)

  for (let i = 0; i < model.componentCount(); i++) {
    const component = model.componentByIndex(i)

    if (component.name() === 'environment') {
      component.delete()
      continue
    }
    const timeVarInComp = component.variableByName('t') || component.variableByName('time')
    if (timeVarInComp) {
      const timeUnits = timeVar.units()
      const timeVarInCompUnits = timeVarInComp.units()
      if (_libcellml.Units.compatible(timeUnits, timeVarInCompUnits)) {
        _libcellml.Variable.addEquivalence(timeVar, timeVarInComp)
      }
      timeUnits.delete()
      timeVarInCompUnits.delete()
      timeVarInComp.delete()
    }
    component.delete()
  }

  environmentComp.delete()
  timeVar.delete()
}

function prioritizeEnvironmentComponent(xmlString) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'application/xml')

  // Check for parse errors.
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    console.error('XML Parse Error during reordering:', parserError.textContent)
    return xmlString // Return original if parsing fails
  }

  // Get the Model element
  const model = doc.getElementsByTagNameNS(CELLML_NS, 'model')[0]
  if (!model) return xmlString

  // Find the 'environment' component.
  const components = Array.from(doc.getElementsByTagNameNS(CELLML_NS, 'component'))

  const envComp = components.find((c) => c.getAttribute('name') === 'environment')

  // Move it to be the first component child of model.
  if (envComp) {
    const firstOtherComp = components.find((c) => c !== envComp)
    if (firstOtherComp) {
      model.insertBefore(envComp, firstOtherComp)
    }
  }

  // Serialize back to string.
  const serializer = new XMLSerializer()
  const updatedXmlString = serializer.serializeToString(doc)

  // Pretty print using libCellML to ensure valid formatting.
  const parserCellML = new _libcellml.Parser(true)
  const modelCheck = parserCellML.parseModel(updatedXmlString)
  const printerCellML = new _libcellml.Printer()
  const finalXmlString = printerCellML.printModel(modelCheck, false)

  parserCellML.delete()
  modelCheck.delete()
  printerCellML.delete()

  return finalXmlString
}

function addVariableToParameterComponent(model, variable, parameterComponent, parameterData) {
  let sourceVar = parameterComponent.variableByName(parameterData.name)

  if (!sourceVar) {
    sourceVar = new _libcellml.Variable()
    sourceVar.setName(parameterData.name)
    // Ensure the initial value is explicitly set to define variable type as 'constant'.
    sourceVar.setInitialValueByString(parameterData.value)
    const matchUnits = model.unitsByName(parameterData.units)
    if (matchUnits) {
      sourceVar.setUnitsByUnits(matchUnits)
      matchUnits.delete()
    } else {
      sourceVar.setUnitsByName(parameterData.units)
    }

    sourceVar.setInterfaceTypeByString('public')
    parameterComponent.addVariable(sourceVar)
  }

  // Connect the constant parameter to the module variable.
  _libcellml.Variable.addEquivalence(sourceVar, variable)

  sourceVar.delete()
}

/**
 * Post-processes a printed CellML XML string, replacing all celsius unit references
 * with 'dimensionless' and removing the celsius unit definition.
 *
 * IMPORTANT - KNOWN LIMITATION:
 * This substitution is only numerically correct when celsius variables are used
 * exclusively as differences (e.g. (TmpC - 37) / 10), where the 273.15 K offset
 * cancels between the two operands. It will produce WRONG results if celsius is
 * used in any absolute context — for example, a product like (x_per_oC * T_celsius)
 * where 5°C should be treated as 278.15 K, not 5.
 *
 * This is required as the presence of 'celsius' in a cellml model currently causes
 * web OpenCOR to crash.
 *
 */
function stripCelsiusToArbitraryUnit(xmlString) {
  const CELSIUS_UNIT_NAME = 'celsius'

  const domParser = new DOMParser()
  const doc = domParser.parseFromString(xmlString, 'application/xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    console.warn('stripCelsiusToArbitraryUnit: XML parse error — returning original string unchanged.')
    return xmlString
  }

  // Check celsius is actually declared in this model before doing anything.
  const unitsElements = Array.from(doc.getElementsByTagNameNS(CELLML_NS, 'units'))
  const celsiusUnitsDeclared = unitsElements.some((el) => el.getAttribute('name') === CELSIUS_UNIT_NAME)
  if (!celsiusUnitsDeclared) {
    return xmlString
  }

  // Remove the <units name="celsius"> definition.
  for (const el of unitsElements) {
    if (el.getAttribute('name') === CELSIUS_UNIT_NAME) {
      el.parentNode.removeChild(el)
    }
  }

  // Replace units="celsius" on <variable> elements with "dimensionless".
  const variableElements = Array.from(doc.getElementsByTagNameNS(CELLML_NS, 'variable'))
  for (const el of variableElements) {
    if (el.getAttribute('units') === CELSIUS_UNIT_NAME) {
      el.setAttribute('units', 'dimensionless')
    }
  }

  // Replace cellml:units="celsius" on <cn> MathML literals with "dimensionless".
  const cnElements = Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'cn'))
  for (const el of cnElements) {
    if (el.getAttributeNS(CELLML_NS, 'units') === CELSIUS_UNIT_NAME) {
      el.setAttributeNS(CELLML_NS, 'cellml:units', 'dimensionless')
    }
  }

  const serializer = new XMLSerializer()
  return serializer.serializeToString(doc)
}

/**
 * Builds a single flattened CellML model from the workspace graph.
 *
 * @param {Array} nodes - VueFlow nodes. Each node.data must include:
 *   { name, mathRef, variables }, where mathRef ('componentFile:componentName')
 *   is looked up in libraryStore.availableMath to get the raw CellML XML string
 *   for a standalone single-component model (see extractComponentsFromCellmlString).
 * @param {Array} edges - VueFlow edges. Each edge has { source, target, data: { couplings } },
 *   where source/target are node ids (there is no edge.sourceNode/edge.targetNode) and
 *   couplings are the pre-resolved port-label pairings produced by resolvePortCouplings.
 * @param {object} libraryStore - Pinia library store, providing availableMath (Map<mathRef, xmlString>),
 *   availableUnits (Array<{ componentFile, model }>), and getGlobalConstant(name).
 * @param {Array} inspectionModules - Records from useInspectionModuleStore().modules, each
 *   { name, units, variables: [{ nodeId, variableName, ... }] }. Each becomes its own generated
 *   component summing the selected variables — see createInspectionModuleComponent.
 */
/**
 * Equivalences two variables, through a generated conversion component when
 * their units are affine (e.g. celsius and kelvin).
 */
function connectVariables(model, sourceComp, srcVariable, targetComp, tgtVariable) {
  if (!srcVariable || !tgtVariable) return
  const v1 = sourceComp.variableByName(srcVariable)
  const v2 = targetComp.variableByName(tgtVariable)
  if (v1 && v2) {
    const handled = createAffineConversionComponent(model, v1, v2, sourceComp.name(), targetComp.name())
    if (!handled) {
      _libcellml.Variable.addEquivalence(v1, v2)
    }
  }
  v1?.delete()
  v2?.delete()
}

function perVariableSumKey(component, port, varName) {
  return `${component.name()}::${port.label}::${varName}`
}

/**
 * Couples one port pair where either side has a per-variable (list-form)
 * multi_port, as circulatory_autogen does. Variables pair by position. A "Sum"
 * variable gets the neighbour's variable as a term of its generated summation
 * (always added, whichever side of the edge it is on); every other variable is
 * equivalenced directly, so a "True" variable is shared with every neighbour.
 */
function addPerVariableMultiportCoupling(model, sourceComp, srcLabel, targetComp, tgtLabel, multiPortSums) {
  const describe = () =>
    `"${srcLabel.label}" of "${sourceComp.name()}" ${JSON.stringify(srcLabel.variables)} to ` +
    `"${tgtLabel.label}" of "${targetComp.name()}" ${JSON.stringify(tgtLabel.variables)}`

  for (const label of [srcLabel, tgtLabel]) {
    if (!isPerVariableMultiport(label) && label.multiportType !== 'None' && label.multiportType !== 'True') {
      throw new Error(`Cannot connect ${describe()}: a per-variable multiport cannot couple to a "${label.multiportType}" multiport.`)
    }
  }
  if (srcLabel.variables.length !== tgtLabel.variables.length) {
    throw new Error(`Cannot connect ${describe()}: a per-variable multiport needs the same number of variables on both sides.`)
  }

  const srcTypes = getVariableMultiportTypes(srcLabel)
  const tgtTypes = getVariableMultiportTypes(tgtLabel)

  srcLabel.variables.forEach((srcVariable, i) => {
    const tgtVariable = tgtLabel.variables[i]
    const isSrcSum = srcTypes?.[i] === 'Sum'
    const isTgtSum = tgtTypes?.[i] === 'Sum'

    if (isSrcSum && isTgtSum) {
      throw new Error(`Cannot connect ${describe()}: "${srcVariable}" and "${tgtVariable}" are both "sum" variables.`)
    }
    if (!isSrcSum && !isTgtSum) {
      connectVariables(model, sourceComp, srcVariable, targetComp, tgtVariable)
      return
    }

    const [sumComp, sumLabel, sumVariable, operandComp, operandVariable] = isSrcSum
      ? [sourceComp, srcLabel, srcVariable, targetComp, tgtVariable]
      : [targetComp, tgtLabel, tgtVariable, sourceComp, srcVariable]
    const multiKey = perVariableSumKey(sumComp, sumLabel, sumVariable)
    if (!multiPortSums.has(multiKey)) {
      multiPortSums.set(multiKey, { sourceComp: sumComp, srcLabel: { variables: [sumVariable] }, targets: [] })
    }
    multiPortSums.get(multiKey).targets.push({
      component: operandComp,
      label: { variables: [operandVariable] },
    })
  })
}

export function generateFlattenedModel(nodes, edges, libraryStore, inspectionModules = []) {
  const appVersion = __APP_VERSION__ || '0.0.0'

  // Initialize core objects
  const model = new _libcellml.Model()
  model.setName(`PhLynxGenerated_v${appVersion}`.replaceAll('.', '_'))

  const printer = new _libcellml.Printer()
  const validator = new _libcellml.Validator()
  const parser = new _libcellml.Parser(false)
  const importer = new _libcellml.Importer(true)
  const analyser = new _libcellml.Analyser()
  const globalParameterComponent = new _libcellml.Component()
  const parameterComponent = new _libcellml.Component()

  // --- Helper State ---
  const modelCache = new Map() // Key: mathRef,        Value: libcellml.Model
  const nodeComponentMap = new Map() // Key: NodeID,         Value: libcellml.Component
  const unitsLibraryCache = new Map() // Key: componentFile,  Value: libcellml.Model
  const unitsImportSourceMap = new Map() // Key: componentFile,  Value: libcellml.ImportSource

  const ensureUnitImported = (unitsName) => {
    // Safety Checks
    if (!unitsName) return

    if (model.hasUnitsByName(unitsName) || isStandardUnit(unitsName)) return

    // Mask affine units from the validator using the base unit they're offset from
    if (isAffineUnit(unitsName)) {
      const { baseUnit } = AFFINE_UNIT_CONVERSIONS[unitsName]
      const affineUnits = new _libcellml.Units()
      affineUnits.setName(unitsName)
      affineUnits.addUnitByReference(baseUnit)
      model.addUnits(affineUnits)
      affineUnits.delete()
      return
    }

    // Search available libraries.
    let found = false

    for (const entry of libraryStore.availableUnits) {
      // Parse library only if not already cached
      if (!unitsLibraryCache.has(entry.componentFile)) {
        const libModel = parser.parseModel(entry.model)
        if (parser.errorCount() === 0) {
          unitsLibraryCache.set(entry.componentFile, libModel)
        } else {
          libModel.delete()
          handleLoggerErrors(parser, `Parser found ${parser.errorCount()} errors:`)
          continue
        }
      }

      const libModel = unitsLibraryCache.get(entry.componentFile)

      // Check if this library has the unit we need
      if (libModel.hasUnitsByName(unitsName)) {
        // Ensure we have an ImportSource for this file
        if (!unitsImportSourceMap.has(entry.componentFile)) {
          const importSource = new _libcellml.ImportSource()
          importSource.setUrl(entry.componentFile)
          importSource.setModel(libModel)

          // Register model with importer so it doesn't try to load from disk
          importer.addModel(libModel, entry.componentFile)

          unitsImportSourceMap.set(entry.componentFile, importSource)
        }

        // Create the Units object in our main model
        const importSource = unitsImportSourceMap.get(entry.componentFile)
        const importedUnits = new _libcellml.Units()
        importedUnits.setName(unitsName)
        importedUnits.setImportReference(unitsName)
        importedUnits.setImportSource(importSource)

        model.addUnits(importedUnits)
        importedUnits.delete()

        found = true
        break
      }
    }

    if (!found) {
      console.warn(`Could not find definition for unit '${unitsName}'`)
    }
  }

  try {
    globalParameterComponent.setName(PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME)
    model.addComponent(globalParameterComponent)

    parameterComponent.setName(PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME)
    model.addComponent(parameterComponent)

    // Count how many nodes use each constant variable name
    const constantNameRefCount = new Map()
    for (const node of nodes) {
      for (const v of node.data.variables ?? []) {
        if (v.type === 'constant' && !isEmpty(v.value)) {
          constantNameRefCount.set(v.name, (constantNameRefCount.get(v.name) ?? 0) + 1)
        }
      }
    }

    // ---------------------------------
    // Process Nodes (Create Components)
    // ---------------------------------
    for (const node of nodes) {
      const mathRef = node.data?.mathRef
      if (!mathRef) throw new Error(`Node '${node.data?.name ?? node.id}' has no mathRef.`)

      const modelString = libraryStore.availableMath.get(mathRef)
      if (!modelString) throw new Error(`Missing math definition for '${mathRef}'`)

      const modelFromInstance = parser.parseModel(modelString)

      const originalComponent = modelFromInstance.componentByIndex(0)
      originalComponent.setName(node.data.name)

      model.addComponent(originalComponent)

      modelFromInstance.delete()

      nodeComponentMap.set(node.id, originalComponent)

      // Add Units found in MathML.
      const mathUnits = extractUnitsFromMath(originalComponent.math())
      for (const unitsName of mathUnits) {
        ensureUnitImported(unitsName)
      }

      // Add Units found in Variables.
      for (let i = 0; i < originalComponent.variableCount(); i++) {
        const variable = originalComponent.variableByIndex(i)

        const units = variable.units()
        const unitsName = units.name()

        const nodeVariable = node.data.variables.find((v) => v.name === variable.name())
        if (nodeVariable) {
          if (nodeVariable.type === 'global_constant') {
            const v = libraryStore.getGlobalConstant(variable.name())
            if (!isEmpty(v?.value)) {
              addVariableToParameterComponent(model, variable, globalParameterComponent, {
                ...v,
                name: variable.name(),
              })
            }
          } else if (nodeVariable.type === 'constant') {
            const v = node.data.variables.find((cv) => cv.name === nodeVariable.name)
            if (!isEmpty(v?.value)) {
              const isShared = (constantNameRefCount.get(v.name) ?? 0) > 1
              addVariableToParameterComponent(model, variable, parameterComponent, {
                ...v,
                name: isShared ? `${node.data.name}_${v.name}` : v.name,
              })
            }
          }
        }

        // Use our helper
        ensureUnitImported(unitsName)

        variable.delete()
        units.delete()
      }
    }

    // ----------------------------------
    // Process Edges (Create Connections)
    // ----------------------------------

    const componentTrashCan = new Set()
    const multiPortSums = new Map()
    const multiPortMultiplies = [] // Array of { sourceComp, sourceVarName, targetComp, targetVarName, factor }
    for (const edge of edges) {
      // Edges only carry source/target node ids plus resolved coupling data
      // (see WorkspaceArea.vue's onConnect) — there is no edge.sourceNode /
      // edge.targetNode. Resolve components directly from the map built above.
      const sourceComp = nodeComponentMap.get(edge.source)
      const targetComp = nodeComponentMap.get(edge.target)

      if (!sourceComp || !targetComp) continue

      // Read the pre-resolved, slot-correct couplings stored on the edge.
      // These were computed by resolvePortCouplings at edge-creation time
      // (and recomputed on any edit), so ordinal slot assignment is already
      // correct — no need to re-derive from ports here.
      const couplings = edge.data?.couplings ?? []

      for (const { sourcePort: srcLabel, targetPort: tgtLabel } of couplings) {
        if (isPerVariableMultiport(srcLabel) || isPerVariableMultiport(tgtLabel)) {
          addPerVariableMultiportCoupling(model, sourceComp, srcLabel, targetComp, tgtLabel, multiPortSums)
          continue
        }

        const isSrcMultiportSum = srcLabel.multiportType === 'Sum'
        const isTgtMultiportSum = tgtLabel.multiportType === 'Sum'
        const isSrcMultiportMultiply = srcLabel.multiportType === 'Multiply'

        if (isSrcMultiportSum && isTgtMultiportSum) {
          throw new Error('Multi-port-sum to Multi-port-sum connections are not supported.')
        } else if (isSrcMultiportMultiply) {
          if (srcLabel.variables?.length !== 1 || tgtLabel.variables?.length !== 1) {
            throw new Error('Multiport Multiply ports must each map exactly one variable.')
          }
          multiPortMultiplies.push({
            sourceComp,
            sourceVarName: srcLabel.variables[0],
            targetComp,
            targetVarName: tgtLabel.variables[0],
            factor: Number(srcLabel.multiplyFactor ?? 1),
            isTgtMultiportSum,
            tgtLabel,
          })
        } else if (isSrcMultiportSum || isTgtMultiportSum) {
          const multiSumLabel = isSrcMultiportSum ? srcLabel : tgtLabel
          const multiSumComponent = isSrcMultiportSum ? sourceComp : targetComp
          const operandLabel = isSrcMultiportSum ? tgtLabel : srcLabel
          const operandComponent = isSrcMultiportSum ? targetComp : sourceComp
          const multiKey = multiSumComponent.name() + '::' + multiSumLabel.label
          if (!multiPortSums.has(multiKey)) {
            multiPortSums.set(multiKey, {
              sourceComp: multiSumComponent,
              srcLabel: multiSumLabel,
              targets: [],
            })
          }
          multiPortSums.get(multiKey).targets.push({
            component: operandComponent,
            label: operandLabel,
          })
        } else {
          // Direct one-to-one variable equivalence
          const minLength = Math.min(srcLabel.variables.length, tgtLabel.variables.length)
          for (let i = 0; i < minLength; i++) {
            connectVariables(model, sourceComp, srcLabel.variables[i], targetComp, tgtLabel.variables[i])
          }
        }
      }
    }

    // Handle Multi-Port-Sum Connections
    const mulCompRefs = []
    for (const mulData of multiPortMultiplies) {
      const { sourceComp, sourceVarName, targetComp, targetVarName, factor, isTgtMultiportSum, tgtLabel } = mulData

      const { outputVarName } = createMultiplyComponent(model, sourceComp, sourceVarName, factor)

      if (isTgtMultiportSum) {
        // The target has a Sum port: register the scaled output variable as a
        // Sum operand so it gets added to the summation equation rather than
        // equivalenced directly to the target.
        const mulComp = model.componentByName('generated_multiplications', true)
        mulCompRefs.push(mulComp) // keep alive until after Pass 2
        const multiKey = targetComp.name() + '::' + tgtLabel.label
        if (!multiPortSums.has(multiKey)) {
          multiPortSums.set(multiKey, {
            sourceComp: targetComp,
            srcLabel: tgtLabel,
            targets: [],
          })
        }
        // The operand is the scaled output variable living in generated_multiplications
        multiPortSums.get(multiKey).targets.push({
          component: mulComp,
          label: { variables: [outputVarName] },
        })
      } else {
        // Direct target: wire the scaled output straight to the target variable
        const mulComp = model.componentByName('generated_multiplications', true)
        const outputVar = mulComp.variableByName(outputVarName)
        const targetVar = targetComp.variableByName(targetVarName)
        if (outputVar && targetVar) {
          _libcellml.Variable.addEquivalence(outputVar, targetVar)
        }
        outputVar && outputVar.delete()
        targetVar && targetVar.delete()
        mulComp.delete()
      }
    }

    // A per-variable "sum" variable with no neighbours sums over nothing: it is 0.
    for (const node of nodes) {
      for (const port of node.data.ports ?? []) {
        const variableTypes = getVariableMultiportTypes(port)
        if (!variableTypes) continue
        const component = nodeComponentMap.get(node.id)
        variableTypes.forEach((type, i) => {
          const varName = port.variables[i]
          const multiKey = perVariableSumKey(component, port, varName)
          if (type !== 'Sum' || multiPortSums.has(multiKey)) return
          console.warn(
            `"${node.data.name}" variable "${varName}" (port "${port.label}") sums over its ` +
              `connections, but none are connected; setting it to 0.`
          )
          multiPortSums.set(multiKey, { sourceComp: component, srcLabel: { variables: [varName] }, targets: [] })
        })
      }
    }

    // Pass 2: Handle Sum connections (including any operands injected by Multiply above).
    for (const sumData of multiPortSums.values()) {
      const { sourceComp, srcLabel, targets } = sumData

      const sourceVarNames = srcLabel.variables
      if (sourceVarNames.length !== 1) {
        throw new Error('Multi-port-sum source must have exactly one variable representing the summed input.')
      }
      const sourceVarName = sourceVarNames[0]
      const targetComponents = []
      for (const targetInfo of targets) {
        const { component, label } = targetInfo
        const targetVarNames = label.variables
        if (targetVarNames.length !== 1) {
          throw new Error('Multi-port-sum target must have exactly one variable to be summed.')
        }
        const targetVarName = targetVarNames[0]
        targetComponents.push({ component, varName: targetVarName })
      }

      createSummationComponent(model, sourceComp, sourceVarName, targetComponents)
    }

    for (const ref of mulCompRefs) ref.delete()

    for (const comp of componentTrashCan) {
      comp && comp.delete()
    }

    // ------------------------------------------
    // Process Inspection Modules (Create Components)
    // ------------------------------------------
    for (const module of inspectionModules) {
      createInspectionModuleComponent(model, module, nodeComponentMap)
    }

    model.linkUnits()

    addEnvironmentComponent(model)

    if (globalParameterComponent.variableCount() === 0) {
      model.removeComponentByName(PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME, true)
    }

    if (parameterComponent.variableCount() === 0) {
      model.removeComponentByName(PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME, true)
    }

    // ------------------
    // PREPARE FOR EXPORT
    // ------------------

    // Resolve and Flatten
    importer.resolveImports(model, '.')
    const flattenedModel = importer.flattenModel(model)

    if (!flattenedModel) {
      handleLoggerErrors(importer, `Importer error count: ${importer.errorCount()}`)
    }

    if (importer.errorCount()) {
      flattenedModel.delete()
      handleLoggerErrors(importer, `Importer error count: ${importer.errorCount()}`)
    }

    validator.validateModel(flattenedModel)
    if (validator.errorCount()) {
      handleLoggerErrors(validator, `Validator error count: ${validator.errorCount()}`)
    }

    analyser.analyseModel(flattenedModel)
    if (analyser.errorCount()) {
      // FIXME: There is a bug in libCellML v0.6.3 where the analyser cannot handle
      // initialisation of a variable that is computed. Fixed in v0.6.4, but we need
      // a workaround for now to at least export something usable in the case where this is the only error.
      handleLoggerErrors(analyser, `Analyser error count: ${analyser.errorCount()}`, true)
    }

    let flattenedModelString = printer.printModel(flattenedModel, false)
    flattenedModel.delete()

    // Strip celsius unit references before re-parsing in prioritizeEnvironmentComponent,
    // so libCellML sees a clean model. See stripCelsiusToArbitraryUnit for known limitations.
    flattenedModelString = stripCelsiusToArbitraryUnit(flattenedModelString)

    flattenedModelString = prioritizeEnvironmentComponent(flattenedModelString)

    return new Blob([flattenedModelString], {
      type: 'application/x.vnd.cellml+xml',
    })
  } finally {
    // -------
    // CLEANUP
    // -------

    // Delete Component/Module Caches.
    for (const cachedModel of modelCache.values()) cachedModel.delete()
    for (const component of nodeComponentMap.values()) component.delete()

    // Delete Unit Caches.
    for (const libModel of unitsLibraryCache.values()) libModel.delete()
    for (const importSource of unitsImportSourceMap.values()) importSource.delete()

    // Delete Main Objects.
    parameterComponent.delete()
    globalParameterComponent.delete()
    analyser.delete()
    model.delete()
    printer.delete()
    validator.delete()
    parser.delete()
    importer.delete()
  }
}

function isPossibleParameter(variable, includeInitialised = false) {
  const varName = variable.name()
  if (varName === 't' || varName === 'time') return false
  if (!includeInitialised && variable.initialValue() !== '') return false
  if (variable.hasInterfaceType('public') || variable.hasInterfaceType('public_and_private')) return false
  return true
}

/**
 * Extracts unique variable names from a CellML model/component
 */
export function extractVariablesFromMath(math, includeInitialisedVariables = true) {
  const garbageCollector = new Set() // To track created objects for cleanup.
  try {
    const variables = []
    if (math) {
      const parser = new _libcellml.Parser(false)
      garbageCollector.add(parser)
      const model = parser.parseModel(math)
      garbageCollector.add(model)
      if (model.componentCount() > 1) throw new Error(`More than one component detected in ${model.modelName()}.`)
      const comp = model.componentByIndex(0)
      garbageCollector.add(comp)
      if (!comp) throw new Error(`No component found in file.`)
      for (let v = 0; v < comp.variableCount(); v++) {
        const variable = comp.variableByIndex(v)
        garbageCollector.add(variable)
        const units = variable.units()
        garbageCollector.add(units)
        if (isPossibleParameter(variable, includeInitialisedVariables)) {
          variables.push({ 
            name: variable.name(),
            units: units.name(),
            value: variable.initialValue(),
            type: variable.initialValue() !== '' ? 'constant' : 'variable',
            access: 'access',
            data_reference: 'unknown',
          })
        }
      }
    }

    return variables
  } finally {
    garbageCollector.forEach((obj) => obj?.delete())
  }
}

function removeComments(node) {
  const children = Array.from(node.childNodes)

  for (const child of children) {
    if (child.nodeType === 8) {
      // 8 = Node.COMMENT_NODE
      node.removeChild(child)
    } else if (child.nodeType === 1) {
      // 1 = Element
      removeComments(child)
    }
  }
}

function hasParserError(parsedDocument) {
  var parser = new DOMParser(),
    errorneousParse = parser.parseFromString('<', 'application/xml'),
    parsererrorNS = errorneousParse.getElementsByTagName('parsererror')[0].namespaceURI

  if (parsererrorNS === 'http://www.w3.org/1999/xhtml') {
    return parsedDocument.getElementsByTagName('parsererror').length > 0
  }

  return parsedDocument.getElementsByTagNameNS(parsererrorNS, 'parsererror').length > 0
}

export function extractComponentsFromCellmlString(cellmlString) {
  if (!cellmlString) {
    return { xml: null, errors: ['CellML string not provided'] }
  }
  const parser = new _libcellml.Parser(false)
  const model = parser.parseModel(cellmlString)

  if (!model || parser.errorCount() > 0) {
    const errors = []
    for (let i = 0; i < parser.errorCount(); i++) {
      const error = parser.error(i)
      errors.push(error.description())
      error.delete()
    }
    model && model.delete()
    parser.delete()
    return { xml: null, errors }
  }

  const modelName = model.name() || 'UnnamedModel'

  const extractedComponents = []
  const printer = new _libcellml.Printer()

  if (model.componentCount() > 0) {
    for (let i = 0; i < model.componentCount(); i++) {
      const component = model.componentByIndex(i)
      const newModel = new _libcellml.Model()
      newModel.setName('PhLynxComponent')
      const compClone = component.clone()
      newModel.addComponent(compClone)

      extractedComponents.push({
        name: component.name(),
        math: printer.printModel(newModel, false),
        variables: extractVariablesFromMath(printer.printModel(newModel, false)),
      })

      component.delete()
      compClone.delete()
      newModel.delete()
    }
    model.delete()
    parser.delete()
    printer.delete()
  } else {
    model.delete()
    parser.delete()
    printer.delete()
    return { xml: null, errors: [`No components found in '${modelName}'`] }
  }

  return { xml: extractedComponents, errors: [] }
}

export function doesComponentExistInModel(cellmlString, componentName) {
  if (cellmlString) {
    const parser = new _libcellml.Parser(false)
    const model = parser.parseModel(cellmlString)
    const component = model.componentByName(componentName, true)
    const hasComponent = component !== null
    if (component) component.delete()
    model.delete()
    parser.delete()
    return hasComponent
  }
  return false
}

export function mergeModelComponents(targetModelString, sourceModelString, newComponentName, oldComponentName) {
  const parser = new _libcellml.Parser(false)

  let targetModel = null
  if (targetModelString && targetModelString.trim().length > 0) {
    try {
      targetModel = parser.parseModel(targetModelString)
    } catch (error) {
      parser.delete()
      return ''
      // Handle parsing error if needed
    }
  }

  if (!targetModel) {
    targetModel = new _libcellml.Model()
    targetModel.setName('User_Modules')
  }

  let sourceModel = null
  try {
    sourceModel = parser.parseModel(sourceModelString)
  } catch (error) {
    targetModel.delete()
    parser.delete()
    return ''
  }

  if (sourceModel.componentCount() > 0) {
    const component = sourceModel.componentByIndex(0)
    const existingComponent = targetModel.componentByName(oldComponentName || newComponentName, true)

    if (existingComponent) {
      targetModel.removeComponentByName(oldComponentName || newComponentName, true)
      existingComponent.delete()
    }

    const clonedComponent = component.clone()
    clonedComponent.setName(newComponentName)
    targetModel.addComponent(clonedComponent)
    clonedComponent.delete()
    component.delete()
  }

  const printer = new _libcellml.Printer()
  const mergedModelString = printer.printModel(targetModel, false)

  targetModel.delete()
  sourceModel.delete()
  parser.delete()
  printer.delete()

  return mergedModelString
}

export function areModelsEquivalent(modelAString, modelBString) {
  if (!modelAString || !modelBString) {
    return false
  }

  if (modelAString.trim() === '' || modelBString.trim() === '') {
    return false
  }

  const garbageCollector = new Set() // To track created objects for cleanup
  try {
    const parser = new _libcellml.Parser(true)
    garbageCollector.add(parser)
    const modelA = parser.parseModel(modelAString)
    garbageCollector.add(modelA)
    const modelB = parser.parseModel(modelBString)
    garbageCollector.add(modelB)
    const equal = modelA.equals(modelB)

    return equal
  } finally {
    for (const obj of garbageCollector) {
      obj && obj.delete()
    }
  }
}

export function getModelComponentNames(modelString) {
  const componentNames = []
  if (modelString) {
    const parser = new _libcellml.Parser(false)
    const model = parser.parseModel(modelString)
    for (let i = 0; i < model.componentCount(); i++) {
      const component = model.componentByIndex(i)
      componentNames.push(component.name())
      component.delete()
    }
    model.delete()
    parser.delete()
  }
  return componentNames
}

export function extractVoiAndParametersFromModel(modelString, parameterInfo) {
  const mappedParameters = {}
  const garbageCollector = new Set()
  try {
    const parser = new _libcellml.Parser(false)
    garbageCollector.add(parser)

    const model = parser.parseModel(modelString)
    garbageCollector.add(model)

    const analyser = new _libcellml.Analyser()
    garbageCollector.add(analyser)

    analyser.analyseModel(model)
    const analyserModel = analyser.model()
    // This change is for version 0.7.0 of libCellML, where the analyser.model() method is deprecated and replaced with analyser.analyserModel(). If you are using a version of libCellML prior to 0.7.0, you should use the commented line below instead.
    // const analyserModel = analyser.analyserModel()
    garbageCollector.add(analyserModel)

    const voi = analyserModel.voi()
    garbageCollector.add(voi)

    for (const param of parameterInfo?.selections || []) {
      const paramComp = model.componentByName(param.nodeName, true)
      garbageCollector.add(paramComp)
      if (paramComp) {
        const paramVar = paramComp.variableByName(param.parameterName)
        garbageCollector.add(paramVar)
        if (paramVar) {
          for (let i = 0; i < paramVar.equivalentVariableCount(); i++) {
            const eqVar = paramVar.equivalentVariable(i)
            garbageCollector.add(eqVar)
            const mappedParent = eqVar.parent()
            garbageCollector.add(mappedParent)
            const mappedParentName = mappedParent?.name()
            if (param.type === 'global_constant' && mappedParentName === PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME) {
              mappedParameters[`${param.nodeName}/${param.parameterName}`] = {
                name: eqVar.name(),
                componentName: mappedParentName,
              }
              break
            } else if (param.type === 'constant' && mappedParentName === PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME) {
              mappedParameters[`${param.nodeName}/${param.parameterName}`] = {
                name: eqVar.name(),
                componentName: mappedParentName,
              }
              break
            }
          }
        }
      }
    }

    if (!voi) {
      console.log('Current bug in analysing CellML models using constants for initialising variables.')
      console.log('VOI variable is null because the model is not valid. This is a known issue in libCellML.')
      console.log('Returning {name: time, componentName: environment, units: second} for VOI variable.')
      console.log('But it should return null to indicate an error.')
      // resolve(null)
      return { voi: { name: 'time', componentName: 'environment', units: 'second' }, mappedParameters }
    }

    const voiVariable = voi.variable()
    garbageCollector.add(voiVariable)

    const component = voiVariable.parent()
    garbageCollector.add(component)

    const units = voiVariable.units()
    garbageCollector.add(units)

    const voiVariableData = { name: voiVariable.name(), componentName: component?.name(), units: units?.name() }

    return { voi: voiVariableData, mappedParameters }
  } finally {
    garbageCollector.forEach((obj) => obj?.delete())
  }
}

function findComponentByAnyName(model, names) {
  for (const name of names) {
    const comp = model.componentByName(name, true)
    if (comp) return comp
  }
  return null
}

function collectComponentParameters(sourceComponent) {
  const byComponent = {}
 
  for (let i = 0; i < sourceComponent.variableCount(); i++) {
    const variable = sourceComponent.variableByIndex(i)
    const units = variable.units()
    const value = variable.initialValue()
    const equivalentCount = variable.equivalentVariableCount()
 
    if (equivalentCount === 0) {
      console.warn(
        `Parameter variable '${variable.name()}' has no equivalent variables. It is not connected to any component and will be ignored.`
      )
    }
 
    for (let j = 0; j < equivalentCount; j++) {
      const eqVar = variable.equivalentVariable(j)
      const parentComp = eqVar.parent()
      const componentName = parentComp?.name() || ''
      const variableName = eqVar.name() || ''
 
      if (componentName) {
        if (!byComponent[componentName]) {
          byComponent[componentName] = []
        }
        byComponent[componentName].push({
          name: variableName,
          value,
          units: units.name(),
        })
      }
 
      eqVar.delete()
      parentComp.delete()
    }
 
    units.delete()
    variable.delete()
  }
 
  return byComponent
}

export function loadParametersFromCellML(modelString) {
  const parameterData = { parameters: {}, globalParameters: [] }
  if (modelString) {
    const parser = new _libcellml.Parser(false)
    const model = parser.parseModel(modelString)

    const parameterComponent = findComponentByAnyName(model, INSTANCE_PARAMETER_COMPONENT_NAMES)
    if (parameterComponent) {
      const byComponent = collectComponentParameters(parameterComponent)
      for (const [componentName, params] of Object.entries(byComponent)) {
        if (!parameterData.parameters[componentName]) {
          parameterData.parameters[componentName] = []
        }
        parameterData.parameters[componentName].push(...params)
      }
      parameterComponent.delete()
    }

    const globalParameterComponent = findComponentByAnyName(model, GLOBAL_PARAMETER_COMPONENT_NAMES)
    if (globalParameterComponent) {
      for (let i = 0; i < globalParameterComponent.variableCount(); i++) {
        const variable = globalParameterComponent.variableByIndex(i)
        const units = variable.units()
        parameterData.globalParameters.push({
          name: variable.name(),
          value: variable.initialValue(),
          units: units.name(),
        })
        units.delete()
        variable.delete()
      }
      globalParameterComponent.delete()
    }
    model.delete()
    parser.delete()
  }

  return parameterData
}
