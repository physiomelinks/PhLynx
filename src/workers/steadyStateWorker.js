/**
 * Runs steady-state reductions off the main thread. Requests are `{ id, options }`, and replies are
 * `{ id, result }` or `{ id, error }`.
 */
import { analyseSteadyState } from '../services/steadyState/steadyState'

self.onmessage = ({ data }) => {
  const { id, options } = data ?? {}
  try {
    self.postMessage({ id, result: analyseSteadyState(options ?? {}) })
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) })
  }
}
