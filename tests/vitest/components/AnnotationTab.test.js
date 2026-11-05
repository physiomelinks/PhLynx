// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToggleSwitch from 'primevue/toggleswitch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AnnotationTab from '../../../src/components/annotations/AnnotationTab.vue'
import { createAnnotationDraft } from '../../../src/services/annotations/draft.js'
import { parseSidecar } from '../../../src/services/annotations/sidecar.js'
import { LookupUnavailableError } from '../../../src/services/ontology/ols.js'
import { rememberTerms, resetTermCache } from '../../../src/services/ontology/termCache.js'
import { notify } from '../../../src/utils/notify.js'
import { createMemoryStorage } from '../helpers/memoryStorage.js'
import { readToy } from '../services/annotations/toyModel.js'

vi.mock('../../../src/utils/notify.js', () => {
  const notify = vi.fn()
  notify.error = vi.fn()
  notify.warning = vi.fn()
  notify.info = vi.fn()
  notify.success = vi.fn()
  return { notify }
})

const MATH_REF = 'file:decay'
const SIDECAR = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix opb: <https://identifiers.org/opb/OPB_> .
@prefix chebi: <https://identifiers.org/chebi/CHEBI:> .
@prefix go: <https://identifiers.org/go/GO:> .
@prefix sbo: <https://identifiers.org/sbo/SBO:> .
@prefix m: <./file#> .
@prefix local: <./decay.ttl#> .
m:decay bqbiol:is sbo:0000290 ; dcterms:description "A pool" .
local:entity_self bqbiol:is sbo:0000290 .
m:vdecayx01 bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 ] .
`
const CELLML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second"/>
    <variable id="vdecayx01" name="x" units="mM"/>
    <variable name="k" units="per_second"/>
    <variable name="J" units="mol_per_s"/>
  </component>
</model>`
// Not in the math's order, as the parameter table may have them.
const ROWS = [
  { name: 'J', units: 'mol_per_s' },
  { name: 'k', units: 'per_second', type: 'constant' },
  { name: 't', units: 'second' },
  { name: 'x', units: 'mM' },
]
const KINDS = new Map([
  ['t', 'voi'],
  ['x', 'state'],
  ['k', 'constant'],
  ['J', 'algebraic'],
])

let wrapper
beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('No network in tests')
    })
  )
  resetTermCache()
  vi.clearAllMocks()
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * Mounts the tab on the test sidecar, keeping its draft in step with what it emits.
 *
 * @param {Object} [props]
 * @param {string} [text] - The sidecar.
 * @returns {Promise<import('@vue/test-utils').VueWrapper>}
 */
