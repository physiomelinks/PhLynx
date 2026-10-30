// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AutoComplete from 'primevue/autocomplete'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { afterEach, describe, expect, it } from 'vitest'

import AnnotationTab from '../../../src/components/annotations/AnnotationTab.vue'
import AnnotationChips from '../../../src/components/AnnotationChips.vue'
import { createAnnotationDraft } from '../../../src/services/annotations/draft.js'
import { parseSidecar } from '../../../src/services/annotations/sidecar.js'

const MATH_REF = 'file:decay'
const SIDECAR = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix opb: <http://identifiers.org/opb/OPB_> .
@prefix chebi: <http://purl.obolibrary.org/obo/CHEBI_> .
@prefix go: <http://purl.obolibrary.org/obo/GO_> .
@prefix sbo: <http://purl.obolibrary.org/obo/SBO_> .
@prefix m: <./file#> .
m:decay bqbiol:is sbo:0000290 ; dcterms:description "A pool" .
m:decay.x bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 , go:0005737 ] .
`
const ROWS = [
  { name: 't', units: 'second' },
  { name: 'x', units: 'mM' },
  { name: 'k', units: 'per_second', type: 'constant' },
  { name: 'J', units: 'mol_per_s' },
]
const KINDS = new Map([
  ['t', 'voi'],
  ['x', 'state'],
  ['k', 'constant'],
  ['J', 'algebraic'],
])

let wrapper
afterEach(() => wrapper?.unmount())

/**
 * Mounts the tab on the test sidecar, keeping its draft in step with what it emits.
 *
 * @param {Object} [props]
 * @returns {Promise<import('@vue/test-utils').VueWrapper>}
 */
async function mountTab(props = {}) {
  const sidecar = await parseSidecar(SIDECAR, { mathRef: MATH_REF })
  wrapper = mount(AnnotationTab, {
    props: {
      rows: ROWS,
      variableKinds: KINDS,
      sidecar,
      sidecarText: SIDECAR,
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

describe('AnnotationTab', () => {
  it('lists variables but not the VoI, and constants only when asked', async () => {
    await mountTab()
    expect(shownVariables()).toEqual(['x', 'J'])

    await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', true)
    expect(shownVariables()).toEqual(['x', 'k', 'J'])
  })

  it('shows an annotated variable as chips, and the others as Annotate…', async () => {
    await mountTab()
    expect(rowOf('x').findComponent(AnnotationChips).exists()).toBe(true)
    expect(rowOf('J').find('[data-test="annotate"]').exists()).toBe(true)
  })

  it('filters the rows by whether they are annotated', async () => {
    await mountTab()
    await wrapper.findComponent('[data-test="filter"]').vm.$emit('update:modelValue', 'unannotated')
    expect(shownVariables()).toEqual(['J'])
  })

  it('reads the module kind from the sidecar and drafts a change of it', async () => {
    await mountTab()
    const kind = wrapper.findComponent('[data-test="module-kind"]')
    expect(kind.props('modelValue')).toBe('compartment')

    await kind.vm.$emit('update:modelValue', 'membrane')
    expect(wrapper.props('draft').componentKind).toBe('membrane')

    await kind.vm.$emit('update:modelValue', 'compartment')
    expect(wrapper.props('draft').componentKind).toBeUndefined()
  })

  it('takes a transporter’s UniProt accession only once it is valid', async () => {
    await mountTab()
    await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'transporter')
    const input = wrapper.find('[data-test="uniprot-accession"]')
    expect(input.classes()).toContain('p-invalid')

    await input.setValue('not an accession')
    expect(wrapper.props('draft').transporter).toBeUndefined()
    expect(input.classes()).toContain('p-invalid')

    await input.setValue('p11168')
    expect(wrapper.props('draft')).toMatchObject({ componentKind: 'transporter', transporter: 'uniprot:P11168' })
  })

  it('drafts an annotation from the inline editor, and derives its role and port', async () => {
    await mountTab({ portStatus: new Map() })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const editor = wrapper.find('[data-test="annotation-editor"]')

    await editor.findComponent(Select).vm.$emit('update:modelValue', 'OPB:00592')
    await editor.findComponent('[data-test="location"]').vm.$emit('update:modelValue', 'GO:0005737')
    await editor.findComponent(AutoComplete).vm.$emit('update:modelValue', [{ curie: 'CHEBI:29101', label: 'Na⁺' }])
    expect(editor.find('[data-test="derived"]').text()).toMatch(/contributor · basicport · port will be created/)

    await editor.find('[data-test="done"]').trigger('click')
    expect(wrapper.props('draft').variables.get('J')).toEqual({
      property: 'OPB:00592',
      species: ['CHEBI:29101'],
      location: 'GO:0005737',
    })
    expect(rowOf('J').findComponent(AnnotationChips).exists()).toBe(true)
  })

  it('reads typed species text as a pasted ChEBI term, and drops text that is not one', async () => {
    await mountTab()
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    await species.vm.$emit('update:modelValue', ['chebi_29101', 'sodium'])
    expect(species.props('modelValue').map((item) => item.curie)).toEqual(['CHEBI:29101'])
  })

  it('offers only the six coupling properties and the five places', async () => {
    await mountTab()
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const editor = wrapper.find('[data-test="annotation-editor"]')
    expect(editor.findComponent(Select).props('options').map((option) => option.value)).toEqual([
      'OPB:00340',
      'OPB:00592',
      'OPB:00154',
      'OPB:00295',
      'OPB:00506',
      'OPB:00318',
    ])
    expect(editor.findComponent('[data-test="location"]').props('options').map((option) => option.value)).toEqual([
      'self',
      'self+GO:0005886',
      'GO:0005737',
      'GO:0005576',
      'GO:0005886',
    ])
  })

  it('finds species in the workspace and the table, and takes a pasted ChEBI IRI', async () => {
    await mountTab({ workspaceTerms: ['CHEBI:29108'] })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    await species.vm.$emit('complete', { query: '' })
    await flushPromises()
    expect(species.props('suggestions')[0]).toMatchObject({ curie: 'CHEBI:29108', source: 'workspace' })

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
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    await species.vm.$emit('complete', { query: 'remote' })
    await flushPromises()
    expect(species.props('suggestions')).toEqual([{ curie: 'CHEBI:1', label: 'remote' }])
  })

  it('clears an annotation in the draft', async () => {
    await mountTab()
    await rowOf('x').find('[data-test="clear-annotation"]').trigger('click')
    expect(wrapper.props('draft').variables.get('x')).toBeNull()
    expect(rowOf('x').find('[data-test="annotate"]').exists()).toBe(true)
  })

  it('lists the triples it does not edit as other annotations', async () => {
    await mountTab()
    await flushPromises()
    const other = wrapper.find('[data-test="other-annotations"]')
    expect(other.find('summary').text()).toBe('Other annotations (1)')
    expect(other.text()).toContain('dcterms:description "A pool"')
  })

  it('shows the shared banner and the unbound hint only when they apply', async () => {
    await mountTab({ sharedCount: 3 })
    expect(wrapper.find('[data-test="shared-banner"]').text()).toContain('Shared by 3 instances')
    expect(wrapper.find('[data-test="unbound-hint"]').exists()).toBe(true)

    await wrapper.setProps({ sharedCount: 1, isBound: true })
    expect(wrapper.find('[data-test="shared-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="unbound-hint"]').exists()).toBe(false)
  })
})
