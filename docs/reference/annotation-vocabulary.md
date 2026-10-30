# Annotation Vocabulary

The terms PhLynx reads in module sidecars and instance ApiCoord files. Sidecars use standard ontologies only, in the composite-annotation pattern of OMEX Metadata 1.2: there is no PhLynx namespace. For how to use them, see [Coupling with Annotations](../guides/annotation-coupling.md).

## Namespaces {#namespaces}

| Prefix | IRI | Used for |
| :--- | :--- | :--- |
| `bqbiol` | `http://biomodels.net/biology-qualifiers/` | The qualifiers below |
| `opb` | `http://identifiers.org/opb/OPB_` | Properties |
| `chebi` | `http://purl.obolibrary.org/obo/CHEBI_` | Species |
| `go` | `http://purl.obolibrary.org/obo/GO_` | Locations, membranes, processes |
| `sbo` | `http://purl.obolibrary.org/obo/SBO_` | Compartments |
| `uniprot` | `http://identifiers.org/uniprot/` | Transporters and channels |
| `api` | `https://apinatomy.org/uris/elements/` | ApiCoord files only |

Other common IRI forms are read as the same term: `http://identifiers.org/CHEBI:29101`, `http://identifiers.org/chebi/CHEBI:29101`, `https://identifiers.org/OPB:00340`, `http://identifiers.org/GO:0005737`, `https://purl.uniprot.org/uniprot/Q0TOY1`. PhLynx shows and compares them as CURIEs (`CHEBI:29101`, `OPB:00340`, `GO:0005737`, `SBO:0000290`, `uniprot:Q0TOY1`).

## Sidecar Subjects {#subjects}

| Subject | Names |
| :--- | :--- |
| `<./pool.cellml#pool>` | The component `pool` of `pool.cellml` |
| `<./pool.cellml#pool.c_A>` | Its variable `c_A` |
| `<./porter.cellml#flux_in>` | The variable whose CellML `id` is `flux_in` |

Only a subject's file name and fragment are used, so the sidecar can sit anywhere. A sidecar annotates exactly one component.

## The Component {#component}

`bqbiol:is` on the component says what kind of module it is. PhLynx uses this to choose the module for each [ApiCoord kind](#apicoord-kinds).

| Module | `bqbiol:is` | Example |
| :--- | :--- | :--- |
| Transporter or channel | A `uniprot:` accession | `m:porter bqbiol:is uniprot:Q0TOY1` |
| Membrane | `GO:0005886` (plasma membrane) | `m:wall bqbiol:is go:0005886` |
| Compartment | `SBO:0000290` (physical compartment) | `m:pool bqbiol:is sbo:0000290` |

A component may also be `bqbiol:isVersionOf` a GO molecular function, such as `GO:0005412` (glucose:sodium symporter activity). This is shown for information and not used for matching.

## Variables {#variables}

Each annotated variable has two triples:

- `bqbiol:isVersionOf` an OPB **property**;
- `bqbiol:isPropertyOf` the **entity** it is a property of: either the component itself, or a node with `bqbiol:is` terms and an optional `bqbiol:isPartOf` the component.

The entity's CHEBI terms are its **species**. One of the three GO cellular components below (cytoplasm, extracellular region, plasma membrane) among its `bqbiol:is` terms, or as its `bqbiol:isPartOf`, is its **location**, not a species. Other terms are reported as warnings.

### Properties {#properties}

| Property | OPB | Flow |
| :--- | :--- | :--- |
| Concentration | `OPB:00340` | |
| Molar flow rate | `OPB:00592` | Yes |
| Fluid volume | `OPB:00154` | |
| Spatial area | `OPB:00295` | |
| Electrical potential | `OPB:00506` | |
| Charge flow rate | `OPB:00318` | Yes |

> [!NOTE]
> These OPB ids are still to be checked against an OPB release.

### Species {#species}

Any CHEBI term. Labels are built in for Na⁺ `CHEBI:29101`, K⁺ `CHEBI:29103`, D-glucose `CHEBI:17634`, H⁺ `CHEBI:15378`, ATP `CHEBI:15422`, ADP `CHEBI:16761` and phosphate `CHEBI:43474`; other terms show as their CURIE. Two quantities couple only when their species sets are equal.

### Locations {#locations}

A location is either **self** (here, wherever the instance is) or **relative** (a place next to the instance).

| Written as | Location | Meaning |
| :--- | :--- | :--- |
| `bqbiol:isPropertyOf m:pool` | self | The instance's own place |
| `bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf m:pool ]` | self | Na⁺ in the instance's own place |
| `bqbiol:isPropertyOf [ bqbiol:is go:0005886 ; bqbiol:isPartOf m:pool ]` | self + plasma membrane | The plasma membrane of the instance's own place (a cell's area) |
| `[ bqbiol:is chebi:29101 , go:0005737 ]` | relative: cytoplasm `GO:0005737` | Na⁺ in the cytoplasm of the cell the instance is on |
| `[ bqbiol:is chebi:29101 , go:0005576 ]` | relative: extracellular region `GO:0005576` | Na⁺ on the side the instance's facet faces |
| `[ bqbiol:is go:0005886 ]` | relative: plasma membrane `GO:0005886` | The membrane the instance sits in |

Where a relative location resolves depends on the instance's ApiCoord: see [How locations resolve](#resolution).

### Roles {#roles}

PhLynx derives a variable's role from its location and property. Roles are never written in the file.

