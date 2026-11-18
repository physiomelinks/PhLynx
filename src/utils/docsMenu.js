/**
 * The docs sidebar's groups and pages.
 */

export const menuGroups = [
  {
    title: 'Getting Started',
    icon: 'pi pi-star-fill',
    items: [
      { label: 'Introduction', path: '/docs/getting-started/introduction' },
      { label: 'Quick Start Guide', path: '/docs/getting-started/quick-start-guide' },
    ],
  },
  {
    title: 'Guides',
    icon: 'pi pi-book',
    items: [
      { label: 'Building Macros', path: '/docs/guides/macro-build-guide' },
      { label: 'Using Custom Modules', path: '/docs/guides/build-custom-module' },
      { label: 'Writing CellML', path: '/docs/guides/writing-cellml' },
      { label: 'Drawing CellDL Modules (beta)', path: '/docs/guides/drawing-celldl-modules' },
      { label: 'Simulating Your Model', path: '/docs/guides/simulating-your-model' },
      { label: 'Running Protocols', path: '/docs/guides/running-protocols' },
      { label: 'The Physiology View', path: '/docs/guides/physiology-view' },
      { label: 'Coupling with Annotations', path: '/docs/guides/annotation-coupling' },
      { label: 'Using Circulatory Autogen', path: '/docs/guides/use-with-circulatory-autogen' },
      { label: 'Developer Guide', path: '/docs/guides/develop-phlynx' },
    ],
  },
  {
    title: 'Reference',
    icon: 'pi pi-list',
    items: [
      { label: 'Interface Overview', path: '/docs/reference/ui-overview' },
      { label: 'Simulation UI Reference', path: '/docs/reference/simulation-ui-overview' },
      { label: 'Keyboard Shortcuts', path: '/docs/reference/keyboard-shortcuts' },
      { label: 'Ghost Nodes', path: '/docs/reference/ghost-nodes' },
      { label: 'Port Logic', path: '/docs/reference/valid-port-configurations' },
      { label: 'Annotation Vocabulary', path: '/docs/reference/annotation-vocabulary' },
      { label: 'Supported File Formats', path: '/docs/reference/file-types' },
      { label: 'CellML Module Format', path: '/docs/reference/cellml-module-format' },
      { label: 'CellML Units File', path: '/docs/reference/cellml-units-file' },
      { label: 'Glossary', path: '/docs/reference/glossary' },
      { label: 'Changelog', path: '/docs/reference/change-log' },
    ],
  },
  {
    title: 'Help',
    icon: 'pi pi-question-circle',
    items: [
      { label: 'FAQs & Troubleshooting', path: '/docs/support/faq-and-troubleshooting' },
      { label: 'Feedback & Support', path: '/docs/support/support' },
    ],
  },
]

const pagesByPath = new Map(menuGroups.flatMap((group) => group.items.map((item) => [item.path, { ...item, group: group.title }])))

/**
 * The sidebar's entry for a docs page.
 *
 * @param {string} path - Such as `/docs/guides/macro-build-guide`.
 * @returns {{label: string, path: string, group: string}|undefined}
 */
export function docsPage(path) {
  return pagesByPath.get(path)
}
