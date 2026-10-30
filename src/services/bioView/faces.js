/**
 * Which face of a membrane protein each of its handles belongs on: outside the cell, inside it, or in
 * the membrane. A handle is where couplings meet the node, so its face comes from the places of the
 * quantities coupled there: each port's own annotation, else the sidecar's annotation of its first
 * variable.
 */

import { Position } from '@vue-flow/core'
import { GO } from '../annotations/iris.js'
import { getHandleId } from '../../utils/handles.js'

/** The face a GO cellular component puts a quantity on. */
function faceOf(location) {
  if (!location) return null
  const go = location.startsWith('self+') ? location.slice('self+'.length) : location
  if (go === GO.extracellularRegion) return 'outside'
  if (go === GO.cytoplasm) return 'inside'
  if (go === GO.plasmaMembrane || location === 'self') return 'membrane'
  return null
}

/**
 * Works out the face of one of a node's handles from the couplings at it. Given one edge, it is that
 * edge's face: a handle is a connection site that couplings to both sides of the membrane may share.
 *
 * @param {string} nodeId
 * @param {Object} handle - One of the node's data.handles.
 * @param {Array<Object>} edges - The edges to read.
 * @param {Object|null} sidecar - The node's module's parsed sidecar.
 * @returns {'outside'|'inside'|'membrane'|null} null when the couplings don't say, or disagree.
 */
export function handleFace(nodeId, handle, edges, sidecar) {
  const id = getHandleId(handle)
  const locationOf = (variable) => sidecar?.variables?.find((entry) => entry.variable === variable)?.location ?? null
  const votes = new Map()
  for (const edge of edges) {
    const side =
      edge.source === nodeId && edge.sourceHandle === id
        ? 'sourcePort'
        : edge.target === nodeId && edge.targetHandle === id
          ? 'targetPort'
          : null
    if (!side) continue
    for (const coupling of edge.data?.couplings ?? []) {
      const port = coupling[side]
      const face = faceOf(port?.annotation?.location ?? locationOf(port?.variables?.[0]))
      if (face) votes.set(face, (votes.get(face) ?? 0) + 1)
    }
  }
  if (!votes.size) return null
  const [[best, count], next] = [...votes].sort((a, b) => b[1] - a[1])
  return next && next[1] === count ? null : best
}

const OUTWARD = {
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
}

/**
 * Gives the point on a protein's cartoon where a face's couplings start, and which way they leave. The
 * cartoon is drawn with the outside up and turned to its facet, so its outer and inner edges lie half
 * its height from its centre, and its sides half its width.
 *
 * @param {{x: number, y: number, outward: string}} place - The protein's centre and the side facing out.
 * @param {'outside'|'inside'|'membrane'|null} face
 * @param {{width: number, height: number}} size - The cartoon, unturned.
 * @returns {{point: {x: number, y: number}, direction: {x: number, y: number}}}
 */
export function facePoint(place, face, { width, height }) {
  const out = OUTWARD[place.outward] ?? OUTWARD[Position.Top]
  const across = { x: -out.y, y: out.x }
  const [direction, reach] =
    face === 'outside'
      ? [out, height / 2]
      : face === 'inside'
        ? [{ x: -out.x, y: -out.y }, height / 2]
        : [across, width / 2]
  return { point: { x: place.x + direction.x * reach, y: place.y + direction.y * reach }, direction }
}