async function mountTab(props = {}, text = SIDECAR) {
  const sidecar = await parseSidecar(text, { mathRef: MATH_REF, cellml: CELLML })
  wrapper = mount(AnnotationTab, {
    props: {
      rows: ROWS,
      variableKinds: KINDS,
      sidecar,
      sidecarText: text,
      cellml: CELLML,
      draft: createAnnotationDraft(),
      mathRef: MATH_REF,
      'onUpdate:draft': (draft) => wrapper.setProps({ draft }),
      ...props,
    },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  await flushPromises()
  return wrapper
}

const shownVariables = () => wrapper.findAll('.annotation-row').map((row) => row.attributes('data-variable'))
const rowOf = (name) => wrapper.find(`.annotation-row[data-variable="${name}"]`)
const cell = (name, test) => rowOf(name).findComponent(`[data-test="${test}"]`)
const edit = (name, test, value) => cell(name, test).vm.$emit('update:modelValue', value)
const entryOf = (name) => wrapper.props('draft').variables.get(name)
const port = (name) => rowOf(name).find('[data-test="port"]')
const NA = { curie: 'CHEBI:29101', label: 'Na⁺' }

// J as a transporter's flow of Na⁺ into the cytoplasm from outside.
const TRANSPORTER = SIDECAR.replace(/sbo:0000290 /g, 'uniprot:P13866 ')
  .replace(
    '@prefix m:',
    `@prefix uniprot: <https://identifiers.org/uniprot/> .
@prefix semsim: <http://bime.uw.edu/semsim/> .
@prefix m:`
  )
  .replace(
    /\nm:vdecayx01[^\n]*\n$/,
    `
m:vdecayx01 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_vdecayx01 .
local:process_vdecayx01 semsim:hasSourceParticipant local:source_vdecayx01 ;
    semsim:hasSinkParticipant local:sink_vdecayx01 ; semsim:hasMediatorParticipant local:mediator_vdecayx01 .
local:source_vdecayx01 semsim:hasPhysicalEntityReference local:entity_vdecayx01_source .
local:sink_vdecayx01 semsim:hasPhysicalEntityReference local:entity_vdecayx01 .
local:mediator_vdecayx01 semsim:hasPhysicalEntityReference local:entity_self .
local:entity_vdecayx01_source bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005576 .
local:entity_vdecayx01 bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 .
`
  )

describe('AnnotationTab', () => {
  describe('rows', () => {
    it('lists one row per variable in math order, not the VoI, and constants only when asked', async () => {
      await mountTab()
      expect(shownVariables()).toEqual(['x', 'J'])

      await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', true)
      expect(shownVariables()).toEqual(['x', 'k', 'J'])
    })

    it('counts the annotated rows of those listed', async () => {
      await mountTab()
      const count = () => wrapper.find('[data-test="count"]').text()
      expect(count()).toBe('1 of 2 annotated')
      await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', true)
      expect(count()).toBe('1 of 3 annotated')
      await edit('k', 'what', 'OPB:00154')
      expect(count()).toBe('2 of 3 annotated')
      // An annotated constant stays listed, and so does one cleared here.
      await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', false)
      expect(count()).toBe('2 of 3 annotated')
      await edit('k', 'what', 'none')
      expect(count()).toBe('1 of 3 annotated')
    })

    it('filters the rows by whether they are annotated', async () => {
      await mountTab()
      await wrapper.findComponent('[data-test="filter"]').vm.$emit('update:modelValue', 'unannotated')
      expect(shownVariables()).toEqual(['J'])
      await wrapper.findComponent('[data-test="filter"]').vm.$emit('update:modelValue', 'annotated')
      expect(shownVariables()).toEqual(['x'])
    })

    it('labels each cell by its variable', async () => {
      await mountTab()
      expect(cell('x', 'what').props('ariaLabel')).toBe('What for x')
      expect(cell('x', 'species').props('ariaLabel')).toBe('Of what for x')
      expect(cell('x', 'whose').props('ariaLabel')).toBe('Whose for x')
      expect(rowOf('x').find('[data-test="select"] input').attributes('aria-label')).toBe('Select x')
    })

    it('places each cell for the two-line narrow layout, with full text in titles', async () => {
      await mountTab()
      const row = rowOf('x')
      for (const place of ['name', 'units', 'what', 'species', 'whose', 'from']) {
        expect(row.find(`td.annotation-row__${place}`).exists()).toBe(true)
      }
      // Narrow, the units read after the name; screen readers keep their own cell.
      const suffix = row.find('.annotation-row__units-suffix')
      expect(suffix.text()).toBe('mM')
      expect(suffix.attributes('aria-hidden')).toBe('true')
      expect(row.find('.annotation-row__name').attributes('title')).toBe('x (mM)')

      expect(cell('x', 'what').attributes('title')).toBe('Concentration')
      expect(cell('x', 'species').attributes('title')).toBe(NA.label)
      const whose = cell('x', 'whose')
      const place = whose.props('options').find(({ value }) => value === whose.props('modelValue'))
      expect(whose.attributes('title')).toBe(place.label)
      expect(cell('J', 'what').attributes('title')).toBeUndefined()
      // A place the kind doesn't offer shows as its name and a warning; the note stays in the title and for readers.
      expect(whose.attributes('title')).toBe('Cytoplasm (not usual for a compartment)')
      expect(whose.find('[aria-hidden="true"]').text()).toBe('Cytoplasm')
      expect(whose.find('.annotation-row__unusual').exists()).toBe(true)
      expect(whose.find('.annotation-row__sr-only').text()).toBe('Cytoplasm (not usual for a compartment)')
    })
  })

  describe('module', () => {
    it('reads the module kind from the sidecar and drafts a change of it', async () => {
      await mountTab()
      const kind = wrapper.findComponent('[data-test="module-kind"]')
      expect(kind.props('modelValue')).toBe('compartment')

      await kind.vm.$emit('update:modelValue', 'membrane')
      expect(wrapper.props('draft').componentKind).toBe('membrane')

      await kind.vm.$emit('update:modelValue', 'compartment')
      expect(wrapper.props('draft').componentKind).toBeUndefined()
    })

    it('offers a compartment, and only a compartment, a space kind of None until one is chosen', async () => {
      await mountTab()
      const space = () => wrapper.findComponent('[data-test="space-kind"]')
      expect(space().props('modelValue')).toBe('none')
      expect(space().props('options').map(({ label }) => label)).toEqual(['None', 'Cytoplasm', 'Extracellular'])

      await space().vm.$emit('update:modelValue', 'GO:0005576')
      expect(wrapper.props('draft').spaceKind).toBe('GO:0005576')
      await space().vm.$emit('update:modelValue', 'none')
      expect(wrapper.props('draft').spaceKind).toBeUndefined()

      await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'membrane')
      expect(wrapper.find('[data-test="space-kind"]').exists()).toBe(false)
    })

    it('takes a transporter’s UniProt accession only once it is valid, and names the protein', async () => {
      await mountTab()
      await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'transporter')
      const accession = () => wrapper.find('[data-test="uniprot-accession"]')
      expect(accession().classes()).toContain('p-invalid')
      // Without a known protein name, the module's own.
      expect(wrapper.find('[data-test="protein-label"]').text()).toBe('decay')

      await accession().find('input').setValue('not an accession')
      expect(wrapper.props('draft').transporter).toBeUndefined()

      await accession().find('input').setValue('p11168')
      expect(wrapper.props('draft')).toMatchObject({ componentKind: 'transporter', transporter: 'uniprot:P11168' })
      rememberTerms([{ curie: 'uniprot:P11168', label: 'Sodium/potassium pump' }])
      await flushPromises()
      expect(wrapper.find('[data-test="protein-label"]').text()).toBe('Sodium/potassium pump')
    })

    it('offers reviewed UniProt entries for the transporter and takes the chosen accession', async () => {
      vi.useFakeTimers()
      const searchProteins = vi.fn(async () => [
        { curie: 'uniprot:P13866', accession: 'P13866', label: 'Sodium/glucose cotransporter 1', gene: 'SLC5A1' },
      ])
      await mountTab({ searchProteins })
      await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'transporter')
      const accession = wrapper.findComponent('[data-test="uniprot-accession"]')

      accession.vm.$emit('complete', { query: 'sglt1' })
      await vi.advanceTimersByTimeAsync(300)
      expect(accession.props('suggestions').map((entry) => entry.accession)).toEqual(['P13866'])

      await accession.vm.$emit('update:modelValue', accession.props('suggestions')[0])
      expect(wrapper.props('draft')).toMatchObject({ componentKind: 'transporter', transporter: 'uniprot:P13866' })
    })

    it('keeps a typed accession when UniProt is unavailable', async () => {
      vi.useFakeTimers()
      const searchProteins = async () => {
        throw new LookupUnavailableError('Timed out')
      }
      await mountTab({ searchProteins })
      await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'transporter')
      const accession = wrapper.findComponent('[data-test="uniprot-accession"]')

      accession.vm.$emit('complete', { query: 'P11168' })
      await vi.advanceTimersByTimeAsync(300)
      expect(wrapper.vm.$.setupState.proteinLookup).toBe('unavailable')

      await accession.vm.$emit('update:modelValue', 'P11168')
      expect(wrapper.props('draft').transporter).toBe('uniprot:P11168')
    })

    it('says how many instances share the module', async () => {
      await mountTab({ sharedCount: 3 })
      expect(wrapper.find('[data-test="shared"]').text()).toBe('Shared by 3 instances · edits apply to its module')

      await wrapper.setProps({ sharedCount: 1 })
      expect(wrapper.find('[data-test="shared"]').text()).toBe('Shared by 1 instance · edits apply to its module')
    })
  })

  describe('cells', () => {
    it('drafts each cell edit at once, and shows the port once the row is complete', async () => {
      await mountTab()
      expect(cell('J', 'what').props('modelValue')).toBeNull()
      expect(port('J').text()).toBe('–')

      await edit('J', 'what', 'OPB:00340')
      expect(entryOf('J')).toEqual({ property: 'OPB:00340', species: [], location: null, from: null })
      expect(rowOf('J').classes()).toContain('annotation-row--incomplete')
      expect(port('J').attributes('aria-label')).toBe('No port until it has of what and whose')

      await edit('J', 'whose', 'self')
      expect(port('J').attributes('aria-label')).toBe('No port until it has of what')
      await edit('J', 'species', [NA])
      expect(entryOf('J')).toEqual({ property: 'OPB:00340', species: ['CHEBI:29101'], location: 'self', from: null })
      expect(rowOf('J').classes()).not.toContain('annotation-row--incomplete')
      expect(port('J').text()).toBe('○')
      expect(port('J').attributes('aria-label')).toBe('Port will be created on save')
    })

    it('marks a port the instance has', async () => {
      await mountTab({ portStatus: new Map([['x', 'exists']]) })
      expect(port('x').text()).toBe('●')
      expect(port('x').attributes('aria-label')).toBe('Port exists')
    })

    it('says no port for a row with a place but no property', async () => {
      await mountTab()
      await edit('J', 'whose', 'self')
      expect(entryOf('J')).toEqual({ property: null, species: [], location: 'self', from: null })
      expect(port('J').attributes('aria-label')).toBe('No port until it has what')
    })

    it('offers the seven properties in words, Amount among them, and None to clear', async () => {
      await mountTab()
      expect(cell('x', 'what').props('options').map(({ label }) => label)).toEqual([
        'Concentration',
        'Amount',
        'Molar flow rate',
        'Fluid volume',
        'Spatial area',
        'Electrical potential',
        'Charge flow rate',
        'None',
      ])
      await edit('x', 'what', 'none')
      expect(entryOf('x')).toBeNull()
      expect(port('x').text()).toBe('–')
    })

    it('keeps showing an older side-car’s density flow rate, without offering it elsewhere', async () => {
      await mountTab({}, SIDECAR.replace('opb:00340', 'opb:00593'))
      const labels = (name) => cell(name, 'what').props('options').map(({ label }) => label)
      expect(cell('x', 'what').props('modelValue')).toBe('OPB:00593')
      expect(labels('x')[0]).toBe('Chemical amount density flow rate')
      expect(labels('J')).not.toContain('Chemical amount density flow rate')
    })

    it('takes a species only for a property of one, and drops it for any other', async () => {
      await mountTab()
      expect(cell('J', 'species').props('disabled')).toBe(true)
      expect(cell('x', 'species').props('disabled')).toBe(false)

      await edit('x', 'what', 'OPB:00425')
      expect(cell('x', 'species').props('disabled')).toBe(false)
      expect(entryOf('x')).toMatchObject({ property: 'OPB:00425', species: ['CHEBI:29101'] })

      await edit('x', 'what', 'OPB:00506')
      expect(cell('x', 'species').props('disabled')).toBe(true)
      expect(entryOf('x')).toMatchObject({ property: 'OPB:00506', species: [] })
      expect(port('x').text()).toBe('○')
    })

    it('reads typed species text as a pasted ChEBI term, and drops text that is not one', async () => {
      await mountTab()
      await edit('x', 'species', ['chebi_29103', 'sodium'])
      expect(entryOf('x').species).toEqual(['CHEBI:29103'])
    })

    it('warns when units do not suit the property, without changing anything', async () => {
      const part = (units, prefix = 0, exponent = 1) => ({ units, prefix, exponent, multiplier: 1 })
      const unitDefinitions = new Map([
        ['mM', [part('mole', -3), part('litre', 0, -1)]],
        ['mol_per_s', [part('mole'), part('second', 0, -1)]],
      ])
      await mountTab({ unitDefinitions })
      expect(wrapper.find('[data-test="units-warning"]').exists()).toBe(false)

      await edit('J', 'what', 'OPB:00425')
      expect(rowOf('J').find('[data-test="units-warning"]').attributes('aria-label')).toBe('mol_per_s isn’t an amount')
      expect(entryOf('J').property).toBe('OPB:00425')

      await edit('J', 'what', 'OPB:00592')
      expect(rowOf('J').find('[data-test="units-warning"]').exists()).toBe(false)
    })

    it('warns of a term whose id doesn’t fit its ontology, without changing it', async () => {
      await mountTab({}, SIDECAR.replace('opb:00340', 'opb:0006096'))
      const warning = rowOf('x').find('[data-test="term-warning"]')
      expect(warning.attributes('aria-label')).toBe('OPB:0006096 doesn’t fit OPB’s ids, such as OPB:00340')
      expect(rowOf('J').find('[data-test="term-warning"]').exists()).toBe(false)
      expect(wrapper.props('draft').variables.size).toBe(0)

      await edit('x', 'what', 'OPB:00340')
      expect(rowOf('x').find('[data-test="term-warning"]').exists()).toBe(false)
    })

    it('warns of ChEBI and GO terms OLS doesn’t know, looking each up once', async () => {
      const lookupOntologyTerm = vi.fn(async (curie) => (curie === 'CHEBI:99999999' ? null : { label: curie }))
      await mountTab({ lookupOntologyTerm }, SIDECAR.replace('chebi:29101', 'chebi:99999999'))
      expect(rowOf('x').find('[data-test="term-warning"]').attributes('aria-label')).toBe(
        'OLS has no term CHEBI:99999999'
      )
      // Terms with a known label aren't looked up.
      expect(lookupOntologyTerm.mock.calls.map(([curie]) => curie)).toEqual(['CHEBI:99999999'])

      await edit('J', 'what', 'OPB:00340')
      await edit('J', 'species', [{ curie: 'CHEBI:99999999' }])
      await flushPromises()
      expect(rowOf('J').find('[data-test="term-warning"]').exists()).toBe(true)
      expect(lookupOntologyTerm).toHaveBeenCalledOnce()
    })

    it('warns of the module’s own malformed terms above the table', async () => {
      await mountTab({}, SIDECAR.replace(/sbo:0000290/g, 'sbo:290'))
      expect(wrapper.find('[data-test="module-term-warning"]').text()).toContain(
        'SBO:290 doesn’t fit SBO’s ids, such as SBO:0000290'
      )
    })

    it('offers the places the module kind has, and keeps a saved one it does not', async () => {
      await mountTab()
      const places = (name) => cell(name, 'whose').props('options').map(({ value, label }) => [value, label])
      expect(places('J')).toEqual([
        ['self', 'This compartment'],
        ['self+GO:0005886', 'Its membrane'],
      ])
      // x is in the cytoplasm, which a compartment doesn't offer.
      expect(places('x').at(-1)).toEqual(['GO:0005737', 'Cytoplasm (not usual for a compartment)'])

      const kind = wrapper.findComponent('[data-test="module-kind"]')
      await kind.vm.$emit('update:modelValue', 'membrane')
      expect(places('J')).toEqual([
        ['self', 'This membrane'],
        ['GO:0005737', 'Cytoplasm'],
        ['GO:0005576', 'Extracellular'],
      ])
      await kind.vm.$emit('update:modelValue', 'transporter')
      expect(places('J').map(([value]) => value)).toEqual(['GO:0005737', 'GO:0005576', 'GO:0005886'])
      await kind.vm.$emit('update:modelValue', 'none')
      expect(places('J')).toHaveLength(5)
    })

    it('leaves Whose empty on an unannotated row', async () => {
      await mountTab()
      expect(cell('J', 'whose').props('modelValue')).toBeNull()
    })
  })

  describe('a flow', () => {
    it('has a From only on a flow row, starting empty, from the other side', async () => {
      await mountTab()
      await edit('J', 'what', 'OPB:00340')
      expect(rowOf('J').find('[data-test="from"]').exists()).toBe(false)

      await edit('J', 'what', 'OPB:00592')
      expect(cell('J', 'from').props('modelValue')).toBeNull()
      // Nowhere to flow into yet, so nowhere to come from.
      expect(cell('J', 'from').props('disabled')).toBe(true)

      await edit('J', 'whose', 'self')
      expect(cell('J', 'from').props('options')).toEqual([])

      await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'transporter')
      await edit('J', 'whose', 'GO:0005737')
      expect(cell('J', 'from').props('modelValue')).toBeNull()
      expect(cell('J', 'from').props('options').map(({ value }) => value)).toEqual(['GO:0005576'])

      await edit('J', 'from', 'GO:0005576')
      expect(entryOf('J')).toMatchObject({ location: 'GO:0005737', from: 'GO:0005576' })
      // Flowing into the source drops it.
      await edit('J', 'whose', 'GO:0005576')
      expect(entryOf('J')).toMatchObject({ location: 'GO:0005576', from: null })
    })

    it('shows the process on hover, naming the mediator by its protein once known', async () => {
      await mountTab({}, TRANSPORTER)
      const process = () => rowOf('x').find('[data-test="process"]').attributes('aria-label')
      expect(cell('x', 'from').props('modelValue')).toBe('GO:0005576')
      expect(process()).toBe('Process: Na⁺ extracellular → cytoplasm, via decay')

      rememberTerms([{ curie: 'uniprot:P13866', label: 'SGLT1' }])
      await flushPromises()
      expect(process()).toBe('Process: Na⁺ extracellular → cytoplasm, via SGLT1')
    })
  })

  describe('bulk edits', () => {
    const tick = (name) => cell(name, 'select').vm.$emit('update:modelValue', true)
    const note = () => wrapper.find('[data-test="bulk-note"]').text()

    it('applies a chosen value to the ticked rows only, and says how many it skipped', async () => {
      await mountTab()
      await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', true)
      expect(wrapper.find('[data-test="bulk"]').exists()).toBe(false)
      await tick('x')
      await tick('J')
      expect(wrapper.find('[data-test="bulk"]').text()).toContain('With 2 selected:')

      await wrapper.findComponent('[data-test="bulk-whose"]').vm.$emit('update:modelValue', 'self')
      expect(note()).toBe('Set whose on 2 rows.')
      expect(entryOf('x')).toMatchObject({ location: 'self', species: ['CHEBI:29101'] })
      expect(entryOf('J')).toEqual({ property: null, species: [], location: 'self', from: null })
      expect(wrapper.props('draft').variables.has('k')).toBe(false)

      // J has no property of a species yet, so it is skipped.
      await wrapper.findComponent('[data-test="bulk-species"]').vm.$emit('option-select', {
        value: { curie: 'CHEBI:29103' },
      })
      expect(note()).toBe('Set of what on 1 row; skipped 1 row whose What takes no species.')
      expect(entryOf('x').species).toEqual(['CHEBI:29103'])
      expect(entryOf('J').species).toEqual([])

      await wrapper.findComponent('[data-test="bulk-what"]').vm.$emit('update:modelValue', 'OPB:00425')
      expect(entryOf('x')).toMatchObject({ property: 'OPB:00425', species: ['CHEBI:29103'] })
      expect(entryOf('J')).toMatchObject({ property: 'OPB:00425', location: 'self' })

      await wrapper.find('[data-test="bulk-clear"]').trigger('click')
      expect(note()).toBe('Cleared 2 rows.')
      expect(entryOf('x')).toBeNull()
      expect(wrapper.props('draft').variables.has('J')).toBe(false)
      expect(wrapper.props('draft').variables.has('k')).toBe(false)
    })

    it('ticks every shown row from the header', async () => {
      await mountTab()
      await wrapper.findComponent('[data-test="select-all"]').vm.$emit('update:modelValue', true)
      expect(wrapper.find('[data-test="bulk"]').text()).toContain('With 2 selected:')
      await wrapper.findComponent('[data-test="select-all"]').vm.$emit('update:modelValue', false)
      expect(wrapper.find('[data-test="bulk"]').exists()).toBe(false)
    })
  })

  describe('species search', () => {
    it('finds species in the workspace and the table, and takes a pasted ChEBI IRI', async () => {
      await mountTab({ workspaceTerms: ['CHEBI:29108'] })
      const species = cell('x', 'species')

      await species.vm.$emit('complete', { query: '' })
      await flushPromises()
      expect(species.props('suggestions')[0]).toMatchObject({ curie: 'CHEBI:29108', source: 'workspace' })
      // The row's own species isn't offered again.
      expect(species.props('suggestions').map((item) => item.curie)).not.toContain('CHEBI:29101')

      await species.vm.$emit('complete', { query: 'http://purl.obolibrary.org/obo/CHEBI_17996' })
      await flushPromises()
      expect(species.props('suggestions')[0]).toMatchObject({ curie: 'CHEBI:17996', source: 'pasted' })

      await species.vm.$emit('complete', { query: 'GO:0005737' })
      await flushPromises()
      expect(species.props('suggestions')).toEqual([])
    })

    it('searches species with the search it is given', async () => {
      const findSpeciesTerms = async (query) => [{ curie: 'CHEBI:1', label: query }]
      await mountTab({ findSpeciesTerms })
      const species = cell('x', 'species')

      await species.vm.$emit('complete', { query: 'remote' })
      await flushPromises()
      expect(species.props('suggestions')).toEqual([{ curie: 'CHEBI:1', label: 'remote' }])
    })

    it('adds ChEBI results after the local ones, with an obsolete badge', async () => {
      vi.useFakeTimers()
      const searchRemoteSpecies = vi.fn(async () => [
        { curie: 'CHEBI:29103', label: 'potassium(1+)' },
        { curie: 'CHEBI:26708', label: 'sodium atom', isObsolete: true },
      ])
      await mountTab({ searchRemoteSpecies })
      const species = cell('J', 'species')

      species.vm.$emit('complete', { query: 'potassium' })
      await vi.advanceTimersByTimeAsync(0)
      expect(species.props('suggestions').map((item) => item.curie)).toEqual(['CHEBI:29103'])

      await vi.advanceTimersByTimeAsync(300)
      expect(searchRemoteSpecies.mock.calls[0][0]).toBe('potassium')
      expect(species.props('suggestions')).toEqual([
        expect.objectContaining({ curie: 'CHEBI:29103', source: 'table' }),
        { curie: 'CHEBI:26708', label: 'sodium atom', isObsolete: true, source: 'chebi' },
      ])
    })

    it('searches online only for typed words, not pasted terms or short text', async () => {
      vi.useFakeTimers()
      const searchRemoteSpecies = vi.fn(async () => [])
      await mountTab({ searchRemoteSpecies, lookupOntologyTerm: async () => null })
      const species = cell('x', 'species')

      species.vm.$emit('complete', { query: 'na' })
      species.vm.$emit('complete', { query: 'CHEBI:29101' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(searchRemoteSpecies).not.toHaveBeenCalled()
    })

    it('says the online lookup is unavailable but keeps the local species', async () => {
      vi.useFakeTimers()
      const searchRemoteSpecies = async () => {
        throw new LookupUnavailableError('Offline')
      }
      await mountTab({ searchRemoteSpecies })
      const species = cell('x', 'species')

      species.vm.$emit('complete', { query: 'potassium' })
      await vi.advanceTimersByTimeAsync(300)
      expect(species.props('suggestions').map((item) => item.curie)).toEqual(['CHEBI:29103'])
      expect(wrapper.vm.$.setupState.speciesLookup).toBe('unavailable')
    })

    it('labels a pasted species from its online lookup', async () => {
      const lookupOntologyTerm = vi.fn(async () => ({ label: 'remote label', isObsolete: true }))
      await mountTab({ lookupOntologyTerm })
      const species = cell('x', 'species')

      await species.vm.$emit('complete', { query: 'CHEBI:4167' })
      await flushPromises()
      expect(lookupOntologyTerm).toHaveBeenCalledWith('CHEBI:4167')
      expect(species.props('suggestions')[0]).toMatchObject({ curie: 'CHEBI:4167', label: 'remote label', isObsolete: true })
    })
  })

  describe('import and export', () => {
    const fileOf = (text) => new File([text], 'decay.ttl', { type: 'text/turtle' })

    it('replaces the annotations with an imported file only once confirmed', async () => {
      const confirmImport = vi.fn(async () => false)
      await mountTab({ confirmImport })
      const imported = SIDECAR.replace('opb:00340', 'opb:00425').replace('dcterms:description "A pool"', 'dcterms:title "Pool"')
      await wrapper.vm.importFile(fileOf(imported))
      expect(confirmImport).toHaveBeenCalled()
      expect(wrapper.props('draft').imported).toBeUndefined()

      await wrapper.setProps({ confirmImport: async () => true })
      await edit('J', 'what', 'OPB:00154')
      await wrapper.vm.importFile(fileOf(imported))
      await flushPromises()
      expect(wrapper.props('draft').imported.text).toBe(imported)
      expect(cell('x', 'what').props('modelValue')).toBe('OPB:00425')
      // Earlier edits were of the old annotations.
      expect(cell('J', 'what').props('modelValue')).toBeNull()
      expect(wrapper.find('[data-test="other-annotations"]').text()).toContain('dcterms:title "Pool"')
      expect(notify.warning).not.toHaveBeenCalled()
    })

    it('shows what an imported file could not say about this math, and refuses one that does not parse', async () => {
      await mountTab()
      await wrapper.vm.importFile(fileOf(SIDECAR.replace('vdecayx01', 'vmissing')))
      expect(notify.warning).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('name variables this math doesn’t have') })
      )

      await wrapper.vm.importFile(fileOf('not turtle {'))
      expect(notify.error).toHaveBeenCalled()
      expect(wrapper.props('draft').imported.text).toContain('vmissing')
    })

    it('lists the imported terms whose ids don’t fit, and keeps them as written', async () => {
      await mountTab()
      const imported = SIDECAR.replace('opb:00340', 'opb:0006096')
      await wrapper.vm.importFile(fileOf(imported))
      expect(notify.warning).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'x: OPB:0006096 doesn’t fit OPB’s ids, such as OPB:00340.' })
      )
      expect(wrapper.props('draft').imported.text).toBe(imported)
    })

    it('exports the annotations with the draft as <module>.ttl, which imports back the same', async () => {
      const download = vi.fn()
      await mountTab({ download })
      await edit('x', 'what', 'OPB:00425')
      await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'membrane')
      // J has no id in the math until a save gives it one.
      await edit('J', 'what', 'OPB:00154')
      await wrapper.find('[data-test="export"]').trigger('click')
      await flushPromises()

      const [filename, blob] = download.mock.calls[0]
      expect(filename).toBe('decay.ttl')
      expect(notify.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('1 new annotation left out') }))

      const text = await blob.text()
      wrapper.unmount()
      await mountTab({}, text)
      expect(wrapper.findComponent('[data-test="module-kind"]').props('modelValue')).toBe('membrane')
      expect(cell('x', 'what').props('modelValue')).toBe('OPB:00425')
      expect(cell('x', 'species').props('modelValue').map((item) => item.curie)).toEqual(['CHEBI:29101'])
      expect(cell('x', 'whose').props('modelValue')).toBe('GO:0005737')
      expect(wrapper.find('[data-test="other-annotations"]').text()).toContain('dcterms:description "A pool"')
    })
  })

  it('keeps the triples it does not edit under More', async () => {
    await mountTab()
    await flushPromises()
    const other = wrapper.find('[data-test="other-annotations"]')
    expect(other.find('summary').text()).toBe('More (1)')
    expect(other.attributes('open')).toBeUndefined()
    expect(other.text()).toContain('dcterms:description "A pool"')
  })
})

