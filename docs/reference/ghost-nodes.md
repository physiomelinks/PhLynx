# Ghost Nodes

A **ghost node** is a [Macro Builder](../guides/macro-build-guide.md) placeholder for an instance in the *next* copy of a macro. When copies are generated, a connection into the ghost becomes a connection from each copy into that instance in the following copy. The ghost itself is not generated.

1. Drag the **ghost** module from the Macro Builder's Module Library onto the canvas.
2. In **Configure Ghost Node**, pick the instance to mimic and click **Create Ghost**. If the canvas has only one instance, it is picked for you.

The ghost is titled **Next: *name*** and mirrors the target's handles as you edit it.
