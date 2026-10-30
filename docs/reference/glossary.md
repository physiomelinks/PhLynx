# Glossary

### Annotation {#annotation}
<!-- aliases: annotations, annotated, annotated port, annotated ports -->
What a variable means, in standard ontology terms: its property, species and location. Annotated ports couple by meaning instead of by label. See [Coupling with Annotations](../guides/annotation-coupling.md).

### ApiCoord {#apicoord}
<!-- aliases: apicoords, apicoord file, instance apicoords -->
An ApiNATOMY coordinate: where in the body an instance sits (a layer, cell, membrane, membrane protein or vessel). An instance file of ApiCoords places, names and binds instances on **Import ▸ Annotations**. See [Annotation Vocabulary](./annotation-vocabulary.md#apicoord-files).

### Basicport {#basicport}
<!-- aliases: basicports -->
A port that takes only one connection.

### Boundary Condition {#boundary-condition}
<!-- aliases: boundary, boundary conditions, boundary_condition -->
A variable another instance supplies through a port connection (**boundary** in the Instance Editor's Type column). The value you enter is used only when no connection supplies it.

### Category {#category}
<!-- aliases: categories, key, keys -->
A user-assigned colour that groups instances. Set it in the Context Sidebar's **Properties** tab; to add your own categories, choose **New from this theme** there.

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
<!-- aliases: reservoirs, held constant -->
An annotated instance held constant, such as a lumen or blood: its summed fluxes are fixed at 0. See [Reservoirs](../guides/annotation-coupling.md#reservoirs).

### SED-ML {#sedml}
An XML format describing how to run and plot a simulation, exportable with the CellML model.

### Sidecar {#sidecar}
<!-- aliases: sidecars, module sidecar, module annotations -->
A Turtle file annotating one module math's variables. See [Annotate a Module with a Sidecar](../guides/annotation-coupling.md#write-a-sidecar).

### Steady State {#steady-state}
<!-- aliases: steady-state -->
A model with no differential equations, solved once rather than over the VoI. See [Reading the Status Line](../guides/simulating-your-model.md#status-line).

### Suggested Connection {#suggested-connection}
<!-- aliases: suggestion, suggestions, suggested connections -->
A dashed connection the annotations support, not yet made: **Accept** or **Dismiss** it. See [Suggested Connections](../guides/annotation-coupling.md#suggestions).

### Sweep {#sweep}
<!-- aliases: sweeps, parameter sweep -->
A simulation repeated over a range of one parameter's values; an optional second "family" parameter draws one curve per value.

### Tracked Run {#tracked-run}
<!-- aliases: tracked runs, track -->
A run whose lines stay on the charts, dashed, for comparison with later runs.

### Variable (Type) {#variable-type}
<!-- aliases: computed variable -->
A variable the module's equations compute, such as a state variable (**variable** in the Type column). It has no value cell and its type can't be changed.

### VoI {#voi}
<!-- aliases: variable of integration -->
The variable of integration a model is solved over; time is one possible VoI.

### Workspace {#workspace}
<!-- aliases: workbench -->
The canvas where you place and connect instances; saved as a workspace JSON file.
