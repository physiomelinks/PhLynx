# CellML Module Format

What a `.cellml` file needs for PhLynx to import its components as modules, via Import ▸ **CellML File** or by dropping files on the Workspace.

## Requirements

- A <GlossaryLink term="CellML"/> file (`.cellml` or `.xml`) that PhLynx's CellML 2.0 parser reads without errors.
- Each `<component>` becomes one module in the **Available Modules** panel, grouped under the file's name.

## What Gets Imported

- Each component's name, variables and equations.
- Any `<units>` in the same file; see [CellML Units File](./cellml-units-file.md). A file can hold modules, units, or both.
- **Connected models:** a single file whose components are connected is also placed on the Workspace as a connected model. If the Workspace isn't empty, PhLynx asks whether to **Overwrite** it or **Add to Workspace**. Several files at once are only added as modules.

## Notes

- A component's variables become ports only when you add them in the Instance Editor's **Ports** tab; see [Interface Overview](./ui-overview.md#instance-editor).
- The Parameters tab flags any unit that isn't in the units library. Import a file that defines it, or choose another unit.
