# What's New in PhLynx 0.7

PhLynx 0.7 adds a whole new way to look at your model, makes your work harder to lose, and exports models that keep their modules. These are the highlights; every change is listed in the [Changelog](../reference/change-log.md).

## The Physiology View {#physiology-view}

Alongside the diagram there is now a **Physiology** view: your model drawn as the biology it describes, with compartments, cells, membranes and the proteins that move things between them.

- **Build it from pieces.** Five pieces (compartment, membrane, tube, fold and process zone) build any arrangement, and you can move and resize them once placed. Six built-in templates start you off with common ones, and you can keep your own under **My Templates**.
- **Drop modules where they belong.** Drag a module onto a compartment, a cell or a slot on its membrane, and PhLynx couples it to its neighbours by where it sits.
- **See what flows where.** Species mode shows each compartment's species and the paths they take through the proteins.
- **Draw it your way.** Proteins are drawn from a glyph library that you can extend, now with new intracellular glyphs and a generic process glyph.

The physiology view is in beta. See [The Physiology View](../guides/physiology-view.md).

## Annotations {#annotations}

The Instance Editor has a new **Annotations** tab for saying what each variable means, with an ontology lookup to find the right term. Annotated ports can then be coupled by meaning and by placement, not just by name. Annotations travel with your modules into workspace files and COMBINE archives.

See [Coupling with Annotations](../guides/annotation-coupling.md).

## Keeping Your Work Safe {#keeping-your-work-safe}

- **Recovery of unsaved work.** A few seconds after each change, PhLynx keeps a compressed copy of unsaved work in your browser. If a tab is closed or crashes before you save, PhLynx offers to restore it the next time you open PhLynx. You can turn this off in [Settings](../reference/ui-overview.md#settings).
- **A warning before you lose changes.** Reloading or closing the tab with unsaved work asks first.
- **Clearer undo.** Undo and redo now name the step they will take.

## Modular Exports {#modular-exports}

- **Exports keep their modules.** CellML exports can now keep each module as its own file, imported by the main model, with the units they need bundled alongside. Exported COMBINE archives run that modular model directly.
- **Modules that use imports.** CellML modules that import other files can now be loaded and used.
- **Units files in COMBINE archives.** Units files are carried in OMEX archives and registered again when the archive is opened.
- **More ways in and out.** Import parameter sets and Circulatory Autogen JSON module arrays, and export nested parameter JSON and CA module arrays. See [Supported File Formats](../reference/file-types.md).

## Simulating {#simulating}

- **Run modes always in view.** **Time course**, **Protocol** and **Sweep** sit beside the new Run button (a runner) wherever you simulate. A mode that isn't set up yet is greyed out, and its tooltip says how to set it up.
- **Sweep from a slider.** A slider's sweep button sweeps its parameter across the slider's range, or adds a curve for each of a few of its values. See [Sweeping from a Slider](../guides/simulating-your-model.md#sweep-from-slider).
- **Keep the editor's plot.** The Instance Editor's Plot tab can add its plot to the workspace's plots. It now always plots the variable you click, with less in its toolbar.
- **A tidier simulation page.** An action bar like the workspace's, with a single **Export** button for CSV, PNG and SED-ML.

## Building Models {#building-models}

- **Tidier connections.** Arrows can be reshaped by dragging their segments, or routed around the instances in their way. See [Routing connections](../reference/ui-overview.md#routing).
- **A Build tab.** The build palette has moved into the library as a **Build** tab, and **New Module** opens the editor and couples the new module as you save its ports.
- **Edits that stay where you make them.** Editing an instance's math changes only that instance unless you tick **Apply to all**, and changing its ports or type asks whether to update the module or make a new one.

## Simulation {#simulation}

- **Separate tolerances.** The simulation tolerance is now split into relative and absolute tolerances, so variables that stay near zero can be solved accurately. See the [Simulation UI Reference](../reference/simulation-ui-overview.md).
- **A tidier floating viewer**, with its own header and menu.

## Your PhLynx {#your-phlynx}

- **Choose your toolbar.** Show or hide each toolbar button in [Settings](../reference/ui-overview.md#settings).
- **Themes travel with your work.** A workspace's node colour theme is saved with it.
- **Light and dark** is now a switch in the top bar, on every page.
- **Notices.** The bell beside **About** shows announcements from the PhLynx team, such as upcoming changes to supported file formats, and counts the ones you haven't seen yet.
