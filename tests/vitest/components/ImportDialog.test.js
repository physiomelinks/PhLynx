// @vitest-environment happy-dom
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => {
  const fn = vi.fn(() => ({ close: vi.fn() }))
  fn.error = vi.fn()
  fn.warning = vi.fn()
  fn.success = vi.fn()
  fn.info = vi.fn()
  return fn
})
vi.mock('../../../src/utils/notify', () => ({ notify }))
vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackEvent: vi.fn() }) }))

const folder = vi.hoisted(() => ({ status: null, scanFolder: null }))
vi.mock('../../../src/composables/useFolderImport', async () => {
  const { ref: vueRef } = await import('vue')
  folder.status = vueRef('disconnected')
  return {
    useFolderImport: () => ({
      supportsFolderAccess: true,
      folderStatus: folder.status,
      folderName: vueRef('models'),
      restoreFolder: vi.fn(),
      pickFolder: vi.fn(),
      reconnectFolder: vi.fn(),
      forgetFolder: vi.fn(),
      scanFolder: (...args) => folder.scanFolder(...args),
    }),
  }
})

// CellML parsing needs libcellml; any file whose text starts with "<model" counts as CellML here.
vi.mock('../../../src/utils/cellml', async (importActual) => ({
  ...(await importActual()),
  isCellML: (content) => content.startsWith('<model'),
  processCellMLData: (content) => ({
    type: 'success',
    components: [{ name: content.match(/name="(\w+)"/)?.[1] ?? 'unknown', math: '<math/>' }],
  }),
}))

const { default: ImportDialog } = await import('../../../src/components/ImportDialog.vue')
const { getImportConfig } = await import('../../../src/utils/import')
const { IMPORT_KEYS } = await import('../../../src/utils/constants')

const MODULES_CSV = 'name,module_type,module_subtype,inp_instances,out_instances\nheart,heart,simple,,\n'
const PARAMETERS_CSV = 'variable_name,units,value,data_reference\nk,second,1,ref\n'
const CONFIG_JSON = JSON.stringify([
  {
    entrance_ports: [],
    exit_ports: [],
    general_ports: [],
    module_type: 'heart',
    module_subtype: 'simple',
    module_format: 'cellml',
    component_file: 'heart.cellml',
    component_type: 'heart_simple',
  },
])
const HEART_CELLML = '<model name="heart_simple"/>'

const FOLDER_FILES = {
  'modules.csv': MODULES_CSV,
  'parameters.csv': PARAMETERS_CSV,
  'config.json': CONFIG_JSON,
  'heart.cellml': HEART_CELLML,
}

function fileEntry(name, text) {
  return { name, isFile: true, isDirectory: false, file: (resolve) => resolve(new File([text], name)) }
}

function folderEntry(name, files) {
  const children = Object.entries(files).map(([fileName, text]) => fileEntry(fileName, text))
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let isDone = false
      return {
        readEntries: (resolve) => {
          resolve(isDone ? [] : children)
          isDone = true
        },
      }
    },
  }
}

const dropEvent = (...entries) => ({ dataTransfer: { items: entries.map((e) => ({ webkitGetAsEntry: () => e })) } })

let wrapper
function mountDialog(importKey = IMPORT_KEYS.INSTANCE_ARRAY) {
  wrapper = mount(ImportDialog, {
    props: { modelValue: true, config: getImportConfig(importKey) },
    global: {
      plugins: [PrimeVue],
      stubs: { Dialog: { template: '<div><slot /><slot name="footer" /></div>' } },
    },
  })
  return wrapper
}

const toasts = () =>
  [
    ...notify.mock.calls.map(([options]) => options),
    ...['error', 'warning', 'success', 'info'].flatMap((type) =>
      notify[type].mock.calls.map(([options]) => ({ ...options, type }))
    ),
  ]

const fileNames = (key) => [...(wrapper.vm.formState[key]?.files?.keys() ?? [])]
const importButton = () => wrapper.findAll('button').find((b) => b.text().includes('Import'))

async function drop(event, field) {
  await wrapper.vm.handleDrop(event, field?.key)
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  folder.status.value = 'disconnected'
  folder.scanFolder = vi.fn(async () => [])
})
afterEach(() => wrapper?.unmount())

