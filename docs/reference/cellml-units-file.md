# CellML Units File

Units come from the same import as modules: Import ▸ **CellML File** ([CellML Module Format](./cellml-module-format.md)).

- Every named `<units>` in the file joins the shared units library, for any module to use.
- A units-only file is fine.
- A unit made from existing units, such as `mV/ms`, needs no file: type it in the Parameters tab's **Units** column and pick the new unit offered. See [Writing CellML](../guides/writing-cellml.md#units).
