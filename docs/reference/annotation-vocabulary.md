# Annotation Vocabulary

The terms PhLynx reads and writes in module sidecars. Sidecars use standard ontologies only, in the composite-annotation pattern of OMEX Metadata 1.2: there is no PhLynx namespace. For how to use them, see [Coupling with Annotations](../guides/annotation-coupling.md).

## Namespaces {#namespaces}

| Prefix | IRI | Used for |
| :--- | :--- | :--- |
| `bqbiol` | `http://biomodels.net/biology-qualifiers/` | The qualifiers below |
| `semsim` | `http://bime.uw.edu/semsim/` | Process participants of flows |
| `opb` | `https://identifiers.org/opb/OPB_` | Properties |
| `chebi` | `https://identifiers.org/chebi/CHEBI:` | Species |
| `go` | `https://identifiers.org/go/GO:` | Places, membranes, molecular functions |
| `sbo` | `https://identifiers.org/sbo/SBO:` | Compartments |
| `uniprot` | `https://identifiers.org/uniprot/` | Transporters and channels |

Other common IRI forms are read as the same term: `http://identifiers.org/CHEBI:29101`, `http://purl.obolibrary.org/obo/CHEBI_29101`, `http://identifiers.org/opb/OPB_00340`, `http://identifiers.org/GO:0005737`, `https://purl.uniprot.org/uniprot/Q0TOY1`. PhLynx shows and compares them as CURIEs (`CHEBI:29101`, `OPB:00340`, `GO:0005737`, `SBO:0000290`, `uniprot:Q0TOY1`).

## Sidecar Subjects {#subjects}

| Subject | Names |
| :--- | :--- |
| `<./pool.cellml#pool>` | The component `pool` of `pool.cellml` |
| `<./pool.cellml#v4rjndoly>` | The variable whose CellML `id` is `v4rjndoly` |
| `<./pool.ttl#entity_self>` | An entity the sidecar defines: here, the module itself |

Variables are named by their CellML `id`, which PhLynx gives a variable when it is first annotated and keeps through renames, so annotations survive renaming a variable. Only a subject's file name and fragment are used, so the sidecar can sit anywhere. A sidecar annotates exactly one component.

## The Component {#component}