describe('ImportDialog instance-array folder drop', () => {
  it('sorts a folder into the right fields', async () => {
    mountDialog()
    const reversed = Object.fromEntries(Object.entries(FOLDER_FILES).reverse())
    await drop(dropEvent(folderEntry('model', reversed)))

    expect(fileNames(IMPORT_KEYS.INSTANCE_ARRAY)).toEqual(['modules.csv'])
    expect(fileNames(IMPORT_KEYS.PARAMETER)).toEqual(['parameters.csv'])
    expect(fileNames(IMPORT_KEYS.MODULE_CONFIG)).toEqual(['config.json'])
    expect(fileNames(IMPORT_KEYS.CELLML_FILE)).toEqual(['heart.cellml'])
    expect(toasts()).toEqual([expect.objectContaining({ type: 'success', title: 'Ready to Import' })])
    expect(importButton().attributes('disabled')).toBeUndefined()
  })

  it.each([IMPORT_KEYS.INSTANCE_ARRAY, IMPORT_KEYS.PARAMETER])(
    'sorts a folder dropped on the %s box like a background drop',
    async (key) => {
      mountDialog()
      const field = getImportConfig(IMPORT_KEYS.INSTANCE_ARRAY).fields.find((f) => f.key === key)
      await drop(dropEvent(folderEntry('model', FOLDER_FILES)), field)

      expect(fileNames(IMPORT_KEYS.INSTANCE_ARRAY)).toEqual(['modules.csv'])
      expect(fileNames(IMPORT_KEYS.CELLML_FILE)).toEqual(['heart.cellml'])
      expect(toasts()).toEqual([expect.objectContaining({ type: 'success' })])
    }
  )

  it('explains a malformed instance array without claiming readiness', async () => {
    mountDialog()
    const files = { ...FOLDER_FILES, 'modules.csv': 'name,module_type,module_subtype\nheart,heart,simple\n' }
    await drop(dropEvent(folderEntry('model', files)))

    const all = toasts()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ type: 'warning', title: 'Instance Array Needed' })
    expect(all[0].message).toContain('modules.csv — Invalid instance array file format. Missing columns: inp_instances')
    expect(wrapper.vm.importReadiness).toBeNull()
    expect(wrapper.find('.folder-import-row').exists()).toBe(true)
    expect(importButton().attributes('disabled')).toBeDefined()
  })

  it('replaces the instance array when a second folder is dropped', async () => {
    mountDialog()
    await drop(dropEvent(folderEntry('a', FOLDER_FILES)))
    const { 'modules.csv': modules, ...rest } = FOLDER_FILES
    await drop(dropEvent(folderEntry('b', { ...rest, 'modules-b.csv': modules })))

    expect(fileNames(IMPORT_KEYS.INSTANCE_ARRAY)).toEqual(['modules-b.csv'])
    expect(wrapper.vm.stagedFiles.configFiles.map((f) => f.filename)).toEqual(['config.json'])
    expect(wrapper.vm.stagedFiles.mathFiles.map((f) => f.filename)).toEqual(['heart.cellml'])
  })

  it('locks the dialog while a drop is being read', async () => {
    mountDialog()
    let release
    const slowEntry = {
      ...fileEntry('modules.csv', MODULES_CSV),
      file: (resolve) => {
        release = () => resolve(new File([MODULES_CSV], 'modules.csv'))
      },
    }
    const pending = wrapper.vm.handleDrop(dropEvent(slowEntry))
    await flushPromises()

    expect(wrapper.vm.isBusy).toBe(true)
    expect(wrapper.find('.loading-overlay').exists()).toBe(true)
    expect(importButton().attributes('disabled')).toBeDefined()

    release()
    await pending
    await flushPromises()
    expect(wrapper.vm.isBusy).toBe(false)
    expect(fileNames(IMPORT_KEYS.INSTANCE_ARRAY)).toEqual(['modules.csv'])
  })

  it('leaves out CellML files that no configuration references', async () => {
    mountDialog()
    await drop(dropEvent(folderEntry('model', { ...FOLDER_FILES, 'other.cellml': '<model name="other"/>' })))

    expect(fileNames(IMPORT_KEYS.CELLML_FILE)).toEqual(['heart.cellml'])
    expect(toasts()[0].message).toContain('Ignored: other.cellml — not used by any module in the instance array')
  })
})

