/**
 * A synthetic CellML 1.0 model with encapsulation, as PMR has them (#787, #364):
 * - sodium_current has its own math and encapsulates two gates, relaying time and V to them (public_and_private);
 * - potassium_current nests two levels: its n gate encapsulates the gate's alpha rate;
 * - with `wrapper`, calcium_wrapper is a pure wrapper (no math) relaying V in and i_Ca out of calcium_current.
 * Each gate's state shares its name with the parent's private variable that reads it.
 */
const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML"'
const ci = (name) => `<ci>${name}</ci>`
const ode = (state, rhs) => `<math ${MATHML}><apply><eq/><apply><diff/><bvar>${ci('time')}</bvar>${ci(state)}</apply>${rhs}</apply></math>`
const times = (...args) => `<apply><times/>${args.join('')}</apply>`
const minus = (...args) => `<apply><minus/>${args.join('')}</apply>`
const plus = (...args) => `<apply><plus/>${args.join('')}</apply>`
const one = '<cn cellml:units="dimensionless">1</cn>'

export const FILE = 'encapsulated.cellml'

const groups = (wrapper) => `
  <group>
    <relationship_ref relationship="encapsulation"/>
    <component_ref component="sodium_current">
      <component_ref component="sodium_current_m_gate"/>
      <component_ref component="sodium_current_h_gate"/>
    </component_ref>
    <component_ref component="potassium_current">
      <component_ref component="potassium_current_n_gate">
        <component_ref component="potassium_current_n_gate_alpha"/>
      </component_ref>
    </component_ref>${
      wrapper
        ? `
    <component_ref component="calcium_wrapper">
      <component_ref component="calcium_current"/>
    </component_ref>`
        : ''
    }
  </group>`

/** The encapsulation group of the model without the wrapper. */
export const GROUPS = groups(false)

/** A containment group, which PhLynx ignores. */
export const CONTAINMENT = `
  <group>
    <relationship_ref relationship="containment"/>
    <component_ref component="membrane"><component_ref component="sodium_current"/><component_ref component="potassium_current"/></component_ref>
  </group>`

/**
 * Builds the model.
 *
 * @param {string} [extraGroups] - More groups, such as containment.
 * @param {Object} [options]
 * @param {boolean} [options.wrapper=false] - Adds the pure wrapper calcium_wrapper around calcium_current.
 * @returns {string}
 */