`bqbiol:is` on the component says what kind of module it is (its **Module kind** on the [Annotations tab](../guides/annotation-coupling.md#annotations-tab)). The physiology view draws the module from this.

| Module | `bqbiol:is` | Example |
| :--- | :--- | :--- |
| Transporter or channel | A `uniprot:` accession | `m:porter bqbiol:is uniprot:Q0TOY1` |
| Membrane | `GO:0005886` (plasma membrane) | `m:wall bqbiol:is go:0005886` |
| Compartment | `SBO:0000290` (physical compartment) | `m:pool bqbiol:is sbo:0000290` |

A component may also be `bqbiol:isVersionOf` a GO molecular function, such as `GO:0005412` (glucose:sodium symporter activity). The physiology view picks a protein's [cartoon](../guides/physiology-view.md#glyphs) from it.

## Variables {#variables}

Each annotated variable has two triples:

- `bqbiol:isVersionOf` an OPB **property**;
- `bqbiol:isPropertyOf` what it is a property of: an **entity** (with `bqbiol:is` terms and an optional `bqbiol:isPartOf`), or for a flow a **process** whose `semsim:hasSinkParticipant` is the entity the flow goes into, and whose optional `semsim:hasSourceParticipant` is where it comes from.

The entity's CHEBI terms are its **species**. One of the three GO cellular components below (cytoplasm, extracellular region, plasma membrane), among its `bqbiol:is` terms or as its `bqbiol:isPartOf`, is its **place**, not a species. Other terms are reported as warnings.

```turtle
@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix semsim: <http://bime.uw.edu/semsim/> .
@prefix opb: <https://identifiers.org/opb/OPB_> .
@prefix chebi: <https://identifiers.org/chebi/CHEBI:> .
@prefix sbo: <https://identifiers.org/sbo/SBO:> .
@prefix m: <./pool.cellml#> .
@prefix local: <./pool.ttl#> .

m:pool bqbiol:is sbo:0000290 .
local:entity_self bqbiol:is sbo:0000290 .

# c_A: the Na+ concentration of the compartment itself.
m:v4rjndoly bqbiol:isVersionOf opb:00340 ;
    bqbiol:isPropertyOf local:Na_self .
local:Na_self bqbiol:is chebi:29101 ;
    bqbiol:isPartOf local:entity_self .

# v_A: the Na+ flow into the compartment.
m:v82dsevh3 bqbiol:isVersionOf opb:00592 ;
    bqbiol:isPropertyOf local:process_v82dsevh3 .
local:process_v82dsevh3 semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:Na_self ] .
```

### Properties {#properties}

| Property | OPB | Flow |
| :--- | :--- | :--- |
| Concentration | `OPB:00340` | |
| Amount | `OPB:00425` | |
| Molar flow rate | `OPB:00592` | Yes |
| Fluid volume | `OPB:00154` | |
| Spatial area | `OPB:00295` | |
| Electrical potential | `OPB:00506` | |
| Charge flow rate | `OPB:00318` | Yes |

A species' flow is a molar flow rate whether its units are per membrane area or not. Older side-cars that use `OPB:00593` (chemical amount density flow rate) are still read as flows, but it is no longer offered.

> [!NOTE]
> These OPB ids are still to be checked against an OPB release.

### Species {#species}

Any CHEBI term. Labels are built in for common species such as Na⁺ `CHEBI:29101`, K⁺ `CHEBI:29103`, D-glucose `CHEBI:17634`, H⁺ `CHEBI:15378`, ATP `CHEBI:15422`, ADP `CHEBI:16761` and phosphate `CHEBI:43474`; others are [looked up online](../guides/annotation-coupling.md#ontology-lookup) or show as their CURIE. Two quantities couple only when their species sets are equal.

### Places {#places}

A place is either **self** (the instance's own place) or **relative** (a place next to the instance).

| Written as | Place | Meaning |
| :--- | :--- | :--- |
| `bqbiol:isPartOf local:entity_self` | self | The instance's own place |
| `bqbiol:is go:0005886 ; bqbiol:isPartOf local:entity_self` | self + plasma membrane | The membrane of the instance's own place (a cell's area) |
| `bqbiol:isPartOf go:0005737` | relative: cytoplasm | Inside the cell the instance is on |
| `bqbiol:isPartOf go:0005576` | relative: extracellular region | The side the instance's facet faces |
| `bqbiol:is go:0005886` | relative: plasma membrane | The membrane the instance sits in |

Where each one resolves depends on where the instance sits in the physiology view: see [How places resolve](#resolution).

### Roles {#roles}

PhLynx derives a variable's role from its place and property. Roles are never written in the file.

| | Not a flow | A flow |
| :--- | :--- | :--- |
| **Self-located** | **Owner** (multiport True) | **Aggregator**: the sum of the flows into it (multiport Sum) |
| **Relatively located** | **Reader** (multiport None) | **Contributor** to an aggregator (multiport None) |

Quantities couple when their property is equal, their species are equal, their places are the same, and their roles complement each other: owner with reader is a plain link, aggregator with contributor a Sum term. Readers never couple with readers, nor contributors with contributors.

An instance whose summed flows are [held at 0](../guides/annotation-coupling.md#hold-at-zero) has no aggregators.

### Flow Convention {#flow-convention}

A flow always means the rate **into its sink**. The toy porter's inner flux (sink in the cytoplasm) is the rate into the cytoplasm; its outer flux (sink in the extracellular region) the rate into the outside. A compartment's `v_A` is the total rate into itself, the sum of its contributors.

### No Multipliers {#no-multipliers}

Every contribution is added ×1. There is no `semsim:hasMultiplier`, and no factor in a sidecar. A factor belongs in the math, in a variable of its own. A charge flow is the clearest case: each transporter defines it per ion flux from the ion's charge number, `I_X = z·v_X_i`, and annotates that variable as charge flow rate (`OPB:00318`) into the plasma membrane. The membrane module's total, annotated as the charge flow rate into itself, sums these.

## How Places Resolve {#resolution}

Each place resolves, from where the instance sits in the [physiology view](../guides/physiology-view.md), to a physical place: a template site, or a cell, membrane or compartment of the view. Two quantities can couple only at the same place.

| Instance is | self | self + plasma membrane | cytoplasm | plasma membrane | extracellular region |
| :--- | :--- | :--- | :--- | :--- | :--- |
| A compartment (region outside cells) | The compartment | | | | |
| A cell's inside | The cell's inside | The cell's membrane, all facets | | | |
| A cell's membrane | The membrane, all facets | | The cell's inside | | |
| A membrane protein on a facet | | | The cell's inside | The membrane, that facet | Each compartment against that facet |
| A process in a cell | | | The cell's inside | | |

On a template, the sites say what lies against what. Off templates, a compartment lies against what **Lies Against** says. On a membrane, the relative side's facets must lie within the self-located side's, so a membrane of all facets takes an apical transporter's charge flow.

A place with no meaning for the instance, such as a compartment's cytoplasm, is left unresolved and gets no coupling. An instance with no place, such as one shown as a card, keeps its stored couplings.
