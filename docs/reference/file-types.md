# Supported File Formats

| File | Extension | Used for |
| :--- | :--- | :--- |
| [CellML module / units](#cellml-files) | `.cellml` | Module math and units |
| [CellDL diagram](#celldl-files) (beta) | `.celldl` | A bond-graph module drawn as a diagram |
| [Parameters](#parameter-file) | `.json`, `.csv` | Parameter values |
| [Module configuration](#module-configuration) | `.json` | CA module ports and variables |
| [Instance array](#instance-array) | `.csv` | CA network topology |
| [params_for_id](#params_for_idcsv) | `.csv` | Parameter slider ranges |
| [Workspace](#workspace-file) | `.json` | A saved PhLynx session |
| [COMBINE archive](#combine-archive) | `.omex` | Model and simulation |
| [Module sidecar](#annotation-files) | `.ttl` | What a module's variables mean |
| [Physiology template](#template-files) | `.pieces.json` | Pieces to build the physiology view from |
| [Skin library](#skin-files) | `.skins.json` | How proteins, processes and compartments are drawn |
| [CA export](../guides/use-with-circulatory-autogen.md#output) | `.zip` | A Circulatory Autogen model |

## CellML files {#cellml-files}

A module file holds module math ([CellML Module Format](./cellml-module-format.md)); a units file holds units ([CellML Units File](./cellml-units-file.md)). **Export ▸ CellML** writes the model as one flattened file; **CellML (selection)** writes only the selected instances.

## CellDL files {#celldl-files}

A `.celldl` file is a bond-graph diagram: an SVG drawing with the model's BG-RDF description embedded. **Import ▸ CellDL Diagram** adds it as a module, which PhLynx converts to CellML; see [Drawing CellDL Modules](../guides/drawing-celldl-modules.md). CellDL is in beta, so the format may still change. The workspace file and COMBINE archives keep each module's diagram; CellML and Circulatory Autogen exports carry only the generated CellML.

## Parameter file {#parameter-file}

Parameter values in Circulatory Autogen format, loaded with **Import ▸ Parameters**:

| Column | Description |
| :--- | :--- |
| `variable_name` | `[parameter_name]_[instance_name]`, or `[parameter_name]` for a global constant. |
| `units` | The variable's units. |
| `value` | The value. |
| `data_reference` | Source, e.g. `[Author][Date][FirstWord]`. |

```csv
variable_name,units,value,data_reference
g_Na_soma_SN,microS,2.3,user_defined
Cm_soma_SN,picoF,30,Davis2021Transcriptomic
```

Loading never changes a variable's type. Rows starting with `#` are ignored; values for computed variables are skipped. For parameter sets in JSON, see [Parameter files](../guides/use-with-circulatory-autogen.md#parameter-files).

## Workspace file {#workspace-file}

Written by **Save workspace** (floppy-disk icon, Ctrl/Cmd+S), opened by **Load workspace** (folder icon). Holds the whole session: graph, library (with module sidecars), parameter sets, simulation settings, plots, protocol, and the physiology pieces and the skins it uses. Older files are upgraded on load.

## COMBINE archive {#combine-archive}

Opened with **Import ▸ COMBINE Archive** (`.omex` or `.zip`); written by **Export ▸ OpenCOR**, **CUFLynx** or **OpenCOR (selection)**. Holds the flattened CellML, `document.sedml`, `flow-snapshot.json` (the PhLynx graph), `simulation.json` (plots and sliders), [`params_for_id.csv`](#params_for_idcsv) and any extra files it was imported with.

If the library already holds a component with the same file and name but different math, importing warns **Math Mismatch** and the instance uses the library's version, so the archive's edits to that component are not kept. Built-in components are always in the library, so to carry edits to one in an archive, give the edited component a new **Component** name in the Instance Editor before exporting.

## Annotation files {#annotation-files}

A module sidecar is a Turtle (`.ttl`) file saying what each variable of one module math means. Import one, or export the module's, from the Instance Editor's [Annotations tab](../guides/annotation-coupling.md#annotations-tab). Sidecars are saved with the workspace, and written into a COMBINE archive under `annotations/`, with a combined `annotations.ttl` for the whole model. See the [Annotation Vocabulary](./annotation-vocabulary.md).

## Physiology view files

### Template files {#template-files}

A JSON file (format version 4) listing the pieces a part of the physiology view is built from: compartments, membranes, tubes, folds and process zones, each with sites modules are dropped on. Load one with **Load file…** in the Build tab or **Add Template ▸ Load Template File…** in the [physiology view](../guides/physiology-view.md#my-templates), and save the view's pieces with **Save Pieces As Template File…**. The format is described by `src/assets/bio_pieces/bio-pieces.schema.json` in the PhLynx repository. Files written for the earlier template format (`.template.json`) no longer load. Files over 1 MB are refused.

### Skin library files {#skin-files}

A JSON file of skins for the [physiology view](../guides/physiology-view.md#skins). Each skin says what it suits in `appliesTo` (`protein`, `process`, `cytosol`, `organelle`, `subcompartment`, `extracellular`, or a tube's joint: `conduit`, `gapJunction`, `bridge`, `diffusion`) and may list the ontology terms it stands for in `terms`, which put it first for a thing annotated with one. A skin is either:

- a symbol, for a protein, process or joint: a few shapes on a 64×48 canvas, painted with the view's colours, fitted into a joint as big as fits; or
- SVG artwork, for a compartment, in `svg`. Anything but drawing (scripts, links, styles, images) is removed when it is read.

Load one with **Skin Libraries ▸ Load Skin Library…** in the physiology view. The built-in library, `src/assets/bio_skins/builtin.skins.json`, is an example. Files over 1 MB are refused.

## Circulatory Autogen files

### Module configuration {#module-configuration}

A JSON array with one entry per module:

| Key | Description |
| :--- | :--- |
| `module_type`, `module_subtype` | As in the instance array. |
| `module_format` | Always `cellml`. |
| `component_file` | Source `.cellml` file name. |
| `component_type` | Component name in that file. |
| `entrance_ports`, `exit_ports` | Ports used when this instance is a connection's target / source. |
| `general_ports` | Non-directional ports. |
| `variables_and_units` | `[name, units, access, type]` per variable; `type` is `constant`, `global_constant`, `variable` or `boundary_condition`. |

Each port has a `port_type` (ports connect when these match), `variables`, and optionally `multi_port` (`True`, `Sum`, `Multiply` or a per-variable list); see [Port Logic](./valid-port-configurations.md#port-types).

### Instance array {#instance-array}

One row per instance. Required columns: `name`, `module_type`, `module_subtype`, `inp_instances` and `out_instances` (space-separated names of instances connected into / out of this one). Optional `x` and `y` columns set node positions. Any file name works.

```csv
name,module_subtype,module_type,inp_instances,out_instances
soma_SN,nn,soma_SN,,axon_SN
axon_SN,nn,axon_SN,soma_SN,var_SN
var_SN,nn,var_SN,axon_SN,
```

### params_for_id.csv {#params_for_idcsv}

`params_for_id.csv` ("parameters for identification") lists the parameters a CUFLynx or Circulatory Autogen calibration may vary, with their bounds. PhLynx reads it from an imported COMBINE archive as [sliders](./simulation-ui-overview.md#sliders) (**Simulation Settings ▸ Sliders & sweep**) and writes the current sliders back on OpenCOR or CUFLynx export.

| Column | Description |
| :--- | :--- |
| `vessel_name` | Instance name, or `global` for a global constant (CA calls instances vessels). |
| `param_name` | Parameter name. |
| `param_type` | Always `const`. |
| `min`, `max` | Slider range. |
| `name_for_plotting` | Display label. |

## Opening files {#opening-files}

- Drop `.cellml` or `.omex` files on the canvas to import them. Import `.celldl` files with **Import ▸ CellDL Diagram**.
- A link with `?open=workspace_json#<base64 JSON>` or `?open=omex#<base64 OMEX>` loads a workspace or archive on startup.
