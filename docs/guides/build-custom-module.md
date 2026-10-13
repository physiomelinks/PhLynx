# Using Custom Modules

Use your own CellML modules alongside the built-in ones. Custom modules work like library modules: place, connect and export them as usual.

## Create a module in PhLynx {#create-module}

1. **Place a blank module.** Right-click empty canvas and choose **Create Module**, or drag **new_module** from **Template Modules** in the <GlossaryLink term="module-list"/>.
2. **Open it.** Double-click the new node. In the header, type a name in **Instance** (unique on the canvas, e.g. `cell_1`) and in **Component** (the reusable module's name, e.g. `my_decay`).
3. **Write the equations** in **CellML Text** or the **Math Editor**; see [Writing CellML](./writing-cellml.md). Variables you use appear on the **Parameters** tab.
4. **Fill in the Parameters tab:** values, types and units; see [Set parameter values and types](#set-parameters).
5. **Add ports** on the **Ports** tab, so the module can share variables with others; see [Port definitions](../reference/ui-overview.md#port-definitions).
6. **Save.** Click **Save** (Ctrl/Cmd+Enter). If you left **Component** as `new_module`, PhLynx asks for a new name in **Save As New Component**, because the template can't be overwritten.

The component is now listed under **Template Modules** in Available Modules, so you can place more instances of it. It lives in the workspace: **Save workspace** (Ctrl/Cmd+S) to keep it, as PhLynx doesn't save automatically.

## Import a module file {#import-module}

1. Write a `.cellml` file in another tool; see [CellML Module Format](../reference/cellml-module-format.md).
2. Use Import ▸ **CellML File**, or drop one or more `.cellml` files on the Workspace. Components appear in Available Modules, and any `<units>` join the units library ([CellML Units File](../reference/cellml-units-file.md)).
3. Place instances, then set their parameters as below.

## Set parameter values and types {#set-parameters}

This applies to any instance, built-in or custom. Each column, type and problem chip is described under [Parameters tab](../reference/ui-overview.md#parameters-tab).

1. Double-click the instance, or click **Edit instance** (pencil icon), and open the **Parameters** tab.
2. Type a **Value** for each constant. Click the **N values required** chip above the table to list only the empty rows.
3. Check each row's **Type**. Use **constant** for a value that belongs to this instance, **global** for one value shared by every instance with a variable of that name (step 6), and **boundary** for an input that a connection supplies. Rows the equations compute are **variable**, and PhLynx sets that for you.
4. Give each state variable a starting value; see [Set a starting value](./writing-cellml.md#initial-values).
5. Click **Apply** to save and keep editing, or **Save** to save and close. The node's warning triangle goes once every constant and global constant has a value.
6. For a global constant, open **Global parameters** (globe icon) in the [Context Sidebar](../reference/ui-overview.md#context-sidebar). The variable is listed under **Global Constants**; changing its value there changes it for every instance that uses it.

To change several types at once, tick the rows' checkboxes, choose a type in the **N selected. Set type:** bar and click **Apply**. The **Instance parameters** tab (sliders icon) in the Context Sidebar edits the same values for the selected instance without opening the editor.

## Import values from a file {#import-values}

Use Import ▸ **Parameters** (`.csv`); see [Supported File Formats](../reference/file-types.md#parameter-file). Place and name your instances first: values are applied only to instances already on the Workspace, matched by `<variable>_<instance name>` (or the variable name alone for a global constant). If nothing matches, PhLynx shows **Parameters Not Loaded**. Loading never changes a variable's type.