export const encapsulatedModel = (extraGroups = '', { wrapper = false } = {}) => `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/1.0#" xmlns:cellml="http://www.cellml.org/cellml/1.0#" name="encapsulated_channels">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="environment"><variable name="time" units="second" public_interface="out"/></component>
  <component name="membrane">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="V" units="dimensionless" initial_value="1" public_interface="out"/>
    <variable name="i_Na" units="per_second" public_interface="in"/>
    <variable name="i_K" units="per_second" public_interface="in"/>${wrapper ? '\n    <variable name="i_Ca" units="per_second" public_interface="in"/>' : ''}
    ${ode('V', minus(wrapper ? plus(ci('i_Na'), ci('i_K'), ci('i_Ca')) : plus(ci('i_Na'), ci('i_K'))))}
  </component>
  <component name="sodium_current">
    <variable name="time" units="second" public_interface="in" private_interface="out"/>
    <variable name="V" units="dimensionless" public_interface="in" private_interface="out"/>
    <variable name="g_Na" units="per_second" initial_value="2"/>
    <variable name="m" units="dimensionless" private_interface="in"/>
    <variable name="h" units="dimensionless" private_interface="in"/>
    <variable name="i_Na" units="per_second" public_interface="out"/>
    <math ${MATHML}><apply><eq/>${ci('i_Na')}${times(ci('g_Na'), ci('m'), ci('h'), ci('V'))}</apply></math>
  </component>
  <component name="sodium_current_m_gate">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="V" units="dimensionless" public_interface="in"/>
    <variable name="m" units="dimensionless" initial_value="0.1" public_interface="out"/>
    <variable name="alpha_m" units="per_second" initial_value="3"/>
    <variable name="beta_m" units="per_second" initial_value="1"/>
    ${ode('m', minus(times(ci('alpha_m'), minus(one, ci('m'))), times(ci('beta_m'), ci('V'), ci('m'))))}
  </component>
  <component name="sodium_current_h_gate">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="V" units="dimensionless" public_interface="in"/>
    <variable name="h" units="dimensionless" initial_value="0.9" public_interface="out"/>
    <variable name="k_h" units="per_second" initial_value="0.5"/>
    ${ode('h', minus(times(ci('k_h'), ci('V'), ci('h'))))}
  </component>
  <component name="potassium_current">
    <variable name="time" units="second" public_interface="in" private_interface="out"/>
    <variable name="V" units="dimensionless" public_interface="in" private_interface="out"/>
    <variable name="g_K" units="per_second" initial_value="1.5"/>
    <variable name="n" units="dimensionless" private_interface="in"/>
    <variable name="i_K" units="per_second" public_interface="out"/>
    <math ${MATHML}><apply><eq/>${ci('i_K')}${times(ci('g_K'), ci('n'), ci('V'))}</apply></math>
  </component>
  <component name="potassium_current_n_gate">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="V" units="dimensionless" public_interface="in" private_interface="out"/>
    <variable name="n" units="dimensionless" initial_value="0.3" public_interface="out"/>
    <variable name="alpha_n" units="per_second" private_interface="in"/>
    <variable name="beta_n" units="per_second" initial_value="0.2"/>
    ${ode('n', minus(times(ci('alpha_n'), minus(one, ci('n'))), times(ci('beta_n'), ci('n'))))}
  </component>
  <component name="potassium_current_n_gate_alpha">
    <variable name="V" units="dimensionless" public_interface="in"/>
    <variable name="a_n" units="per_second" initial_value="0.4"/>
    <variable name="alpha_n" units="per_second" public_interface="out"/>
    <math ${MATHML}><apply><eq/>${ci('alpha_n')}${times(ci('a_n'), plus(one, ci('V')))}</apply></math>
  </component>${
    wrapper
      ? `
  <component name="calcium_wrapper">
    <variable name="V" units="dimensionless" public_interface="in" private_interface="out"/>
    <variable name="i_Ca" units="per_second" public_interface="out" private_interface="in"/>
  </component>
  <component name="calcium_current">
    <variable name="V" units="dimensionless" public_interface="in"/>
    <variable name="g_Ca" units="per_second" initial_value="0.3"/>
    <variable name="i_Ca" units="per_second" public_interface="out"/>
    <math ${MATHML}><apply><eq/>${ci('i_Ca')}${times(ci('g_Ca'), ci('V'))}</apply></math>
  </component>`
      : ''
  }
  ${groups(wrapper)}${extraGroups}
  <connection><map_components component_1="environment" component_2="membrane"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="environment" component_2="sodium_current"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="environment" component_2="potassium_current"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="membrane" component_2="sodium_current"/>
    <map_variables variable_1="V" variable_2="V"/><map_variables variable_1="i_Na" variable_2="i_Na"/></connection>
  <connection><map_components component_1="membrane" component_2="potassium_current"/>
    <map_variables variable_1="V" variable_2="V"/><map_variables variable_1="i_K" variable_2="i_K"/></connection>
  <connection><map_components component_1="sodium_current" component_2="sodium_current_m_gate"/>
    <map_variables variable_1="time" variable_2="time"/><map_variables variable_1="V" variable_2="V"/><map_variables variable_1="m" variable_2="m"/></connection>
  <connection><map_components component_1="sodium_current" component_2="sodium_current_h_gate"/>
    <map_variables variable_1="time" variable_2="time"/><map_variables variable_1="V" variable_2="V"/><map_variables variable_1="h" variable_2="h"/></connection>
  <connection><map_components component_1="potassium_current" component_2="potassium_current_n_gate"/>
    <map_variables variable_1="time" variable_2="time"/><map_variables variable_1="V" variable_2="V"/><map_variables variable_1="n" variable_2="n"/></connection>
  <connection><map_components component_1="potassium_current_n_gate" component_2="potassium_current_n_gate_alpha"/>
    <map_variables variable_1="V" variable_2="V"/><map_variables variable_1="alpha_n" variable_2="alpha_n"/></connection>${
      wrapper
        ? `
  <connection><map_components component_1="membrane" component_2="calcium_wrapper"/>
    <map_variables variable_1="V" variable_2="V"/><map_variables variable_1="i_Ca" variable_2="i_Ca"/></connection>
  <connection><map_components component_1="calcium_wrapper" component_2="calcium_current"/>
    <map_variables variable_1="V" variable_2="V"/><map_variables variable_1="i_Ca" variable_2="i_Ca"/></connection>`
        : ''
    }
</model>`

/** The components PhLynx imports from the model without the wrapper. */
export const COMPONENTS = [
  'membrane',
  'sodium_current',
  'sodium_current_m_gate',
  'sodium_current_h_gate',
  'potassium_current',
  'potassium_current_n_gate',
  'potassium_current_n_gate_alpha',
]

/** And with it. */
export const WRAPPER_COMPONENTS = [...COMPONENTS, 'calcium_wrapper', 'calcium_current']

/** The model's states, as libOpenCOR names them. */
export const STATES = ['membrane/V', 'sodium_current_m_gate/m', 'sodium_current_h_gate/h', 'potassium_current_n_gate/n']