describe('AnnotationTab placement and held flows', () => {
  const POOL_ROWS = [
    { name: 'c_A', units: 'mM', type: 'constant', value: '1' },
    { name: 'v_A', units: 'fmol_per_mm2_per_s', type: 'boundary_condition', value: '' },
    { name: 'volume', units: 'pL', type: 'constant', value: '2' },
  ]

  /** Mounts the tab on the toy pool, whose v_A sums the flows into it. */
  async function mountPool(props = {}) {
    const cellml = readToy('pool.cellml')
    const text = readToy('pool.ttl')
    const sidecar = await parseSidecar(text, { mathRef: 'pool.cellml:pool', cellml })
    wrapper = mount(AnnotationTab, {
      props: { rows: POOL_ROWS, sidecar, sidecarText: text, cellml, draft: createAnnotationDraft(), mathRef: 'pool.cellml:pool', ...props },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })
    await flushPromises()
    return wrapper
  }

  const holdBox = () => wrapper.findComponent('[data-test="hold-constant-checkbox"]')

  it('asks for the instance to be placed until it is', async () => {
    await mountPool()
    expect(wrapper.find('[data-test="unplaced-hint"]').text()).toContain('Place this instance in the physiology view')
    await wrapper.setProps({ isPlaced: true })
    expect(wrapper.find('[data-test="unplaced-hint"]').exists()).toBe(false)
  })

  it('offers to hold the summed flows at 0 only when the side-car sums some', async () => {
    await mountTab()
    expect(wrapper.find('[data-test="hold-constant"]').exists()).toBe(false)
    wrapper.unmount()
    await mountPool()
    expect(wrapper.find('[data-test="hold-constant"]').text()).toContain('Hold summed flows at 0')
    expect(holdBox().props('modelValue')).toBe(false)
  })

  it('holds and releases the flows through update:heldConstant', async () => {
    await mountPool()
    holdBox().vm.$emit('update:modelValue', true)
    await wrapper.setProps({ heldConstant: true })
    expect(holdBox().props('modelValue')).toBe(true)
    holdBox().vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('update:heldConstant')).toEqual([[true], [false]])
  })

  it('shows the flows as held only when the instance holds them, whatever their rows', async () => {
    await mountPool({ rows: POOL_ROWS.map((row) => (row.name === 'v_A' ? { ...row, type: 'constant', value: '0' } : row)) })
    expect(holdBox().props('modelValue')).toBe(false)
  })
})
