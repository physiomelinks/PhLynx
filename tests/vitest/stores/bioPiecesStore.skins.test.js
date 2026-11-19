// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBioPiecesStore } from '../../../src/stores/bioPiecesStore.js'

const ART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" onclick="x()"/></svg>'

describe('the workspace’s skins', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useBioPiecesStore()
  })

  it('keeps a loaded skin cleaned, named for its file, once however often it is loaded', () => {
    const { skin, errors } = store.addSkin('Myocyte art.svg', ART)
    expect(errors).toEqual([])
    expect(skin).toMatchObject({ id: 'myocyte-art', name: 'Myocyte art' })
    expect(skin.svg).not.toContain('onclick')
    expect(store.addSkin('again.svg', ART).skin).toBe(skin)
    expect(store.skins.size).toBe(1)
    expect(store.addSkin('bad.svg', '<p>no</p>').skin).toBeNull()
    expect(store.removeSkin('myocyte-art')).toBe(true)
    expect(store.skins.size).toBe(0)
  })

  it('saves them with the workspace, and cleans them again as it reads them', () => {
    expect(store.getState()).toBeNull()
    store.addSkin('art.svg', ART)
    const state = store.getState()
    expect(state.pieces).toEqual([])
    expect(Object.keys(state.skins)).toEqual(['art'])

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tampered = {
      ...state,
      skins: {
        art: { name: 'Art', svg: state.skins.art.svg.replace('<rect', '<script>1</script><rect') },
        junk: { name: 'Junk', svg: '<p/>' },
      },
    }
    store.loadState(tampered)
    expect([...store.skins.keys()]).toEqual(['art'])
    expect(store.skins.get('art').svg).not.toContain('script')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    store.resetState()
    expect(store.skins.size).toBe(0)
  })
})
