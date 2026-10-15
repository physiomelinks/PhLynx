# Port Logic

When you draw a connection, PhLynx **couples** each pair of ports that share a label and have compatible types. The couplings are stored on the connection and used on export.

## Port types {#port-types}

| Source port (arrow tail) | Couples with target port (arrow head) |
| :--- | :--- |
| **Output** (O) | Input, General |
| **General** (G) | Input, Output, General |
| **Input** (I) | General, in the [Connections dialog](#connections-dialog) only |

Input/Output are Circulatory Autogen's Entrance/Exit. A **Basicport** takes one connection; a [Multiport](#multiports) takes several.

A port's type only decides which ports may couple across an arrow, and whether Circulatory Autogen export lists it as an entrance or an exit. It doesn't decide which instance computes a variable: the math does.

## How variables pair {#variable-pairing}

A coupling joins its ports' variables **by position**: the first with the first, the second with the second. Names don't have to match, but the order does. Coupling soma_SN's `VI_port` (`V, I_out`) to axon_SN's `VI_port` (`V_in, I`) joins `V` to `V_in` and `I_out` to `I`.

In the exported CellML, each pair of plain variables is made equivalent: the two names become one shared variable. Multiport [Sum and Multiply](#multiports) variables add equations instead.

- If plain ports list different numbers of variables, only as many pairs as the shorter list has are joined; the extra variables are left unconnected.
- Ports with any Sum or Multiply variable need the same number of variables on both sides, or export fails.

## Ports that take several connections {#multiports}

Use a Multiport where one port meets several neighbours, such as a vessel junction.

1. Open the instance's **Ports** tab in the [Instance Editor](./ui-overview.md#instance-editor), or double-click a connection to open the [Connections dialog](#connections-dialog).
2. On the port's row, click the Basicport button (tooltip **Basicport: takes one connection**; in the Instance Editor it is in the **Mode** column) so its tooltip reads **Multiport: takes several connections**. Every variable starts as **True**.
3. Click a variable's chip to cycle it through **True**, **Sum** and **Multiply**; when a port has more variables than fit, the rest are under its **+N** chip. A Multiply chip shows its factor after the **×**, starting at 1; click the factor to type another.
4. Click **Apply** (Instance Editor) or **Done** (Connections dialog).

| Type | Chip key | Meaning | Typical use |
| :--- | :--- | :--- | :--- |
| **True** | Shared | A plain link, equivalent to the paired variable on every connection. The name comes from Circulatory Autogen's `multi_port: True`. | Pressure at a junction |
| **Sum** | Summed | This variable equals the sum, over every connection, of the neighbour's paired variable. With nothing connected it is 0, whatever its value. | Total flow into a junction |
| **Multiply** | Multiplied | The neighbour's paired variable receives this variable times the factor. | Scaling a flow, e.g. by the number of parallel vessels |

Export refuses a pair that is Sum on both ends or Multiply on both ends. A variable can sum through more than one of its instance's ports: every connected Sum port contributes to the same total.

## Connections dialog {#connections-dialog}

![Connections dialog](../assets/images/connections-dialog.png){.align-center width="800px"}

Double-click a connection to open **Connections**, where each port shows as Connected, Taken (by another connection) or Available. Drag between ports with the same label and compatible types to couple them, or drop onto **Add Port** to create a matching port. Click **Done** to save or **Cancel** to discard.

A Basicport takes one coupling. If you couple one that is already coupled, here or on another connection (Taken), PhLynx asks **Port already connected**:

- **Replace** removes the port's other coupling.
- **Swap** (offered when you drag an existing coupling to a new port) gives the other coupling the port you moved away from.
- **Cancel** leaves both as they were.

A Multiport used by another connection can still be coupled here, with no prompt.

> [!IMPORTANT]
> A connection with no matching ports shows no warning. Check its couplings here before exporting.
