import { MarkerType } from '@vue-flow/core'

export const DEFAULT_PROJECT_NAME = 'phlynx-project'
export const PHLYNX_PROJECT_IDENTIFIER = 'phlynx-project'
export const PHLYNX_PROJECT_VERSION = '1.3.0'

export const SOURCE_HANDLE_TYPE = 'source'
export const TARGET_HANDLE_TYPE = 'target'
export const HANDLE_VARIANT = {
  DEFAULT: 'default', 
  GHOST: 'ghost',      
}
export const NUM_GHOST_HANDLES_LEFT_RIGHT = 5
export const NUM_GHOST_HANDLES_TOP_BOT = 7
export const HANDLE_SPACING = 25

export const USER_MODULES_FILE = 'User_Modules.cellml'
export const NEW_INSTANCE_MODULE_REF = 'new_module:phlynx'
export const DEFAULT_CELLML_FILE_NAME = 'model.cellml'

export const TOOLTIP_AUTO_CLOSE = 1200
// How long the math editors wait after typing stops before reporting the edit.
export const MATH_EDIT_DEBOUNCE_MS = 500
export const RESCALE_ASPECT_RATIO = 3
export const RESCALE_TARGET_SPACING = 1000

export const markerEnd = MarkerType.ArrowClosed
export const edgeLineOptions = {
  type: 'smoothstep',
  markerEnd: markerEnd,
  style: {
    strokeWidth: 5,
  },
}
export const FLOW_IDS = {
  MAIN: 'main-flow-editor',
  MACRO: 'macro-builder-editor',
  EDGE: 'edge-conn-flow',
}

export const PARAMETER_TYPE_OPTIONS = [
  { value: 'constant', label: 'constant' },
  { value: 'global_constant', label: 'global' },
  { value: 'variable', label: 'variable' },
  { value: 'boundary_condition', label: 'boundary' },
]
/** The type of a row bound to its super-module's local constant, offered only where one can be (see typeOptionsFor). */
export const LOCAL_CONSTANT_TYPE_OPTION = { value: 'local_constant', label: 'local' }


export const PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME = 'global_parameters'
export const PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME = 'instance_parameters'

export const INSTANCE_PARAMETER_COMPONENT_NAMES = new Set(['model_parameters', PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME])
export const GLOBAL_PARAMETER_COMPONENT_NAMES = new Set([PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME])
export const PARAMETER_COMPONENT_NAMES = new Set([
  ...INSTANCE_PARAMETER_COMPONENT_NAMES,
  ...GLOBAL_PARAMETER_COMPONENT_NAMES,
])

export const AFFINE_UNIT_CONVERSIONS = {
  celsius:    { baseUnit: 'kelvin',  scale: 1,        offset: 273.15  },
  fahrenheit: { baseUnit: 'kelvin',  scale: 5 / 9,    offset: 255.372 },
}

// Parameter tables mount only visible rows past this size; mounting a few hundred rows blocked the page.
export const TABLE_VIRTUAL_SCROLL_MIN_ROWS = 40
export const TABLE_ROW_HEIGHT_PX = 43

// Edge connection dialog parameters
export const OUTER_MARGIN = 24
export const ROW_H    = 52          // px per port row
export const NODE_W   = 540         // px per column
export const MID_GAP  = 75          // px between columns
export const PAD      = 10          // top/bottom canvas padding
export const AUTOSCROLL_ZONE = 60   // px from canvas edge that triggers autoscroll
export const AUTOSCROLL_SPEED = 10  // max px per frame

export const TARGET_COMPATIBLE = {
  entrance_ports: new Set(['general_ports']),
  exit_ports:    new Set(['entrance_ports', 'general_ports']),
  general_ports: new Set(['entrance_ports', 'exit_ports', 'general_ports']),
}
export const CELLML_NS = 'http://www.cellml.org/cellml/2.0#'
export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
export const BQBIOL_NS = 'http://biomodels.net/biology-qualifiers/'

/** The reserved units file that holds units made from typed expressions, e.g. `mV/ms`. */
export const GENERATED_UNITS_FILE = 'generated_units.cellml'

export const STANDARD_UNITS = [
    'ampere',
    'becquerel',
    'candela',
    'coulomb',
    'dimensionless',
    'farad',
    'gram',
    'gray',
    'henry',
    'hertz',
    'joule',
    'katal',
    'kelvin',
    'kilogram',
    'litre',
    'lumen',
    'lux',
    'metre',
    'mole',
    'newton',
    'ohm',
    'pascal',
    'radian',
    'second',
    'siemens',
    'sievert',
    'steradian',
    'tesla',
    'volt',
    'watt',
    'weber',
]

export const EXCLUDED_COMPONENTS = new Set(['environment'])
export const TIME_UNITS = new Set(['second', 'millisecond', 'microsecond', 'minute', 'hour', 'ms', 's'])
export const TIME_NAMES = new Set(['time', 't'])

export const ACCESS = 'access'
export const NO_ACCESS = 'no_access'

export const VALUE_REQUIRED_TYPES = new Set(['constant', 'global_constant', 'local_constant'])

export const MAX_VISIBLE_TAGS = 1

