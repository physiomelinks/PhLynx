import { ref, onUnmounted } from 'vue'
import { ROW_H, AUTOSCROLL_SPEED, AUTOSCROLL_ZONE } from '../utils/constants'

/**
 * Dragging port rows to reorder them in the edge dialog.
 *
 * @param {import('vue').Ref<Array<Object>>} localSrcPorts
 * @param {import('vue').Ref<Array<Object>>} localTgtPorts
 * @param {import('vue').Ref<HTMLElement>} canvasEl
 * @param {Object} [options]
 * @param {(port: Object) => boolean} [options.isShown] - Whether a port has a row; hidden ones keep their places.
 */
export function usePortDrag(localSrcPorts, localTgtPorts, canvasEl, { isShown = () => true } = {}) {
  const dragState = ref({
    active: false,
    uid: null,
    side: null,
    originIndex: -1,
    fromIndex: -1,
    overIndex: -1,
    startContentY: 0,
    startScrollTop: 0,
    clientY: 0,
  })

  const dragOffsetY = ref(0)
  let autoScrollRef = null

  function viewportY(clientY) {
    const el = canvasEl.value
    if (!el) return 0
    return clientY - el.getBoundingClientRect().top
  }

  function contentY(clientY) {
    const el = canvasEl.value
    if (!el) return 0
    return viewportY(clientY) + el.scrollTop
  }

  function startAutoScroll() {
    if (autoScrollRef) return
    function tick() {
      const state = dragState.value
      const el = canvasEl.value
      if (!state?.active || !el) { autoScrollRef = null; return }

      const vy = viewportY(state.clientY)
      const canvasH = el.clientHeight
      const maxScroll = el.scrollHeight - el.clientHeight

      if (vy < AUTOSCROLL_ZONE && el.scrollTop > 0) {
        const speed = AUTOSCROLL_SPEED * (1 - Math.max(0, vy) / AUTOSCROLL_ZONE)
        el.scrollTop = Math.max(0, el.scrollTop - speed)
      } else if (vy > canvasH - AUTOSCROLL_ZONE && el.scrollTop < maxScroll) {
        const speed = AUTOSCROLL_SPEED * (1 - (canvasH - vy) / AUTOSCROLL_ZONE)
        el.scrollTop = Math.min(maxScroll, el.scrollTop + speed)
      }

      updateDragState(state)
      autoScrollRef = requestAnimationFrame(tick)
    }
    autoScrollRef = requestAnimationFrame(tick)
  }

  function stopAutoScroll() {
    if (autoScrollRef) { 
      cancelAnimationFrame(autoScrollRef)
      autoScrollRef = null 
    }
  }

  function updateDragState(state) {
    const all = state.side === 'source'
      ? localSrcPorts.value
      : localTgtPorts.value
    const ports = all.filter(isShown)

    const totalDelta = contentY(state.clientY) - state.startContentY
    const nextIndex = Math.max(0, Math.min(ports.length - 1,
      state.originIndex + Math.round(totalDelta / ROW_H)
    ))

    if (nextIndex !== state.overIndex) {
      const moved = ports.splice(state.overIndex, 1)[0]
      ports.splice(nextIndex, 0, moved)
      // The rows take the shown ports' places in turn; hidden ports stay where they are.
      let next = 0
      all.forEach((port, i) => {
        if (isShown(port)) all[i] = ports[next++]
      })
      state.overIndex = nextIndex
    }

    const slotDisplacement = (state.overIndex - state.originIndex) * ROW_H
    dragOffsetY.value = totalDelta - slotDisplacement
  }

  function startDrag(event, uid, side) {
    event.preventDefault()
    const ports = (side === 'source' ? localSrcPorts.value : localTgtPorts.value).filter(isShown)
    const index = ports.findIndex(p => p._uid === uid)

    dragState.value = {
      active: true,
      uid,
      side,
      originIndex: index,
      fromIndex: index,
      overIndex: index,
      startContentY: contentY(event.clientY),
      startScrollTop: canvasEl.value?.scrollTop ?? 0,
      clientY: event.clientY,
    }
    dragOffsetY.value = 0

    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', endDrag)
    startAutoScroll()
  }

  function onDragMove(event) {
    const state = dragState.value
    if (!state.active) return

    state.clientY = event.clientY
    updateDragState(state)
  }

  function endDrag() {
    const state = dragState.value
    if (!state.active) return

    dragState.value.active = false
    dragOffsetY.value = 0
    stopAutoScroll()
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup', endDrag)
  }

  onUnmounted(() => {
    stopAutoScroll()
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup', endDrag)
  })

  function rowStyle(portUid, side) {
    const state = dragState.value
    if (!state?.active || state.uid !== portUid || state.side !== side) return {}

    return {
      transform: `translateY(${dragOffsetY.value}px)`,
      zIndex: 50,
      boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
      cursor: 'grabbing',
      transition: 'none',
    }
  }

  return {
    dragState,
    dragOffsetY,
    startDrag,
    rowStyle,
  }
}
