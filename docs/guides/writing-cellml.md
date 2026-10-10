# Writing CellML Guide

The modules used in PhLynx are written in <GlossaryLink term="CellML"/>, a structured text format for storing and sharing computer-based mathematical models. CellML facilitates module coupling due to its emphasis on unit consistency. 

PhLynx contains a simple text-based editor for users to modify modules directly within the application. The following document provides a primer on how to write and edit CellML text in PhLynx.

## CellML Text

Native CellML is based on XML, a format that is excellent for machines but verbose and difficult for humans to read. To address this, IDEs such as OpenCOR—and now PhLynx—use an abstracted format called **CellML Text**. This allows you to write mathematical models using familiar, code-like syntax (e.g., `a = b + c;`) which the software automatically converts into the underlying XML.

## Using the CellML Editor

To open the editor, click the **CellML** icon button on the right of any module node in the workspace.

![Labelled module node](../assets/images/labelled-module.png){.align-center width="600px"}

This opens the **CellML Text Editor** dialog.

![CellML text editor](../assets/images/cellml-text-edit.png){.align-center width="600px"}

There are three main components to this dialog:
1.  **Header:** Displays the name of the module being edited and its source file.
2.  **Equation Viewport:** A dynamic preview pane that renders the math equations visually when your cursor is active on a line of code.
3.  **Text Editor:** The main dark window where you write your code.

> [!TIP]
> **Saving Changes:** 
>* If you are editing a **Custom Module**, clicking `Save` updates the file directly.
> * If you are editing a **Library Module**, you must click `Save As`. This creates a copy of the module in the `User_Modules.cellml` container in your Module List, leaving the original library version untouched.

## Writing CellML Text

For those experienced with the text editor of legacy OpenCOR, PhLynx will feel familiar, though there are differences. PhLynx is built on **CellML 2.0**, which simplifies connection logic (concepts like "input" vs "public interface" directionality are unified). 

### Units

Typically, custom units are declared at the top of a CellML file. However, PhLynx centralises unit definitions for the most commonly used biological units to keep module files clean. 

If your module requires a specific unit not found in the PhLynx internal library, you must import a custom units file (see [CellML Specification](https://www.cellml.org/specifications/archive/20030930/units.pdf)).

### Module Structure

Modules in PhLynx follow a standard nesting structure:

```bash
def model [model_name] as
    def comp [module_name] as
        
        [Your Variable Declarations]

        [Your Equations]

    enddef;
enddef;
```

> [!NOTE] 
> Currently, the def model and def comp wrappers are required. Future versions of PhLynx may remove this requirement to simplify the view further.

### Declaring Variables

Before using a variable in an equation, you must declare it. A declaration includes the variable's name, its units, and optional properties like an initial value or interface status.

**Syntax:**

```bash
var [name]: [units] {init: [value], interface: [public]};
```

**Examples:**

```bash
// A constant internal parameter
var R: J_s_per_m6 {init: 8.5}; 

// A variable exposed to other modules (a Port)
var u_e: J_per_m3 {init: 150, interface: public};

// A standard variable calculated within this module
var flow: m3_per_s;
```

**Key Components:**
* `var`: The keyword to start a declaration.
* `init: [value]`: Sets the starting value (required for constants and state variables).
* `interface: public`: Exposes this variable as a Port on the module node, allowing it to be connected to other modules.

### Writing Equations

Equations in CellML Text are written using standard mathematical notation. All equations must end with a semicolon `;`.

#### Algebraic Expressions
You can use standard arithmetic operators (`+`, `-`, `*`, `/`) and common mathematical functions (`sin`, `cos`, `exp`, `log`, `sqrt`, `power`).

**Example**:
```bash
// Ohm's law for fluid flow
flow = (u_in - u_out) / R;

// Calculating area from a radius variable
area = 3.14159 * power(radius, 2);
```
> [!WARNING] 
> Ensure that the units on the Left Hand Side (LHS) of the equation match the calculated units on the Right Hand Side (RHS). CellML enforces dimensional consistency.

#### Ordinary Differential Equations (ODEs)

ODEs describe how a variable changes over time. To define a differential equation, you must first declare a variable representing time.

**1. Declare Time Variable:**

```bash
var t: second;
```

**2. Define the ODE:**

Use the `ode(variable, independent_variable)` syntax.

**Example:**
```bash
// Define the change in volume (V) over time (t)
ode(V, t) = flow_in - flow_out;
```

In this example, PhLynx interprets `ode(V, t)` as the derivative dV/dt. The solver will then integrate this variable over the course of the simulation.

The second argument of `ode` is the **variable of integration** (VoI), whatever it is called (`t`, `time`, `tau`) and whatever it measures. It is usually time, but an ODE can integrate over a distance in metres or anything else. When the model is exported, every module's VoI is connected to one variable in the `environment` component, named and measured like the first ODE's VoI: for example `environment/time` in seconds, or `environment/x` in metres. Any other variable is just a variable, even one named `t`, so you can still use `t` for something else, such as a thickness, and give it a value in the parameter table.

A module without ODEs that still needs time, such as a stimulus that switches on and off, can declare a variable named `t` or `time` in time units (for example `second`). PhLynx then connects that variable to the model's VoI too, when their units are compatible.

#### Algebraic Systems

A model doesn't need any ODEs. If none of its modules has one, it is an **algebraic system**: it has no VoI, and its equations are solved once. Running it in the Simulation tab lists the value of each plotted variable instead of drawing a chart. An OMEX export describes it as a steady-state simulation.

**Example:**
```bash
// A lever: the load moved for a given effort
load = effort * arm_ratio;
```

To see how an algebraic system responds over a range, **sweep** one of its parameters. In **Simulation Settings → Sweep**, choose a parameter, a global constant, or a boundary condition that holds its own value. Then set the range (**From**, **To**) and the number of **Points**. Each run solves the model once per value, and every plot is drawn against the swept parameter. For example, sweep a channel's membrane voltage to plot its current–voltage curve. Sliders still apply, so moving one redraws the whole curve. Web OpenCOR can't run sweeps, so an OMEX export solves the model once, at the parameter's own value.

#### Plotting One Variable Against Another

By default a plot is drawn against time, or against the swept parameter of an algebraic system. To plot against another variable from the same run instead, such as a phase plot of `w` against `v`, open the plot's **⋯** menu, choose **Plot against a variable…** and pick the variable. **Plot against time** in the same menu undoes it. The CSV download includes the variable a plot is drawn against, and an OMEX export draws the plot the same way in web OpenCOR.

#### Conditional Logic (Piecewise)

CellML uses a `sel` (select) block to handle conditional logic, such as a valve opening or closing based on pressure.

**Syntax:**
```bash
x = sel
    case [condition]: [value_if_true];
    otherwise: [value_if_false];
endsel;
```

**Example:**
```bash
// If pressure is greater than 100, flow is restricted
flow = sel
    case pressure > 100.0: 0.0;
    otherwise: (pressure - 100.0) / R;
endsel;
```
