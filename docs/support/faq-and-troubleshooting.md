# FAQs & Troubleshooting

**Where are exported and saved files written?**
Chrome and Edge ask where to save. Other browsers save to your default Downloads folder.

**Simulation is unavailable.**
The simulator needs a secure (https or localhost) connection and service workers, so it may not run in a private window. The Simulation tab shows the reason (also on the play button's tooltip). If it says the simulator isn't ready yet, save your workspace first (Ctrl/Cmd+S), then reload the page and load the workspace again: PhLynx doesn't save automatically, so reloading clears anything unsaved.

**The run fails, or says *Can't simulate yet*.**
Click the status line under the Simulation toolbar to list the problems; see [Reading the Status Line](../guides/simulating-your-model.md#status-line). The usual cause is a parameter with no value (*"soma_SN.Cm" needs a value*): fill it in on that instance's **Parameters** tab ([Set parameter values and types](../guides/build-custom-module.md#set-parameters)). A boundary condition that nothing supplies and that has no value of its own is set to 0, with a warning.

**A node shows a warning triangle.**
At least one constant or global constant has no value, and the model won't simulate or export to CellML until it has. See [Instance nodes](../reference/ui-overview.md#module-nodes) for the fix.

**The plots are empty.**
If the plot area reads *Plots appear here after a run*, press **Play** (F9). If it asks you to *Add variables to a plot*, nothing is plotted yet: in the **Plots** view below the plots, type in **Add a variable…** and pick one; see [Choosing What to Plot](../guides/simulating-your-model.md#choosing-what-to-plot).

**Import or Export is disabled.**
Hover the button for the reason. Both wait for the CellML library to load; Export is also disabled when the workspace is empty, or when a "(selection)" mode is chosen with nothing selected.

**An instance array import fails.**
The error lists any missing columns; see [Supported File Formats](../reference/file-types.md#instance-array). If the array uses module types that aren't loaded, the Import dialog lists the missing files. Click **Connect Folder**, or drop or select several files at once.

**Parameter values aren't applied after import.**
Values are applied only to instances already on the Workspace, so place and name them before importing; otherwise PhLynx says **Parameters Not Loaded**. Rows are named `<variable>_<instance_name>` (e.g. `R_aorta`), and the file needs the columns listed in [Supported File Formats](../reference/file-types.md#parameter-file). Rows for computed variables are skipped, with a warning.

**A port coupling won't connect in the Connections dialog.**
Ports must have the same label and compatible types. See [Port Logic](../reference/valid-port-configurations.md#connections-dialog). On the canvas, only one arrow runs in each direction between two instances, so drawing a second asks **Connection already exists**. To couple more variables, double-click the existing arrow instead; see [Connections](../reference/ui-overview.md#connections).

**A CellML file won't import (CellML Load Error).**
The message gives only the number of issues; the issues themselves are listed in the browser's developer console. Check the file in another CellML tool, such as [OpenCOR](https://opencor.ws/).

**Is CellDL ready to use?**
CellDL is in beta: the editor and its format may still change, and diagrams saved now should open in later versions of PhLynx but aren't guaranteed to. Keep copies of diagrams you need. See [Drawing CellDL Modules](../guides/drawing-celldl-modules.md).

**The CellDL tab is locked.**
A CellML module can't become a diagram: CellDL modules start from the **new_module** template or an imported `.celldl` file. On the template, the tab locks once you edit the CellML text, the Math Editor or the Parameters tab; undo those edits to unlock it. CellDL isn't available in the desktop (Electron) build.

**A CellDL diagram won't save (Diagram Has Errors).**
Click the status line below the diagram to list the issues, then click an element's name to go to it; see [Live Conversion](../guides/drawing-celldl-modules.md#live-conversion). Transform nodes, and some templates on the plain Reaction tile, don't convert yet ([Known Limitations](../guides/drawing-celldl-modules.md#limitations)).

**I can't draw a bond between two CellDL elements.**
Bonds have a direction, and one drawn the wrong way is refused with a message saying which way to drag, e.g. from a junction to a store. See [Drawing](../guides/drawing-celldl-modules.md#drawing).

**I can't type a value in the CellDL Properties panel.**
Values are set per instance in the **Parameters** tab; the Properties panel only shows them. A value marked **Set by** comes from a connection, so it is read-only.

Still stuck? See [Feedback & Support](./support.md).
