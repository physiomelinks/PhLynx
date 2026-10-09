import plainTheme from '../assets/node-themes/plain.json'

/**
 * Node colour themes.
 *
 * A theme names a set of categories and gives each one a colour. A node stores only the category
 * key (`data.domainType`), never a colour, so switching theme recolours every node and saved
 * workspaces do not depend on any one theme. Shared themes live in the physiomelinks/PhLynxThemes
 * repository and are served from jsDelivr; themes a user makes are kept in their browser.
 */

/** The theme format this build understands; the CDN URL is pinned to the same major version. */
export const THEME_SCHEMA_VERSION = 1

export const THEME_REPO = {
  owner: 'physiomelinks',
  repo: 'PhLynxThemes',
  issueTemplate: 'theme-submission.yml',
}

/** Resolves to the newest v1.x.y tag, so a breaking schema change never reaches an older build. */
export const THEMES_CDN_URL = `https://cdn.jsdelivr.net/gh/${THEME_REPO.owner}/${THEME_REPO.repo}@${THEME_SCHEMA_VERSION}/dist/themes.json`

export const LOCAL_THEME_PREFIX = 'local:'

export const THEME_LIMITS = {
  name: 64,
  description: 280,
  author: 64,
  label: 32,
  categories: 24,
}

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const CATEGORY_KEY = /^[a-z][a-z0-9-]{0,31}$/
const THEME_ID = /^[a-z][a-z0-9-]{1,47}$/

/** Rough luminance of the node text colour in each colour scheme, for contrast hints. */
export const TEXT_COLOURS = { light: '#334155', dark: '#f8fafc' }

/**
 * @param {*} value
 * @returns {boolean} Whether `value` is a #rgb or #rrggbb colour. Only hex is accepted because the
 *   value ends up in a style binding.
 */
export function isValidColour(value) {
  return typeof value === 'string' && HEX_COLOUR.test(value.trim())
}

/**
 * @param {string} value - A valid hex colour, with or without '#'.
 * @returns {string} The colour as lower-case #rrggbb.
 */
export function normaliseColour(value) {
  let hex = value.trim().replace(/^#/, '').toLowerCase()
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  return `#${hex}`
}

/**
 * @param {*} value
 * @returns {boolean} Whether `value` is a usable category key.
 */
export function isValidCategoryKey(value) {
  return typeof value === 'string' && CATEGORY_KEY.test(value)
}

/**
 * @param {string} text
 * @returns {string} Lower-case, hyphenated, safe as a theme id or category key ('' if nothing is left).
 */
export function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
}

function optionalString(raw, field, max, errors) {
  if (raw[field] === undefined || raw[field] === null || raw[field] === '') return undefined
  if (typeof raw[field] !== 'string') {
    errors.push(`"${field}" must be text.`)
    return undefined
  }
  const value = raw[field].trim()
  if (value.length > max) errors.push(`"${field}" must be at most ${max} characters.`)
  return value
}

/**
 * Checks a theme and returns a clean copy holding only the known fields.
 *
 * @param {*} raw - Parsed JSON.
 * @param {Object} [options]
 * @param {boolean} [options.allowLocalId=false] - Accept ids with the 'local:' prefix.
 * @returns {{ theme: Object|null, errors: Array<string> }} `theme` is null when there are errors.
 */
