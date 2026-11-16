# Welcome to PhLynx

Physiome Links (**PhLynx**, pronounced "flinks") is a web app for coupling existing <GlossaryLink term="CellML"/> components into system models, such as coupled cell models and blood or lymph flow networks.

New here? Start with the [Quick Start Guide](./quick-start-guide.md).

## Before you start {#before-you-start}

- PhLynx runs in the browser at [https://phlynx.com/](https://phlynx.com/), with nothing to install.
- Use a current Chrome, Edge, Firefox or Safari. Chrome and Edge also let you choose where files are saved.
- The simulator needs cross-origin isolation, which PhLynx sets up with a service worker. The page may reload once on your first visit, and simulation may not work in a private window.
- PhLynx doesn't save automatically. Save your workspace often (see [Save and Export](./quick-start-guide.md#save-and-export)).

## Why PhLynx?

- **Visual assembly:** connect modules on a canvas instead of writing variable mappings by hand.
- **Reusable modules:** combine open library modules with your own.
- **Standard output:** models are valid CellML, so units are checked and CellML tools can turn them into code (e.g. C, Python).
- **Open source:** free to use, audit and extend ([GitHub](https://github.com/physiomelinks/phlynx)).

## Workflow

1. **Start** from the built-in library (e.g. heart and vessel modules), write your own in PhLynx's Instance Editor from the **new_module** template, or bring CellML from elsewhere. You can also draw a module as a bond-graph diagram ([Drawing CellDL Modules](../guides/drawing-celldl-modules.md), in beta).
2. **Import** any outside modules into PhLynx (CellML files, [COMBINE archives](../reference/file-types.md#combine-archive) or Circulatory Autogen models).
3. **Assemble** the model by connecting modules and defining their ports.
4. **Simulate** in the app: plot results, adjust parameters with sliders, compare runs, and run protocols and sweeps.
5. **Export or send** the model as <GlossaryLink term="flattened-cellml">flattened CellML</GlossaryLink>, an OMEX archive for [OpenCOR](https://opencor.ws/) or <GlossaryLink term="cuflynx">CUFLynx</GlossaryLink>, or [Circulatory Autogen](https://physiomelinks.github.io/circulatory_autogen/) files for calibration and sensitivity analysis.
