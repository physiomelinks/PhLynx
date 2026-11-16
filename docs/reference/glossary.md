# Glossary

### Annotation {#annotation}
<!-- aliases: annotations, annotated, annotated port, annotated ports -->
What a variable means, in standard ontology terms: its property, species and place. Annotated ports couple by meaning and place instead of by label. See [Coupling with Annotations](../guides/annotation-coupling.md).

### Basicport {#basicport}
<!-- aliases: basicports -->
A port that takes only one connection.

### Bond Graph {#bond-graph}
<!-- aliases: bond graphs, bond-graph -->
A diagram of a physical system as elements (stores, resistances, reactions, sources) joined by bonds that carry energy, through 0- and 1-junctions. CellDL modules are drawn as bond graphs; see [Drawing CellDL Modules](../guides/drawing-celldl-modules.md).

### Boundary Condition {#boundary-condition}
<!-- aliases: boundary, boundary conditions, boundary_condition -->
A variable another instance supplies through a port connection (**boundary** in the Instance Editor's Type column). The value you enter is used only when no connection supplies it.

### Category {#category}
<!-- aliases: categories, key, keys -->
A user-assigned colour that groups instances. Set it in the Context Sidebar's **Properties** tab; to add your own categories, choose **New from this theme** there.

### CellDL {#celldl}
<!-- aliases: celldl diagram, celldl module, celldl modules -->
A diagram format for bond graphs, drawn in the Instance Editor's **CellDL (beta)** tab and converted to CellML. CellDL is in beta: things may change, and diagrams saved now should open in later versions but aren't guaranteed to. See [Drawing CellDL Modules](../guides/drawing-celldl-modules.md).

### Cellular Units {#cellular-units}
<!-- aliases: cellular, cellular unit system -->
The unit system new CellDL modules use by default: amounts in fmol and volumes in pL, so cell-sized values are near 1. See [Unit Systems](../guides/drawing-celldl-modules.md#unit-systems).

### CellML {#cellml}
An XML-based markup language for describing mathematical models.

### Circulatory Autogen {#circulatory-autogen}
A Python tool that builds system models from CellML modules and identifies their parameters.

### COMBINE Archive {#combine-archive}
<!-- aliases: omex, omex archive, combine archives -->
A `.omex` zip bundling a model, how to simulate it ([SED-ML](#sedml)) and related files. "COMBINE archive" and "OMEX archive" mean the same thing. See [Supported File Formats](./file-types.md#combine-archive).

### Component {#component}
<!-- aliases: components -->
The named CellML block of variables and equations behind a module. Instances of one module start with the same math, but each has its own name, values and ports; the Instance Editor's **Apply math changes to all N instances** copies a math edit to the others.

### Connection {#connection}
<!-- aliases: edge, link -->
An arrow between two instances that holds their port couplings.

### Constant {#constant}
<!-- aliases: constants -->
A parameter whose value you set for one instance only (**constant** in the Type column).

### Coupling {#coupling}
<!-- aliases: couplings -->
Two ports joined by a connection; their variables pair by position and become one shared variable on export. See [Port Logic](./valid-port-configurations.md#variable-pairing).

### CUFLynx {#cuflynx}
A companion tool for calibrating models against data with protocols and parameter ranges. **Export ▸ CUFLynx** writes a COMBINE archive for it.

### Experiment {#experiment}
<!-- aliases: experiments -->
One run within a protocol, with its own inputs and recorded outputs.

### Flattened CellML {#flattened-cellml}
<!-- aliases: flattened -->
The whole model as one CellML 2.0 file that imports nothing: each instance becomes a component, joined by its couplings. Written by **Export ▸ CellML**.

### Ghost Node {#ghost-node}
<!-- aliases: ghost, ghost-nodes -->
A Macro Builder placeholder for an instance in the next copy, used to chain copies. See [Ghost Nodes](./ghost-nodes.md).

### Global Constant {#global-constant}
<!-- aliases: global, global constants, global parameter, global parameters -->
A parameter with one value shared by name across every instance (**global** in the Type column). Edit it in the Context Sidebar's **Global parameters** tab.

### Glyph {#glyph}
<!-- aliases: glyphs, cartoon, cartoons, glyph library -->
The cartoon a membrane protein is drawn with in the physiology view. Glyphs come from glyph libraries; see [Cartoons](../guides/physiology-view.md#glyphs).

### Handle {#port-node}
<!-- aliases: port-node, port-nodes, handle, handles -->
A dot on an instance's edge where connection arrows attach. Handles carry no variables; which variables an arrow shares is set by its [ports](#port).

### Inspection Module {#inspection-module}
<!-- aliases: inspection-modules -->
A user-created read-out that sums chosen variables with the same units.

### Instance {#instance}
<!-- aliases: instances -->
A module placed in the workspace, with its own name and parameters.

### Instance Array {#instance-array}
A Circulatory Autogen CSV listing each instance, its module type and connected instances.

### Macro {#macro}
<!-- aliases: macros -->
A segment built in the Macro Builder and placed as repeated copies. See the [Macro Builder Guide](../guides/macro-build-guide.md).

### Module {#module}
<!-- aliases: modules -->
A reusable CellML component representing a physiological subsystem.

### Module Configurations {#module-configurations}
<!-- aliases: module configuration, module-configuration, config -->
A Circulatory Autogen preset of a module's ports and variable types, named `module_type - module_subtype` in Available Modules. A placed instance gets that preset's ports. See [Supported File Formats](./file-types.md#module-configuration).

### Module Library {#library}
<!-- aliases: module-list, library, available-modules -->
The panel listing the modules you can place (titled **Available Modules** in the workspace).

### Multiport {#multiport}
<!-- aliases: multiports -->
A port that takes several connections. Each variable is True (shared with every neighbour), Sum (the sum of every neighbour's paired variable) or Multiply (the neighbour receives it times a factor). See [Port Logic](./valid-port-configurations.md#multiports).

### OpenCOR {#opencor}
<!-- aliases: web opencor -->
A CellML modelling and simulation tool; [Web OpenCOR](https://opencor.ws/app/) runs it in the browser.

### Physiology View {#physiology-view}
<!-- aliases: physiological view, bio view -->
The workspace drawn as cells, membranes, proteins and compartments. Where an instance sits there is its place for [annotation](#annotation) coupling. See [The Physiology View](../guides/physiology-view.md).

### Port {#port}
<!-- aliases: ports, port-option, port-options -->
A labelled set of variables an instance shares with connected instances.

### Port Label {#port-label}
<!-- aliases: port-labels, vessel-type -->
A port's name. Ports couple only when labels match. [Annotated](#annotation) ports have no label and couple by meaning.

### Port Type {#port-type}
<!-- aliases: port-types -->
A port's direction: Input (I), Output (O) or General (G, no direction). It sets which ports may couple, not which instance computes a variable.

### Protocol {#protocol}
<!-- aliases: protocols, obs_data -->
A sequence of experiments, stored in `obs_data.json`, that set parameters and record outputs.

### Reservoir {#reservoir}
<!-- aliases: reservoirs, hold summed flows at 0 -->
An annotated instance whose summed flows are held at 0, such as a lumen or blood, so the model's flows don't change it. See [Hold Summed Flows at 0](../guides/annotation-coupling.md#hold-at-zero).

### SED-ML {#sedml}
An XML format describing how to run and plot a simulation, exportable with the CellML model.

### Sidecar {#sidecar}
<!-- aliases: sidecars, module sidecar, module annotations -->
A Turtle file annotating one module math's variables. See [Annotate in the Instance Editor](../guides/annotation-coupling.md#annotations-tab).

### Species Mode {#species-mode}
<!-- aliases: species overlay -->
A physiology view overlay showing each annotated species where it occurs and its paths through proteins. See [Species Mode](../guides/physiology-view.md#species-mode).

### Steady State {#steady-state}
<!-- aliases: steady-state -->
A model with no differential equations, solved once rather than over the VoI. See [Reading the Status Line](../guides/simulating-your-model.md#status-line).

### Sweep {#sweep}
<!-- aliases: sweeps, parameter sweep -->
A simulation repeated over a range of one parameter's values; an optional second "family" parameter draws one curve per value.

### Template {#template}
<!-- aliases: templates, physiology template, site, sites -->
A ready-made layout of cells and compartments in the physiology view, with sites to drop modules on. See [Templates](../guides/physiology-view.md#templates).

### Tracked Run {#tracked-run}
<!-- aliases: tracked runs, track -->
A run whose lines stay on the charts, dashed, for comparison with later runs.

### Unit System {#unit-system}
<!-- aliases: unit systems -->
The units a CellDL module's CellML is built in: **Cellular (fmol, pL)** or **SI (mol, L)**. Set per module in its Parameters tab; changing it rescales the module's values on save. See [Unit Systems](../guides/drawing-celldl-modules.md#unit-systems).

### Variable (Type) {#variable-type}
<!-- aliases: computed variable -->
A variable the module's equations compute, such as a state variable (**variable** in the Type column). It has no value cell and its type can't be changed.

### VoI {#voi}
<!-- aliases: variable of integration -->
The variable of integration a model is solved over; time is one possible VoI.

### Workspace {#workspace}
<!-- aliases: workbench -->
The canvas where you place and connect instances; saved as a workspace JSON file.