export function validateTheme(raw, { allowLocalId = false } = {}) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { theme: null, errors: ['A theme must be a JSON object.'] }
  }

  if (raw.schemaVersion !== THEME_SCHEMA_VERSION) {
    errors.push(`"schemaVersion" must be ${THEME_SCHEMA_VERSION}.`)
  }

  const id = typeof raw.id === 'string' ? raw.id : ''
  const bareId = allowLocalId && id.startsWith(LOCAL_THEME_PREFIX) ? id.slice(LOCAL_THEME_PREFIX.length) : id
  if (!THEME_ID.test(bareId)) {
    errors.push('"id" must start with a letter and use only lower-case letters, digits and hyphens (2-48 characters).')
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) errors.push('"name" is required.')
  else if (name.length > THEME_LIMITS.name) errors.push(`"name" must be at most ${THEME_LIMITS.name} characters.`)

  const description = optionalString(raw, 'description', THEME_LIMITS.description, errors)
  const author = optionalString(raw, 'author', THEME_LIMITS.author, errors)
  const license = optionalString(raw, 'license', 64, errors)
  const derivedFrom = optionalString(raw, 'derivedFrom', 64, errors)

  const categories = []
  if (!Array.isArray(raw.categories) || raw.categories.length === 0) {
    errors.push('"categories" must be a non-empty list.')
  } else if (raw.categories.length > THEME_LIMITS.categories) {
    errors.push(`A theme can have at most ${THEME_LIMITS.categories} categories.`)
  } else {
    const seen = new Set()
    raw.categories.forEach((category, index) => {
      const where = `Category ${index + 1}`
      if (!category || typeof category !== 'object') {
        errors.push(`${where} must be an object.`)
        return
      }
      if (!isValidCategoryKey(category.key)) {
        errors.push(`${where}: "key" must start with a letter and use only lower-case letters, digits and hyphens.`)
      } else if (seen.has(category.key)) {
        errors.push(`${where}: key "${category.key}" is used more than once.`)
      }
      seen.add(category.key)

      const label = typeof category.label === 'string' ? category.label.trim() : ''
      if (!label) errors.push(`${where}: "label" is required.`)
      else if (label.length > THEME_LIMITS.label) errors.push(`${where}: "label" must be at most ${THEME_LIMITS.label} characters.`)

      if (!isValidColour(category.color)) errors.push(`${where}: "color" must be a hex colour such as #a1b2c3.`)
      if (category.dark !== undefined && category.dark !== null && category.dark !== '' && !isValidColour(category.dark)) {
        errors.push(`${where}: "dark" must be a hex colour such as #a1b2c3, or left out.`)
      }

      const clean = { key: category.key, label, color: isValidColour(category.color) ? normaliseColour(category.color) : category.color }
      if (isValidColour(category.dark)) clean.dark = normaliseColour(category.dark)
      categories.push(clean)
    })
  }

  if (errors.length) return { theme: null, errors }

  const theme = { schemaVersion: THEME_SCHEMA_VERSION, id, name }
  if (description) theme.description = description
  if (author) theme.author = author
  if (license) theme.license = license
  if (derivedFrom) theme.derivedFrom = derivedFrom
  theme.categories = categories
  return { theme, errors }
}

/**
 * Reads the combined index published by the theme repository, skipping themes that fail validation
 * (and any that claim a local id).
 *
 * @param {*} index - Parsed `dist/themes.json`: `{ schemaVersion, themes: [...] }`.
 * @returns {{ themes: Array<Object>, skipped: Array<{ id: string, errors: Array<string> }> }}
 */
export function parseThemeIndex(index) {
  const list = Array.isArray(index?.themes) ? index.themes : []
  const themes = []
  const skipped = []
  const ids = new Set()
  for (const raw of list) {
    const { theme, errors } = validateTheme(raw)
    if (!theme || ids.has(theme.id)) {
      skipped.push({ id: String(raw?.id ?? '?'), errors: theme ? ['Duplicate id.'] : errors })
      continue
    }
    ids.add(theme.id)
    themes.push(theme)
  }
  return { themes, skipped }
}

/** The built-in theme, always available: first paint, offline and Electron all use it. */
export const DEFAULT_THEME = Object.freeze(validateTheme(plainTheme).theme)

/**
 * @param {Object} theme
 * @param {string|null|undefined} key
 * @returns {Object|undefined} The theme's category with this key.
 */
export function findCategory(theme, key) {
  if (!key) return undefined
  return theme?.categories?.find((category) => category.key === key)
}

/**
 * CSS custom properties that colour a node. The dark colour falls back to the light one mixed into
 * the surface colour, so themes need not give one.
 *
 * @param {Object} theme
 * @param {string|null|undefined} key
 * @returns {Object|null} Style object, or null when the theme has no such category.
 */
export function categoryStyle(theme, key) {
  const category = findCategory(theme, key)
  if (!category) return null
  return {
    '--node-fill': category.color,
    '--node-fill-dark': category.dark ?? `color-mix(in srgb, ${category.color} 30%, var(--p-content-background))`,
  }
}

/**
 * @param {Object} theme
 * @param {string|null|undefined} key
 * @param {boolean} isDark
 * @returns {string|null} A plain colour for places that cannot use CSS variables (e.g. the MiniMap).
 */
export function categoryColour(theme, key, isDark = false) {
  const category = findCategory(theme, key)
  if (!category) return null
  return isDark ? category.dark ?? autoDarkColour(category.color) : category.color
}