describe('ImportDialog repeat drops', () => {
  it('replaces a staged CellML file when it is dropped again', async () => {
    mountDialog()
    await drop(dropEvent(folderEntry('model', FOLDER_FILES)))
    vi.clearAllMocks()
    await drop(dropEvent(fileEntry('heart.cellml', '<model name="heart_simple" version="2"/>')))

    expect(wrapper.vm.stagedFiles.mathFiles).toHaveLength(1)
    expect(wrapper.vm.formState[IMPORT_KEYS.CELLML_FILE].files.get('heart.cellml').payload).toContain('version="2"')
    expect(toasts()).toEqual([expect.objectContaining({ type: 'success', title: 'Ready to Import' })])
  })

  it('removes an empty required field once the instance array no longer needs it', async () => {
    mountDialog()
    await drop(dropEvent(fileEntry('modules.csv', MODULES_CSV)))
    expect(wrapper.vm.dynamicFields.map((f) => f.key)).toContain(IMPORT_KEYS.MODULE_CONFIG)

    // The library gains the module from elsewhere, so the same instance array now needs nothing more.
    const { useLibraryStore } = await import('../../../src/stores/libraryStore')
    const libraryStore = useLibraryStore()
    libraryStore.availableMath.set('heart.cellml:heart_simple', '<math/>')
    libraryStore.availableModules.set('heart:simple', { moduleRef: 'heart:simple', mathRef: 'heart.cellml:heart_simple' })
    await drop(dropEvent(fileEntry('modules.csv', MODULES_CSV)))

    expect(wrapper.vm.dynamicFields).toEqual([])
    expect(importButton().attributes('disabled')).toBeUndefined()
  })

  it('ignores XML and JSON files that are not import files', async () => {
    mountDialog()
    const files = { ...FOLDER_FILES, 'manifest.xml': '<omexManifest/>', 'settings.json': '{"a":1}' }
    await drop(dropEvent(folderEntry('model', files)))

    const [summary] = toasts()
    expect(summary).toMatchObject({ type: 'success', title: 'Ready to Import' })
    expect(summary.message).toContain('Ignored: manifest.xml, settings.json — not a recognised import file')
  })
})

describe('ImportDialog connected-folder auto-fill', () => {
  it('adds only the missing files and reports them in the drop summary', async () => {
    folder.status.value = 'connected'
    const unrelatedConfig = JSON.stringify([{ ...JSON.parse(CONFIG_JSON)[0], module_type: 'lung' }])
    folder.scanFolder = vi.fn(async () =>
      Object.entries({ ...FOLDER_FILES, 'lung.json': unrelatedConfig }).map(([name, text]) => ({
        file: new File([text], name),
        path: name,
      }))
    )
    mountDialog()
    await drop(dropEvent(fileEntry('modules.csv', MODULES_CSV)))

    expect(fileNames(IMPORT_KEYS.MODULE_CONFIG)).toEqual(['config.json'])
    expect(fileNames(IMPORT_KEYS.CELLML_FILE)).toEqual(['heart.cellml'])
    expect(fileNames(IMPORT_KEYS.PARAMETER)).toEqual([])
    const all = toasts()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ type: 'success', title: 'Ready to Import' })
    expect(all[0].message).toContain('2 files from connected folder "models"')
  })

  it('stops scanning when the folder cannot supply what is missing', async () => {
    mountDialog()
    await drop(dropEvent(fileEntry('modules.csv', MODULES_CSV)))
    folder.scanFolder = vi.fn(async () => [])
    folder.status.value = 'connected'
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await flushPromises()

    expect(folder.scanFolder).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.isScanningFolder).toBe(false)
  })

  it('does not bring back a file the user removed', async () => {
    folder.status.value = 'connected'
    folder.scanFolder = vi.fn(async () =>
      Object.entries(FOLDER_FILES).map(([name, text]) => ({ file: new File([text], name), path: name }))
    )
    mountDialog()
    await drop(dropEvent(fileEntry('modules.csv', MODULES_CSV)))
    expect(fileNames(IMPORT_KEYS.MODULE_CONFIG)).toEqual(['config.json'])

    wrapper.vm.removeFile(IMPORT_KEYS.MODULE_CONFIG, 'config.json')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await flushPromises()

    expect(fileNames(IMPORT_KEYS.MODULE_CONFIG)).toEqual([])
  })

  it('does not scan the folder when the drop already has everything', async () => {
    folder.status.value = 'connected'
    mountDialog()
    await drop(dropEvent(folderEntry('model', FOLDER_FILES)))

    expect(folder.scanFolder).not.toHaveBeenCalled()
  })
})

describe('ImportDialog single-type dialogs', () => {
  it('only accepts its own file type from a mixed folder', async () => {
    mountDialog(IMPORT_KEYS.CELLML_FILE)
    await drop(dropEvent(folderEntry('model', FOLDER_FILES)))

    expect(wrapper.vm.formState[IMPORT_KEYS.INSTANCE_ARRAY]).toBeUndefined()
    expect(fileNames(IMPORT_KEYS.CELLML_FILE)).toEqual(['heart.cellml'])
    expect(wrapper.vm.stagedFiles.mathFiles).toEqual([])
    expect(importButton().attributes('disabled')).toBeUndefined()
  })

  it('stays quiet when one valid file is selected for its own field', async () => {
    mountDialog(IMPORT_KEYS.MODULE_CONFIG)
    const field = getImportConfig(IMPORT_KEYS.MODULE_CONFIG).fields[0]
    const event = { target: { files: [new File([CONFIG_JSON], 'config.json')], value: 'x' } }
    await wrapper.vm.handleFileChange(event, field)
    await flushPromises()

    expect(fileNames(IMPORT_KEYS.MODULE_CONFIG)).toEqual(['config.json'])
    expect(toasts()).toEqual([])
  })
})
