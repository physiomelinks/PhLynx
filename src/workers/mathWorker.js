/**
 * Runs math analysis off the main thread. Requests are `{ id, items }`, and replies are
 * `{ id, result }` or `{ id, error }`.
 */
import { analyzeMathBatch } from '../services/math/analyzeMath'

self.onmessage = ({ data }) => {
  const { id, items } = data ?? {}
  try {
    self.postMessage({ id, result: analyzeMathBatch(items ?? []) })
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) })
  }
}
