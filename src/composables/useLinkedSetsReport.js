import { watch } from 'vue'

import { useDefaultParametersStore } from '../stores/defaultParametersStore'
import { buildParametersReport } from '../utils/parameters/apply'

/**
 * Reports the parameter sets a config links as it arrives (Import ▸ Module Config, folder drops, instance arrays, the
 * manifest), with their warnings, as soon as it does, first offering each to the instances named after it. A flow
 * run through `holdLinkReports` reports them once it ends, unless its own parameters report took them first.
 *
 * @param {(report: Object) => void} show - Shows a report, as `notify` takes it.
 * @param {(links: Array<Object>) => Promise<Object>} [applyLinks] - Applies the linked sets to their instances once
 *   confirmed, giving what it did (`applyLinkedSets` of useParametersImport).
 * @returns {{holdLinkReports: <T>(run: () => Promise<T>) => Promise<T>, reportLinks: () => Promise<void>}}
 */
export function useLinkedSetsReport(show, applyLinks = null) {
  const defaults = useDefaultParametersStore()
  let holds = 0

  /** Offers and reports the links made since the last report, if any. */
  async function reportLinks() {
    const links = defaults.takeRecentLinks()
    if (!links.length) return
    const applied = applyLinks ? await applyLinks(links) : null
    show(buildParametersReport([], links, applied))
  }

  watch(
    () => defaults.recentLinks.length,
    (count) => {
      if (count && !holds) reportLinks()
    }
  )

  /**
   * Runs a flow that may link sets, reporting the links once it ends.
   *
   * @param {() => Promise<*>} run
   * @returns {Promise<*>} What `run` gives.
   */
  async function holdLinkReports(run) {
    holds++
    try {
      return await run()
    } finally {
      holds--
      if (!holds) await reportLinks()
    }
  }

  return { holdLinkReports, reportLinks }
}
