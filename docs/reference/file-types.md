# Supported File Formats

| File | Extension | Used for |
| :--- | :--- | :--- |
| [CellML module / units](#cellml-files) | `.cellml` | Module math and units |
| [Parameters](#parameter-file) | `.csv` | Parameter values |
| [Module configuration](#module-configuration) | `.json` | CA module ports and variables |
| [Instance array](#instance-array) | `.csv` | CA network topology |
| [params_for_id](#params_for_idcsv) | `.csv` | Parameter slider ranges |
| [Workspace](#workspace-file) | `.json` | A saved PhLynx session |
| [COMBINE archive](#combine-archive) | `.omex` | Model and simulation |
| [Annotations](#annotation-files) | `.ttl`, `.rdf` | Module sidecars and instance ApiCoords |
| [CA export](../guides/use-with-circulatory-autogen.md#output) | `.zip` | A Circulatory Autogen model |

## CellML files {#cellml-files}

A module file holds module math ([CellML Module Format](./cellml-module-format.md)); a units file holds units ([CellML Units File](./cellml-units-file.md)). **Export ▸ CellML** writes the model as one flattened file; **CellML (selection)** writes only the selected instances.

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

Loading never changes a variable's type. Rows starting with `#` are ignored; values for computed variables are skipped.

## Workspace file {#workspace-file}

Written by **Save workspace** (floppy-disk icon, Ctrl/Cmd+S), opened by **Load workspace** (folder icon). Holds the whole session: graph, library, simulation settings, plots and protocol. Older files are upgraded on load.

## COMBINE archive {#combine-archive}

Opened with **Import ▸ COMBINE Archive** (`.omex` or `.zip`); written by **Export ▸ OpenCOR**, **CUFLynx** or **OpenCOR (selection)**. Holds the flattened CellML, `document.sedml`, `flow-snapshot.json` (the PhLynx graph), `simulation.json` (plots and sliders), [`params_for_id.csv`](#params_for_idcsv) and any extra files it was imported with.

If the library already holds a component with the same file and name but different math, importing warns **Math Mismatch** and the instance uses the library's version, so the archive's edits to that component are not kept. Built-in components are always in the library, so to carry edits to one in an archive, give the edited component a new **Component** name in the Instance Editor before exporting.

## Annotation files {#annotation-files}

Opened with **Import ▸ Annotations**: module sidecars (`.ttl`) and one instance ApiCoord file (`.ttl` or `.rdf`). Saved with the workspace, and written into a COMBINE archive (sidecars under `annotations/`, the ApiCoord file as imported, and a combined `annotations.ttl`). See [Coupling with Annotations](../guides/annotation-coupling.md) and the [Annotation Vocabulary](./annotation-vocabulary.md).

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

- Drop `.cellml` or `.omex` files on the canvas to import them.
- A link with `?open=workspace_json#<base64 JSON>` or `?open=omex#<base64 OMEX>` loads a workspace or archive on startup.