| | Not a flow | A flow |
| :--- | :--- | :--- |
| **Self-located** | **Owner** (multiport True) | **Aggregator**: the sum of the flows into it (multiport Sum) |
| **Relatively located** | **Reader** (multiport None) | **Contributor** to an aggregator (multiport None) |

Quantities couple when their property is equal, their species are equal, their locations resolve to the same place, and their roles complement each other: owner with reader is a plain link, aggregator with contributor a Sum term. Readers never couple with readers, nor contributors with contributors. Two owners, or two aggregators, of one quantity at one place are a conflict. A reader with more than one possible owner is ambiguous.

A [held-constant](../guides/annotation-coupling.md#reservoirs) instance has no aggregators: its summed flows are constant 0.

### Flow Convention {#flow-convention}

A flow always means the rate **into the located entity**. The toy porter's `v_A_i` (located in the cytoplasm) is the rate into the cytoplasm; its `v_A_o` (extracellular region) is the rate into the outside. A compartment's `v_A` is the total rate into itself, the sum of its contributors.

### No Multipliers {#no-multipliers}

Every contribution is added ×1. There is no `semsim:hasMultiplier`, and no factor in a sidecar. A factor belongs in the math, in a variable of its own. A charge flow is the clearest case: each transporter defines it per ion flux from the ion's charge number, `I_X = z·v_X_i`, and annotates that variable as charge flow rate (`OPB:00318`) across the plasma membrane. The membrane module's total, annotated as the charge flow rate of itself, sums these. The toy porter's `j_A = 1·v_A_i` is such a variable; a Ca²⁺ module would multiply by 2 in its own math.

## ApiCoord Instance Files {#apicoord-files}

An instance file places each model component with `bqbiol:is` an `api:ApiCoord`:

```turtle
@prefix model: <./model.cellml#> .
@prefix local: <./apicoords.rdf#> .

model:porter_in bqbiol:is local:coord_porter_in .
local:coord_porter_in a api:ApiCoord ;
    api:kind "deployment" ;
    api:within local:coord_cell ;
    api:facet "apical" ;
    api:protein uniprot:Q0TOY1 .
```

The subject's fragment (`porter_in`) is the instance's name, and on export the name of its CellML component. PhLynx reads the file and never changes it.

### ApiCoord Kinds {#apicoord-kinds}

| `api:kind` | What it places | Predicates read | Module chosen |
| :--- | :--- | :--- | :--- |
| `layer` | A layer of the lyphs in a scope; layer 0 is the conveyed material, such as a lumen | `api:scope` or `api:within` (an `api:Scope`), `api:layerIndex`, `api:material` | A compartment (`SBO:0000290`) |
| `cell` | A cell type housed in a scope | `api:within` (an `api:Scope`), `api:cell`, `api:chainShape` | A compartment, standing for the cytoplasm |
| `facet-layer` | A layer of one or more facets of a cell | `api:within` (a cell), `api:facet`, `api:layerIndex`, `api:material` | The module that `bqbiol:is` its `api:material` (`GO:0005886`) |
| `deployment` | A membrane protein on a facet of a cell | `api:within` (a cell), `api:facet`, `api:protein`, `api:regions`, `api:label` | The module that `bqbiol:is` its `api:protein` |
| `lyph` | A conduit, such as a blood vessel | `api:origin`, `api:template`, `api:anatomy`, `api:conveys`, `api:coalescedWith` | A compartment, standing for what it conveys |

An `api:Scope` gives its region as `api:anatomy` terms (several are alternatives) and `api:closure`. Facets are `apical`, `lateral` and `basolateral`. The kinds `material`, `chain` and `coalescence` are read, but no module is chosen for them, so Apply skips their instances. Problems in the file, such as a deployment not `api:within` a cell, are listed as warnings in the Apply dialog.

### How Locations Resolve {#resolution}

Each location resolves on an instance's ApiCoord to a **place**. Two quantities can couple only at the same place.

| ApiCoord | self | self + plasma membrane | cytoplasm `GO:0005737` | plasma membrane `GO:0005886` | extracellular `GO:0005576` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `layer` | That layer of the scope | | | | |
| `cell` | The cell's cytoplasm | The cell's membrane, all facets | | | |
| `facet-layer` (index 1, or material `GO:0005886`) | The cell's membrane, its facets | | The cell's cytoplasm | | |
| `deployment` | | | The cytoplasm of the cell it is `within` | The cell's membrane, its facets | Apical: layer 0 of the cell's scope. Basolateral: see below. Lateral: none |
| `lyph` | The lyph | | | | |

A cell is identified by its scope's `api:anatomy` terms and its `api:cell` term, so a membrane module and a transporter on the same cell meet at the same place. On a membrane, the relative side's facets must lie within the self-located side's: a membrane of all three facets takes an apical transporter's charge flow.

A location with no meaning on a kind, such as a pool's area on a `layer`, is left unresolved and gets no coupling.

### Coalescence Fallback {#coalescence-fallback}

ApiCoord v0.2 has no predicate for what a basolateral facet's extracellular side faces (for an epithelial cell, typically a blood vessel beyond the basement membrane). PhLynx falls back on coalescence: when exactly one `lyph` instance on the canvas, bound to its ApiCoord, has `api:coalescedWith`, the basolateral side is taken to face that lyph, at **low confidence**, with the reason given on the suggestion. With no such lyph, or more than one, the basolateral side stays unresolved.
