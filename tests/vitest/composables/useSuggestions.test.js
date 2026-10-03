import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useSuggestions } from '../../../src/composables/useSuggestions'

const NAMES = ['millivolt', 'millisecond', 'metre']

function setup(initial = 'mil') {
  const typed = ref(initial)
  const onPick = vi.fn()
  const suggest = (text) => NAMES.filter((name) => text && name.startsWith(text))
  const list = useSuggestions(typed, () => suggest, { onPick })
  return { typed, onPick, ...list }
}

const key = (name) => ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn() })

describe('useSuggestions', () => {
  it('stays empty until opened', () => {
    const { matches, open, highlighted } = setup()
    expect(matches.value).toEqual([])
    open()
    expect(matches.value.map((match) => match.value)).toEqual(['millivolt', 'millisecond'])
    expect(highlighted.value).toBe(0)
  })

  it('moves the highlight with the arrow keys, wrapping round', () => {
    const { open, onKeydown, highlighted } = setup()
    open()
    onKeydown(key('ArrowDown'))
    expect(highlighted.value).toBe(1)
    onKeydown(key('ArrowDown'))
    expect(highlighted.value).toBe(0)
    onKeydown(key('ArrowUp'))
    expect(highlighted.value).toBe(1)
  })

  it('opens on ArrowDown', () => {
    const { onKeydown, matches } = setup()
    expect(onKeydown(key('ArrowDown'))).toBe(true)
    expect(matches.value).toHaveLength(2)
  })

  it('takes the highlighted name on Tab', () => {
    const { open, onKeydown, onPick, matches } = setup()
    open()
    const event = key('Tab')
    expect(onKeydown(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(onPick).toHaveBeenCalledWith('millivolt')
    expect(matches.value).toEqual([])
  })

  it('leaves Enter to the caller until an arrow key has picked a name', () => {
    const { open, onKeydown, onPick } = setup()
    open()
    expect(onKeydown(key('Enter'))).toBe(false)
    expect(onPick).not.toHaveBeenCalled()

    onKeydown(key('ArrowDown'))
    expect(onKeydown(key('Enter'))).toBe(true)
    expect(onPick).toHaveBeenCalledWith('millisecond')
  })

  it('closes on Escape without picking, stopping it reaching the dialog', () => {
    const { open, onKeydown, onPick, matches } = setup()
    open()
    const event = key('Escape')
    expect(onKeydown(event)).toBe(true)
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
    expect(matches.value).toEqual([])
    expect(onKeydown(key('Escape'))).toBe(false)
  })

  it('resets the highlight and arrow-key choice when the text changes', async () => {
    const { typed, open, onKeydown, onPick, highlighted } = setup()
    open()
    onKeydown(key('ArrowDown'))
    typed.value = 'millis'
    await nextTick()
    expect(highlighted.value).toBe(0)
    expect(onKeydown(key('Enter'))).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('does nothing without a suggest function', () => {
    const list = useSuggestions(ref('mil'), () => null, { onPick: vi.fn() })
    list.open()
    expect(list.matches.value).toEqual([])
    expect(list.onKeydown(key('ArrowDown'))).toBe(false)
  })

  it('carries each suggestion\'s detail and picks its value', () => {
    const onPick = vi.fn()
    const list = useSuggestions(ref('mil'), () => () => [{ value: 'millivolt', detail: '10⁻³ V' }, 'millisecond'], { onPick })
    list.open()
    expect(list.matches.value).toEqual([
      { value: 'millivolt', detail: '10⁻³ V' },
      { value: 'millisecond', detail: '' },
    ])
    list.onKeydown(key('Tab'))
    expect(onPick).toHaveBeenCalledWith('millivolt')
  })
})
