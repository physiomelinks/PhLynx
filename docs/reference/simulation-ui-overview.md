# Simulation UI Reference

Every Simulation panel control. For a walkthrough, see [Simulating Your Model](../guides/simulating-your-model.md).

## Toolbar {#toolbar}

| Button (tooltip) | Purpose |
| :--- | :--- |
| **Run / Stop** (runner / square) | Runs or stops (F9). The tooltip says what runs, e.g. **Simulate the whole model**. A dot means results are out of date. |
| Scope switch | **Whole model** or **Selection** (sidebar) / **This instance** (Plot tab). Its handle shows the scope (network or box icon), and its tooltip names it. |
| Run modes: **Time course** (chart-line icon), **Protocol** (checklist icon), **Sweep** (three-curves icon) | What Run runs. Choosing one runs it. A mode that isn't set up yet is greyed out, and its tooltip says how to set it up. See [Running Protocols](../guides/running-protocols.md) and [Sweeping a Parameter](../guides/simulating-your-model.md#sweeping-a-parameter). |
| **Add this plot to the workspace's plots** (send icon) | Plot tab only. See [Plotting from the Instance Editor](../guides/simulating-your-model.md#plotting-from-the-math). |
| **Track this run** (bookmark icon) | See [Tracked Runs](#tracked-runs). |
| **Float over the canvas** (window icon) | Sidebar only. Opens the [floating viewer](#floating-viewer). |
| **Edit protocol** (pen-to-square icon) | Opens the protocol editor (**Edit obs_data**). |
| **Simulation settings** (cog icon) | Sidebar and Plot tab. Opens [Simulation Settings](#simulation-settings) on Solver. |

The **status line** under the toolbar says what ran, or why nothing did (*Can’t simulate yet: N problems*). When it shows a down arrow, click it to list the problems, warnings or solver messages. See [Reading the Status Line](../guides/simulating-your-model.md#status-line).

## Controls {#controls}

Views: **Plots**, **Sliders**, **Sweep**, **Runs**. Search matches every typed word in an `instance/variable` path.

### Plots {#plots}

- Search to add a variable to the chosen plot. A plot holds one unit; other units go to a matching or new plot.
- **Add plot**; ⋯ menu: **Rename**, **Move up**, **Move down**, **Remove plot**.
- **Phase plots:** ⋯ ▸ **Plot against a variable…**; **Plot against time** returns to the VoI, whatever it is.
- **Zoom:** drag in, double-click out. Charts zoom together; hold Shift for one.

### Sliders {#sliders}

- **Add slider**. Moving one reruns the model.
- **Sweep** (three-curves icon) on a slider sweeps its parameter across the slider's range and switches Run to **Sweep**. With a sweep already set, it offers **A curve for each value of** the parameter (the range's ends and middle) or **Sweep it instead**.
- ⋯ menu: **Back to the model's value**, **Apply this value to the model**, **Edit range…**, **Remove slider**.
- **swept** marks the swept parameter. Sliders are off during a protocol.

### Sweep {#sweep}

**Sweep a parameter**: a constant, global constant, or boundary condition nothing supplies in the scope Play runs next (a connected one can be swept when its instance runs on its own). Results plot against it. The info icon explains sweeps and their exports.

- **From / To / Points:** 2 to 1000 points.
- ⋯ ▸ **Add a curve for each value of…** a second parameter (up to 8 values; 2000 runs max). ⋯ also has **Change parameter…** and **Stop sweeping**.
- **Reading** of each time course (shown for ODE models only): **End** (default), **Min**, **Max** or **Peak** (the value furthest from 0).
- Shows the run count and a time estimate; warns above 200 time courses.
- The SED-ML download is off while sweeping. Other exports run the model once, at the parameter's own value.

### Tracked Runs {#tracked-runs}

- Up to 5. Not for protocol runs or sweeps with curves. Cleared when the scope or the run type changes (time course, <GlossaryLink term="steady-state" label="steady state"/>, another sweep).
- In **Runs**: rename, hide or remove runs; hide the live run.

## Simulation Page {#simulation-page}

![The /simulation page](../assets/images/simulation-page.png){.align-center width="800px"}

- Open it from **Simulation** in the top navigation; **Workspace** goes back.
- Runs the whole model.
- Its action bar has **Run**, the [run modes](#toolbar), **Track this run**, **Edit protocol** and **Export** (the [downloads](#downloads)).
- **Hide controls** (tornado icon, top left of the controls) closes the controls panel, and the same button, now **Show controls** (hamburger icon), opens it again; drag its edge to resize it. Its folding **Simulation settings** section holds the [Solver tab's](#simulation-settings) fields (the first is **Starts at**); changes there apply as you make them.

## Floating Viewer {#floating-viewer}

One plot at a time (picker, or **New plot**), with **Edit this plot's variables**, scope, Play/Stop, **Sliders**, **Track this run** and **Back to the Simulation tab**.

## Simulation Settings {#simulation-settings}

From the cog (opens on **Solver**) or the main toolbar's **Configure simulation settings** (opens on **Plots**). Tabs: **Plots**, **Sliders & sweep**, **Solver**. Changes apply on **Save**. Steps: [Setting the Run Length](../guides/simulating-your-model.md#run-length).

| Solver tab field | Meaning |
| :--- | :--- |
| **Simulation starts at** | Where the solver starts, from the initial values. Times are in the VoI's units, though the dialog says *In seconds*. |
| **Plots start at** | Results before this are solved but not kept, so the model can settle first. |
| **Ends at** | Where the run ends. |
| **Point interval** | The spacing between the points kept. |
| **Solver** | CVODE (default), Forward Euler, Heun, Second-order Runge–Kutta or Fourth-order Runge–Kutta. |
| **Relative Tolerance**, **Absolute Tolerance**, **Maximum Steps**, **Maximum Step** | CVODE only: the error allowed relative to each variable's size, and the error allowed however small a variable gets (lower it for variables that stay near zero); the steps allowed between two output points; the largest step (0 for no limit). |
| **Time Step** | Fixed-step solvers only: the step size. |

Number fields take decimals or scientific notation, so a very small value such as an absolute tolerance of `1e-20` can be typed as it is written. A field that isn’t a number yet is marked in red and isn’t saved.

Web OpenCOR doesn’t support a later **Plots start at**, so an export may not match.

## Downloads {#downloads}

Only on the simulation page, from **Export** (export icon) in the action bar. The button repeats the last download picked; the arrow beside it lists them all:

- **CSV:** every plotted series.
- **PNG:** the charts as one image (not for steady state).
- **SED-ML:** zip of the run, its plots and the CellML model.

A download that isn't available is greyed out, and the button's tooltip says why.
