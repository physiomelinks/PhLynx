import { validateTemplate } from '../../../src/services/bioView/templates.js'

/**
 * A one-cell template with a column down its right side and its left side free, as tests of both need: an
 * endothelial cell between the plasma and the interstitium, with an interendothelial junction.
 */
export const VESSEL_WALL = validateTemplate({
  schemaVersion: 1,
  id: 'vessel-wall',
  name: 'Vessel wall',
  cells: [
    {
      id: 'endothelial',
      label: 'Endothelial cell',
      membrane: { label: 'Plasma membrane' },
      facets: [
        { id: 'luminal', label: 'Luminal membrane', edge: 'top' },
        { id: 'abluminal', label: 'Abluminal membrane', edge: 'bottom' },
        { id: 'junction', label: 'Junctional membrane', edge: 'right' },
      ],
    },
  ],
  compartments: [
    { id: 'lumen', label: 'Vessel lumen (plasma)', against: ['endothelial.luminal'], tone: 'rose' },
    { id: 'interstitium', label: 'Interstitium', against: ['endothelial.abluminal'], tone: 'amber' },
    { id: 'junction-cleft', label: 'Interendothelial cleft', against: ['endothelial.junction'], tone: 'teal' },
  ],
}).template