export const MAIN_NODE_TYPE = 'instanceNode'
/** A super instance: one instance of a super-module, placed like a module. */
export const SUPER_INSTANCE_NODE_TYPE = 'superInstanceNode'
/** A super-module's interface node, which holds its definition (data.supermodule). */
export const SUPERMODULE_INTERFACE_NODE_TYPE = 'supermoduleInterface'
/** An edge showing a super-module child's port exposed on its interface; drawn only, never part of the model. */
export const EXPOSURE_EDGE_TYPE = 'exposure'
export const GHOST_NODE_TYPE = 'ghostNode'
export const GHOST_MODULE_FILENAME = 'ghost_modules.cellml'
export const GHOST_MATH_REF = `${GHOST_MODULE_FILENAME}:ghost`
export const GHOST_MODULE_REF = 'ghost:ghost'
export const NEW_MODULE_FILENAME = 'template_modules.cellml'
export const NEW_MODULE_MATH_REF = `${NEW_MODULE_FILENAME}:new_module`
export const NEW_MODULE_REF = 'new_module:phlynx'
export const PROTECTED_MATH_REFS = new Set([NEW_MODULE_MATH_REF, GHOST_MATH_REF])

export const GHOST_MODULE_DEFINITION = {
  moduleRef: GHOST_MODULE_REF,
  mathRef: GHOST_MATH_REF,
  ports: [],
  variables: [],
}

export const DEFAULT_INSTANCE_REF = {
  name: 'new_instance',
  module_type: 'new_module',
  module_subtype: 'phlynx',
  inp_instances: '',
  out_instances: '',
}

export const MACRO_BUILDER_ARROW = 'macro-builder-arrow'

export const PORT_TYPE_OPTIONS = [
  { value: 'general_ports',  label: 'G' },
  { value: 'entrance_ports', label: 'I' },
  { value: 'exit_ports',     label: 'O' },  
]

export const MULTIPORT_OPTIONS = [
  { value: 'True',  label: 'True'  },
  { value: 'Sum',   label: 'Sum'   },
  { value: 'None',  label: 'None'  },
]

/*--- Folder and File Handling ---*/
export const IMPORT_KEYS = {
  INSTANCE_ARRAY: 'instanceArray',
  MODULE_CONFIG: 'moduleConfig',
  CELLML_FILE: 'cellMLFile',
  PARAMETER: 'parameter',
  TURTLE: 'turtle',
  OMEX: 'omex',
}

export const SEND_KEYS = {
  OPENCOR: 'OpenCOR',
  OPENCOR_SELECTION: 'OpenCORSelection',
  CUFLYNX: 'CUFLynx',
}

export const IMPORT_LABELS = {
  INSTANCE_ARRAY: 'Instance Array (.json or .csv)',
  MODULE_CONFIG: 'Module Configurations (.json)',
  CELLML_FILE: 'CellML File (.cellml or .xml)',
  PARAMETER: 'Parameters (.csv)',
  TURTLE: 'Annotations (.ttl)',
  OMEX: 'COMBINE Archive (OMEX)',
}

export const EXPORT_KEYS = {
  CA: 'circulatoryAutogen',
  CA_FLAT: 'circulatoryAutogenFlat',
  CA_CSV: 'circulatoryAutogenCsv',
  CELLML: 'cellml',
  CELLML_HIERARCHICAL: 'cellmlHierarchical',
  OMEX: 'omex',
  CUFLYNX: 'cufLynx',
  CELLML_SELECTION: 'cellmlSelection',
  OMEX_SELECTION: 'omexSelection',
}

export const TTL_FILE_TYPES = [
  {
    description: 'Turtle RDF File',
    accept: { 'application/ttl': ['.ttl'] },
  },
]

export const CELLML_FILE_TYPES = [
  {
    description: 'CellML File',
    accept: { 'application/xml': ['.cellml', '.xml'] },
  },
]

export const JSON_FILE_TYPES = [
  {
    description: 'JSON File',
    accept: { 'application/json': ['.json'] },
  },
]

export const ZIP_FILE_TYPES = [
  {
    description: 'ZIP File',
    accept: { 'application/zip': ['.zip'] },
  },
]

export const OMEX_FILE_TYPES = [
  {
    description: 'COMBINE Archive (OMEX)',
    accept: { 'application/zip': ['.omex'] },
  },
]

export const RELEVANT_EXTENSIONS = new Set(['.csv', '.json', '.omex', '.cellml', '.xml'])
export const DB_NAME = 'phlynx-import'
export const STORE_NAME = 'handles'
export const HANDLE_KEY = 'importFolderHandle'

/*--- Instance Handles ---*/
export const HANDLE_SIDES = ["left", "right", "top", "bottom"]
export const SOURCE_HANDLE_PRIORITY = ["right", "bottom", "top", "left"]
export const TARGET_HANDLE_PRIORITY = ["left", "top", "bottom", "right"]

export const BASELINE_SIMULATION_SETTINGS = {
  pointInterval: 0.001,
  startingPoint: 0.0,
  endingPoint: 10.0,
  initialPoint: 0.0,
  solver: 'CVODE',
  // The solver settings, as sedParameters.js's DEFAULT_SOLVER_SETTINGS.
  timeStep: 0.0,
  tolerance: 1e-7,
  maxSteps: 500,
}