/**
 * @param {string} color - Hex colour.
 * @returns {string} The dark mode colour used when a category gives none.
 */
export function autoDarkColour(color) {
  return mixHex(color, '#18181b', 0.3)
}

function hexToRgb(hex) {
  const value = normaliseColour(hex).slice(1)
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
}

function mixHex(a, b, weightOfA) {
  const [ra, ga, ba] = hexToRgb(a)
  const [rb, gb, bb] = hexToRgb(b)
  const mix = (x, y) => Math.round(x * weightOfA + y * (1 - weightOfA)).toString(16).padStart(2, '0')
  return `#${mix(ra, rb)}${mix(ga, gb)}${mix(ba, bb)}`
}

/**
 * @param {string} hex
 * @returns {number} WCAG relative luminance, 0-1.
 */
export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * @param {string} a - Hex colour.
 * @param {string} b - Hex colour.
 * @returns {number} WCAG contrast ratio, 1-21.
 */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Lists categories whose fill would make node text hard to read (below WCAG AA 4.5:1).
 *
 * @param {Object} theme
 * @returns {Array<{ key: string, scheme: 'light'|'dark', ratio: number }>}
 */
export function contrastWarnings(theme) {
  const warnings = []
  for (const category of theme?.categories ?? []) {
    if (!isValidColour(category.color)) continue
    const light = contrastRatio(category.color, TEXT_COLOURS.light)
    if (light < 4.5) warnings.push({ key: category.key, scheme: 'light', ratio: light })
    const darkFill = isValidColour(category.dark) ? category.dark : autoDarkColour(category.color)
    const dark = contrastRatio(darkFill, TEXT_COLOURS.dark)
    if (dark < 4.5) warnings.push({ key: category.key, scheme: 'dark', ratio: dark })
  }
  return warnings
}

/**
 * @param {string} id
 * @returns {boolean} Whether the theme was made on this device.
 */
export function isLocalThemeId(id) {
  return typeof id === 'string' && id.startsWith(LOCAL_THEME_PREFIX)
}

/**
 * Makes an editable copy of a theme under a new local id.
 *
 * @param {Object} base - The theme to start from.
 * @param {Object} [options]
 * @param {string} [options.name] - Defaults to "<base name> (copy)".
 * @param {Array<string>} [options.takenIds=[]] - Ids already in use.
 * @returns {Object}
 */
export function deriveTheme(base, { name, takenIds = [] } = {}) {
  const newName = (name || `${base.name} (copy)`).slice(0, THEME_LIMITS.name)
  const stem = slugify(newName) || 'theme'
  const taken = new Set(takenIds)
  let id = `${LOCAL_THEME_PREFIX}${stem}`
  for (let n = 2; taken.has(id); n++) id = `${LOCAL_THEME_PREFIX}${stem}-${n}`

  const theme = {
    schemaVersion: THEME_SCHEMA_VERSION,
    id,
    name: newName,
    categories: base.categories.map((category) => ({ ...category })),
  }
  if (base.description) theme.description = base.description
  const origin = isLocalThemeId(base.id) ? base.derivedFrom : base.id
  if (origin) theme.derivedFrom = origin
  return theme
}

/**
 * The theme as it should be proposed to the shared repository: an id taken from its current name
 * (a local id keeps the name it was created with), no local prefix, ordered fields.
 *
 * @param {Object} theme
 * @returns {Object}
 */
export function toSubmission(theme) {
  const bareId = isLocalThemeId(theme.id) ? theme.id.slice(LOCAL_THEME_PREFIX.length) : theme.id
  const id = slugify(theme.name).replace(/-+$/, '') || bareId
  const { theme: clean } = validateTheme({ ...theme, id })
  return clean ?? { ...theme, id }
}

/**
 * A link that opens a pre-filled theme submission issue. GitHub issue forms fill a field from the
 * query parameter named after the field's id.
 *
 * @param {Object} theme
 * @returns {string}
 */
export function buildSubmissionUrl(theme) {
  const submission = toSubmission(theme)
  const params = new URLSearchParams({
    template: THEME_REPO.issueTemplate,
    title: `Theme: ${submission.name}`,
    'theme-name': submission.name,
    'theme-json': JSON.stringify(submission, null, 2),
  })
  return `https://github.com/${THEME_REPO.owner}/${THEME_REPO.repo}/issues/new?${params.toString()}`
}
