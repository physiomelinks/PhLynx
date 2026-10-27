# Changelog


## v0.5.3
###### Released on 2026-10-27

#### Not Specified
* Keep dark-theme colours inside the node colour panel and simulation status by [@jmdowrick](https://github.com/jmdowrick) in [#920](https://github.com/physiomelinks/PhLynx/pull/920)
* Reject couplings that set a variable more than once by [@jmdowrick](https://github.com/jmdowrick) in [#930](https://github.com/physiomelinks/PhLynx/pull/930)
* Type a library module's DAE unknowns with the math's stored values by [@jmdowrick](https://github.com/jmdowrick) in [#892](https://github.com/physiomelinks/PhLynx/pull/892)
* Name each instance's ids after it when flattening by [@jmdowrick](https://github.com/jmdowrick) in [#878](https://github.com/physiomelinks/PhLynx/pull/878)


#### New Features
* Flag couplings whose variables have units of different dimensions by [@jmdowrick](https://github.com/jmdowrick) in [#869](https://github.com/physiomelinks/PhLynx/pull/869)


#### Fixed Bugs
* Derive every edge's couplings with one resolver by [@jmdowrick](https://github.com/jmdowrick) in [#949](https://github.com/physiomelinks/PhLynx/pull/949)
* Handle per user defined units by [@hsorby](https://github.com/hsorby) in [#915](https://github.com/physiomelinks/PhLynx/pull/915)
* Keep a workspace's units file over the built-in one, and load it after the library by [@jmdowrick](https://github.com/jmdowrick) in [#875](https://github.com/physiomelinks/PhLynx/pull/875)
* Type the variables a DAE solves implicitly as computed by [@jmdowrick](https://github.com/jmdowrick) in [#883](https://github.com/physiomelinks/PhLynx/pull/883)
* Import the units parameter rows use, and name units nothing defines by [@FinbarArgus](https://github.com/FinbarArgus) in [#864](https://github.com/physiomelinks/PhLynx/pull/864)


#### Maintenance Work
* Replace the migration fixture files with synthetic workspaces by [@jmdowrick](https://github.com/jmdowrick) in [#884](https://github.com/physiomelinks/PhLynx/pull/884)


#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/FinbarArgus">
    <img src="https://avatars.githubusercontent.com/u/64084030?v=4&s=100" width="50" height="50"><br>
    <sub>@FinbarArgus</sub>
  </a>
</kbd>



---

## v0.5.2
###### Released on 2026-10-19

#### New Features
* Plot boundary conditions and constants everywhere by [@jmdowrick](https://github.com/jmdowrick) in [#829](https://github.com/physiomelinks/PhLynx/pull/829)
* Add variable search to the edge connection dialog by [@jmdowrick](https://github.com/jmdowrick) in [#828](https://github.com/physiomelinks/PhLynx/pull/828)
* Show drag-over and loading cues for dropped models by [@jmdowrick](https://github.com/jmdowrick) in [#837](https://github.com/physiomelinks/PhLynx/pull/837)


#### Fixed Bugs
* Keep unit suggestions above the instance editor by [@jmdowrick](https://github.com/jmdowrick) in [#827](https://github.com/physiomelinks/PhLynx/pull/827)
* Report a variable of integration whose units can't join the environment by [@jmdowrick](https://github.com/jmdowrick) in [#835](https://github.com/physiomelinks/PhLynx/pull/835)
* Place one-module CellML exports instead of hanging the load by [@jmdowrick](https://github.com/jmdowrick) in [#855](https://github.com/physiomelinks/PhLynx/pull/855)


#### Maintenance Work
* Speed up large workspaces: lighter handles, search highlight and library by [@jmdowrick](https://github.com/jmdowrick) in [#838](https://github.com/physiomelinks/PhLynx/pull/838)


#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd>



---

## v0.5.1
###### Released on 2026-10-15

#### New Features
* Allow a variable to sum through more than one port on an instance by [@jmdowrick](https://github.com/jmdowrick) in [#806](https://github.com/physiomelinks/PhLynx/pull/806)
* Add warning to instance nodes when units are missing or invalid by [@jmdowrick](https://github.com/jmdowrick) in [#796](https://github.com/physiomelinks/PhLynx/pull/796)
* Allow creation of user defined units by [@hsorby](https://github.com/hsorby) in [#797](https://github.com/physiomelinks/PhLynx/pull/797)


#### Fixed Bugs
* Stop gen-changelog crashing on issue references by [@jmdowrick](https://github.com/jmdowrick) in [#812](https://github.com/physiomelinks/PhLynx/pull/812)
* Fix the macro builder's prompt for an existing connection by [@jmdowrick](https://github.com/jmdowrick) in [#799](https://github.com/physiomelinks/PhLynx/pull/799)
* Import attachNewNodeToFrame where drops use it by [@jmdowrick](https://github.com/jmdowrick) in [#808](https://github.com/physiomelinks/PhLynx/pull/808)
* Import CellML constants shared through connections as constants by [@jmdowrick](https://github.com/jmdowrick) in [#788](https://github.com/physiomelinks/PhLynx/pull/788)


#### Maintenance Work
* Give the search bar slash some clothes by [@jmdowrick](https://github.com/jmdowrick) in [#811](https://github.com/physiomelinks/PhLynx/pull/811)
* Hoist encapsulated CellML components on import by [@jmdowrick](https://github.com/jmdowrick) in [#789](https://github.com/physiomelinks/PhLynx/pull/789)


#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd>



---

## v0.5.0
###### Released on 2026-10-14

#### Not Specified
* Show a boundary condition's own-value fallback as a note, not a warning by [@jmdowrick](https://github.com/jmdowrick) in [#770](https://github.com/physiomelinks/PhLynx/pull/770)
* Keep variable names visible; controls on the left with a settings section by [@jmdowrick](https://github.com/jmdowrick) in [#757](https://github.com/physiomelinks/PhLynx/pull/757)


#### New Features
* Make the sweep editor compact, scope-aware and ODE-aware by [@jmdowrick](https://github.com/jmdowrick) in [#771](https://github.com/physiomelinks/PhLynx/pull/771)
* Make the workspace sidebars easier to find by [@jmdowrick](https://github.com/jmdowrick) in [#763](https://github.com/physiomelinks/PhLynx/pull/763)
* Add a var: workspace search mode and a / mode picker by [@jmdowrick](https://github.com/jmdowrick) in [#740](https://github.com/physiomelinks/PhLynx/pull/740)
* Give the instance editor its own plot and plot variables clicked in the math by [@jmdowrick](https://github.com/jmdowrick) in [#736](https://github.com/physiomelinks/PhLynx/pull/736)
* Open the results on a simulation page instead of a larger view by [@jmdowrick](https://github.com/jmdowrick) in [#735](https://github.com/physiomelinks/PhLynx/pull/735)
* Track runs from the simulation toolbar, name them, and hide variables while tracking by [@jmdowrick](https://github.com/jmdowrick) in [#734](https://github.com/physiomelinks/PhLynx/pull/734)
* Rename a node by clicking its name, open the editor by double-clicking anywhere by [@jmdowrick](https://github.com/jmdowrick) in [#733](https://github.com/physiomelinks/PhLynx/pull/733)
* Show each parameter's connection status in the instance editor by [@jmdowrick](https://github.com/jmdowrick) in [#724](https://github.com/physiomelinks/PhLynx/pull/724)
* Report Math Editor edits once typing pauses by [@jmdowrick](https://github.com/jmdowrick) in [#723](https://github.com/physiomelinks/PhLynx/pull/723)
* Simulate and plot models in PhLynx with libOpenCOR by [@jmdowrick](https://github.com/jmdowrick) in [#656](https://github.com/physiomelinks/PhLynx/pull/656)
* Sweep models with ODEs, choose the reading, and draw curves of a second parameter by [@jmdowrick](https://github.com/jmdowrick) in [#685](https://github.com/physiomelinks/PhLynx/pull/685)
* Bring protocols into main beside the sweep by [@jmdowrick](https://github.com/jmdowrick) in [#684](https://github.com/physiomelinks/PhLynx/pull/684)
* Sweep a parameter of an algebraic system, and plot one variable against another by [@jmdowrick](https://github.com/jmdowrick) in [#677](https://github.com/physiomelinks/PhLynx/pull/677)
* Track runs on the simulation charts, as web OpenCOR does by [@jmdowrick](https://github.com/jmdowrick) in [#678](https://github.com/physiomelinks/PhLynx/pull/678)


#### Fixed Bugs
* Include CellML module and units files in the CA export by [@jmdowrick](https://github.com/jmdowrick) in [#752](https://github.com/physiomelinks/PhLynx/pull/752)
* Fix Ctrl/Cmd+Shift+Z redo shortcut by [@jmdowrick](https://github.com/jmdowrick) in [#756](https://github.com/physiomelinks/PhLynx/pull/756)
* Write boundary-condition rows to the CA parameters CSV by [@jmdowrick](https://github.com/jmdowrick) in [#751](https://github.com/physiomelinks/PhLynx/pull/751)
* Plot a variable clicked in the Math Editor by [@jmdowrick](https://github.com/jmdowrick) in [#738](https://github.com/physiomelinks/PhLynx/pull/738)
* Restore the workspace search shortcuts and move the search into a composable by [@jmdowrick](https://github.com/jmdowrick) in [#739](https://github.com/physiomelinks/PhLynx/pull/739)
* Keep declared variables no equation uses in Simple Mode by [@jmdowrick](https://github.com/jmdowrick) in [#725](https://github.com/physiomelinks/PhLynx/pull/725)
* Reload a workspace when the same file is picked again by [@jmdowrick](https://github.com/jmdowrick) in [#722](https://github.com/physiomelinks/PhLynx/pull/722)
* Add a library module when an instance is saved as a new component by [@jmdowrick](https://github.com/jmdowrick) in [#720](https://github.com/physiomelinks/PhLynx/pull/720)
* Install one copy of @primeuix/utils so the math editor list stacks above dialogs by [@jmdowrick](https://github.com/jmdowrick) in [#721](https://github.com/physiomelinks/PhLynx/pull/721)
* Save the workspace with Ctrl/Cmd+S when it has instances by [@jmdowrick](https://github.com/jmdowrick) in [#768](https://github.com/physiomelinks/PhLynx/pull/768)
* Keep parameter types on load, and drop values a connection supplies by [@jmdowrick](https://github.com/jmdowrick) in [#686](https://github.com/physiomelinks/PhLynx/pull/686)
* Fix legacy migration of copied nodes' edges and of user modules by [@jmdowrick](https://github.com/jmdowrick) in [#682](https://github.com/physiomelinks/PhLynx/pull/682)


#### Documentation Updates
* Bring the user guide in line with v0.5.0 by [@jmdowrick](https://github.com/jmdowrick) in [#769](https://github.com/physiomelinks/PhLynx/pull/769)
* Document simulation, protocols, and the CellML/Math editors by [@jmdowrick](https://github.com/jmdowrick) in [#746](https://github.com/physiomelinks/PhLynx/pull/746)


#### Maintenance Work
* Change import and export icons in workspace area. by [@hsorby](https://github.com/hsorby) in [#741](https://github.com/physiomelinks/PhLynx/pull/741)
* Add Playwright tests for workspace canvas interactions by [@jmdowrick](https://github.com/jmdowrick) in [#767](https://github.com/physiomelinks/PhLynx/pull/767)
* Add unit tests for navigation, CellML import, handles, screenshot and save helpers by [@jmdowrick](https://github.com/jmdowrick) in [#745](https://github.com/physiomelinks/PhLynx/pull/745)
* Extract CellML drop handling into useCellmlDrop and test it by [@jmdowrick](https://github.com/jmdowrick) in [#760](https://github.com/physiomelinks/PhLynx/pull/760)
* Extract copy/paste/select-all into useWorkspaceClipboard and test it by [@jmdowrick](https://github.com/jmdowrick) in [#759](https://github.com/physiomelinks/PhLynx/pull/759)
* Extract workspace save and apply into useWorkspaceSaveLoad and test it by [@jmdowrick](https://github.com/jmdowrick) in [#764](https://github.com/physiomelinks/PhLynx/pull/764)
* Extract onConnect into useConnect and test it by [@jmdowrick](https://github.com/jmdowrick) in [#758](https://github.com/physiomelinks/PhLynx/pull/758)
* Extract node/edge history handling into useFlowHistory by [@jmdowrick](https://github.com/jmdowrick) in [#749](https://github.com/physiomelinks/PhLynx/pull/749)

#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd>



---

## v0.4.2
###### Released on 2026-10-09

#### New Features
* Add SVG output for screenshots by [@hsorby](https://github.com/hsorby) in [#665](https://github.com/physiomelinks/PhLynx/pull/665)
* Add multiport summary to math editor by [@jmdowrick](https://github.com/jmdowrick) in [#645](https://github.com/physiomelinks/PhLynx/pull/645)
* Implement a colour scheming mechanism. by [@hsorby](https://github.com/hsorby) in [#663](https://github.com/physiomelinks/PhLynx/pull/663)
* Introduce omex load on drop by [@jmdowrick](https://github.com/jmdowrick) in [#649](https://github.com/physiomelinks/PhLynx/pull/649)


#### Fixed Bugs
* Allow removing stub modules from the library area. by [@jmdowrick](https://github.com/jmdowrick) in [#667](https://github.com/physiomelinks/PhLynx/pull/667)


#### Contributors

<kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd>



---

## v0.4.1
###### Released on 2026-10-06

#### Maintenance Work
* Update vue3-math-editor to v0.3.3 by [@jmdowrick](https://github.com/jmdowrick) in [#650](https://github.com/physiomelinks/PhLynx/pull/650)
* Recognise OMEX flow snapshots from version 1.0.0 onwards by [@jmdowrick](https://github.com/jmdowrick) in [#643](https://github.com/physiomelinks/PhLynx/pull/643)


#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd>



---

## v0.4.0
###### Released on 2026-10-06

#### Not Specified
* Make an instance editor Save one canvas undo step by [@jmdowrick](https://github.com/jmdowrick) in [#633](https://github.com/physiomelinks/PhLynx/pull/633)
* Record node data edits as canvas undo steps by [@jmdowrick](https://github.com/jmdowrick) in [#632](https://github.com/physiomelinks/PhLynx/pull/632)
* Snapshot and restore math entries in the library store by [@jmdowrick](https://github.com/jmdowrick) in [#631](https://github.com/physiomelinks/PhLynx/pull/631)


#### New Features
* Introduce on-the-fly unit creation by [@jmdowrick](https://github.com/jmdowrick) in [#628](https://github.com/physiomelinks/PhLynx/pull/628)
* Add units auto suggestion to instance editor by [@jmdowrick](https://github.com/jmdowrick) in [#620](https://github.com/physiomelinks/PhLynx/pull/620)
* Open instance editor on double click by [@jmdowrick](https://github.com/jmdowrick) in [#623](https://github.com/physiomelinks/PhLynx/pull/623)
* Feature simple cellml edit by [@jmdowrick](https://github.com/jmdowrick) in [#596](https://github.com/physiomelinks/PhLynx/pull/596)


#### Fixed Bugs
* Ignore stale math analysis when a later load starts by [@jmdowrick](https://github.com/jmdowrick) in [#642](https://github.com/physiomelinks/PhLynx/pull/642)
* Keep state and global initial values when migrating 1.0.0 workspaces by [@jmdowrick](https://github.com/jmdowrick) in [#641](https://github.com/physiomelinks/PhLynx/pull/641)
* Keep URL hash and report errors when a link load fails by [@jmdowrick](https://github.com/jmdowrick) in [#639](https://github.com/physiomelinks/PhLynx/pull/639)
* Fix stale sidebar parameters and keep global constants in sync (#608) by [@jmdowrick](https://github.com/jmdowrick) in [#637](https://github.com/physiomelinks/PhLynx/pull/637)
* Protect new_module math by [@jmdowrick](https://github.com/jmdowrick) in [#636](https://github.com/physiomelinks/PhLynx/pull/636)
* Per-variable multiport couplings, with a chip editor and conflict warnings by [@jmdowrick](https://github.com/jmdowrick) in [#635](https://github.com/physiomelinks/PhLynx/pull/635)
* Give the instance editor its own undo history by [@jmdowrick](https://github.com/jmdowrick) in [#630](https://github.com/physiomelinks/PhLynx/pull/630)
* Improve batch import notification by [@jmdowrick](https://github.com/jmdowrick) in [#627](https://github.com/physiomelinks/PhLynx/pull/627)
* Remove hardcoded versioning throughout by [@jmdowrick](https://github.com/jmdowrick) in [#624](https://github.com/physiomelinks/PhLynx/pull/624)
* Fix auto layout to consider library area  by [@jmdowrick](https://github.com/jmdowrick) in [#625](https://github.com/physiomelinks/PhLynx/pull/625)
* Fix alignment of dark mode switch between views by [@jmdowrick](https://github.com/jmdowrick) in [#626](https://github.com/physiomelinks/PhLynx/pull/626)
* Fix silent math overwrite by [@jmdowrick](https://github.com/jmdowrick) in [#622](https://github.com/physiomelinks/PhLynx/pull/622)
* Feature simple cellml edit by [@jmdowrick](https://github.com/jmdowrick) in [#596](https://github.com/physiomelinks/PhLynx/pull/596)
* Create default module for raw math by [@jmdowrick](https://github.com/jmdowrick) in [#590](https://github.com/physiomelinks/PhLynx/pull/590)
* Disable settings button by [@jmdowrick](https://github.com/jmdowrick) in [#576](https://github.com/physiomelinks/PhLynx/pull/576)


#### Documentation Updates
* Fix typo in README by [@hsorby](https://github.com/hsorby) in [#579](https://github.com/physiomelinks/PhLynx/pull/579)


#### Maintenance Work
* Synchronise changelogs post release by [@hsorby](https://github.com/hsorby) in [#573](https://github.com/physiomelinks/PhLynx/pull/573)


#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd>



---

## v0.3.1
###### Released on 2026-09-03

#### Fixed Bugs
* Fix version test to handle asterisk by [@hsorby](https://github.com/hsorby) in [#568](https://github.com/physiomelinks/phlynx/pull/568)


#### Documentation Updates
* Add v0.3.0 changelog by [@hsorby](https://github.com/hsorby) in [#564](https://github.com/physiomelinks/phlynx/pull/564)


#### Contributors

<kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd>



---

## v0.3.0
###### Released on 2026-09-02

#### Not Specified
* Update README with release process information. by [@hsorby](https://github.com/hsorby) in [#556](https://github.com/physiomelinks/phlynx/pull/556)
* Enable import of OMEX files by [@hsorby](https://github.com/hsorby) in [#517](https://github.com/physiomelinks/phlynx/pull/517)
* Reduce sim steps with constant by [@jmdowrick](https://github.com/jmdowrick) in [#533](https://github.com/physiomelinks/phlynx/pull/533)
* Remove autopop and fix instance node css by [@jmdowrick](https://github.com/jmdowrick) in [#516](https://github.com/physiomelinks/phlynx/pull/516)
* Add ability to import OMEX by [@hsorby](https://github.com/hsorby) in [#514](https://github.com/physiomelinks/phlynx/pull/514)
* Dynamically update instance editor by [@jmdowrick](https://github.com/jmdowrick) in [#511](https://github.com/physiomelinks/phlynx/pull/511)
* Remove circulatory autogen from about page by [@jmdowrick](https://github.com/jmdowrick) in [#506](https://github.com/physiomelinks/phlynx/pull/506)
* Consolidate menu bar by [@jmdowrick](https://github.com/jmdowrick) in [#499](https://github.com/physiomelinks/phlynx/pull/499)
* Fix css of the search workspace bar by [@jmdowrick](https://github.com/jmdowrick) in [#501](https://github.com/physiomelinks/phlynx/pull/501)
* Bug fix code edit issue by [@jmdowrick](https://github.com/jmdowrick) in [#341](https://github.com/physiomelinks/phlynx/pull/341)
* Improve consistency of import dialog fields by [@jmdowrick](https://github.com/jmdowrick) in [#332](https://github.com/physiomelinks/phlynx/pull/332)
* Add missing units to the user units file by [@jmdowrick](https://github.com/jmdowrick) in [#313](https://github.com/physiomelinks/phlynx/pull/313)
* Add testing packages to phlynx by [@jmdowrick](https://github.com/jmdowrick) in [#308](https://github.com/physiomelinks/phlynx/pull/308)


#### New Features
* Add warning for auto-sanitised renaming by [@jmdowrick](https://github.com/jmdowrick) in [#531](https://github.com/physiomelinks/phlynx/pull/531)
* Introduce url-based loading by [@jmdowrick](https://github.com/jmdowrick) in [#543](https://github.com/physiomelinks/phlynx/pull/543)
* Add history to port autoupdate by [@jmdowrick](https://github.com/jmdowrick) in [#520](https://github.com/physiomelinks/phlynx/pull/520)
* Add ability to remove modules from library by [@jmdowrick](https://github.com/jmdowrick) in [#513](https://github.com/physiomelinks/phlynx/pull/513)
* Start adding bootstrap for producing an OMEX file by [@hsorby](https://github.com/hsorby) in [#505](https://github.com/physiomelinks/phlynx/pull/505)
* Add contextual side bar by [@jmdowrick](https://github.com/jmdowrick) in [#503](https://github.com/physiomelinks/phlynx/pull/503)
* Consolidate editor dialogs by [@jmdowrick](https://github.com/jmdowrick) in [#497](https://github.com/physiomelinks/phlynx/pull/497)
* Introduce hover based handle addition and duplicate connection replacement dialog by [@jmdowrick](https://github.com/jmdowrick) in [#490](https://github.com/physiomelinks/phlynx/pull/490)
* Introduce multiport multiply by [@jmdowrick](https://github.com/jmdowrick) in [#426](https://github.com/physiomelinks/phlynx/pull/426)
* Add module (config + component) information to copy and paste by [@jmdowrick](https://github.com/jmdowrick) in [#423](https://github.com/physiomelinks/phlynx/pull/423)
* Introduce edge connection dialogue by [@jmdowrick](https://github.com/jmdowrick) in [#392](https://github.com/physiomelinks/phlynx/pull/392)
* Enable users to copy between windows by [@jmdowrick](https://github.com/jmdowrick) in [#399](https://github.com/physiomelinks/phlynx/pull/399)
* Add editable title to the application header by [@jmdowrick](https://github.com/jmdowrick) in [#397](https://github.com/physiomelinks/phlynx/pull/397)
* Introduce the ability to import modularised cellml files by [@jmdowrick](https://github.com/jmdowrick) in [#365](https://github.com/physiomelinks/phlynx/pull/365)
* Change shortcut intercepts when in text editor by [@jmdowrick](https://github.com/jmdowrick) in [#357](https://github.com/physiomelinks/phlynx/pull/357)
* Add reset view to right click menu by [@jmdowrick](https://github.com/jmdowrick) in [#338](https://github.com/physiomelinks/phlynx/pull/338)
* Introduce the ability to import multiple files by [@jmdowrick](https://github.com/jmdowrick) in [#316](https://github.com/physiomelinks/phlynx/pull/316)


#### Fixed Bugs
* Fix prime vue icons getting cut from screenshot by [@jmdowrick](https://github.com/jmdowrick) in [#544](https://github.com/physiomelinks/phlynx/pull/544)
* Add dark mode for helper lines by [@jmdowrick](https://github.com/jmdowrick) in [#541](https://github.com/physiomelinks/phlynx/pull/541)
* Force the fitview to consider the size of the library panel by [@jmdowrick](https://github.com/jmdowrick) in [#540](https://github.com/physiomelinks/phlynx/pull/540)
* Fix history tracking for clearWorkspace by [@jmdowrick](https://github.com/jmdowrick) in [#532](https://github.com/physiomelinks/phlynx/pull/532)
* Add clear to library search by [@jmdowrick](https://github.com/jmdowrick) in [#538](https://github.com/physiomelinks/phlynx/pull/538)
* Address several macro builder bugs by [@jmdowrick](https://github.com/jmdowrick) in [#522](https://github.com/physiomelinks/phlynx/pull/522)
* Prevent handle activation while editing instance name by [@jmdowrick](https://github.com/jmdowrick) in [#519](https://github.com/physiomelinks/phlynx/pull/519)
* Fix issues with autolayout by [@jmdowrick](https://github.com/jmdowrick) in [#512](https://github.com/physiomelinks/phlynx/pull/512)
* Fix setting domain type to set Instance node colour. by [@hsorby](https://github.com/hsorby) in [#484](https://github.com/physiomelinks/phlynx/pull/484)
* Add PrimeVue to PhLynx by [@jmdowrick](https://github.com/jmdowrick) in [#472](https://github.com/physiomelinks/phlynx/pull/472)
* Maintenance data refactor by [@jmdowrick](https://github.com/jmdowrick) in [#443](https://github.com/physiomelinks/phlynx/pull/443)
* Nomenclature update by [@jmdowrick](https://github.com/jmdowrick) in [#427](https://github.com/physiomelinks/phlynx/pull/427)
* Copy-paste now moves the module information by [@jmdowrick](https://github.com/jmdowrick) in [#421](https://github.com/physiomelinks/phlynx/pull/421)
* Update BuilderView.vue by [@jmdowrick](https://github.com/jmdowrick) in [#410](https://github.com/physiomelinks/phlynx/pull/410)
* Fix detach reactivity bug by [@jmdowrick](https://github.com/jmdowrick) in [#408](https://github.com/physiomelinks/phlynx/pull/408)
* Ensure variables are added to user module configs by [@jmdowrick](https://github.com/jmdowrick) in [#396](https://github.com/physiomelinks/phlynx/pull/396)
* Fix module replace dialog size by [@jmdowrick](https://github.com/jmdowrick) in [#395](https://github.com/physiomelinks/phlynx/pull/395)
* Fix cellml export for constants by [@jmdowrick](https://github.com/jmdowrick) in [#393](https://github.com/physiomelinks/phlynx/pull/393)
* Fix multiport handling bug by [@jmdowrick](https://github.com/jmdowrick) in [#381](https://github.com/physiomelinks/phlynx/pull/381)
* Fix naming of parseCellmlConnections by [@jmdowrick](https://github.com/jmdowrick) in [#376](https://github.com/physiomelinks/phlynx/pull/376)
* Fix file naming issue by [@jmdowrick](https://github.com/jmdowrick) in [#374](https://github.com/physiomelinks/phlynx/pull/374)
* Fix user module config index handling  by [@jmdowrick](https://github.com/jmdowrick) in [#368](https://github.com/physiomelinks/phlynx/pull/368)
* Change order of CellML export checks. by [@hsorby](https://github.com/hsorby) in [#363](https://github.com/physiomelinks/phlynx/pull/363)
* Change shortcut intercepts when in text editor by [@jmdowrick](https://github.com/jmdowrick) in [#357](https://github.com/physiomelinks/phlynx/pull/357)
* Ensure units update following cellml edit by [@jmdowrick](https://github.com/jmdowrick) in [#350](https://github.com/physiomelinks/phlynx/pull/350)
* Fix cellml module save behaviour by [@jmdowrick](https://github.com/jmdowrick) in [#349](https://github.com/physiomelinks/phlynx/pull/349)
* Fix cellml editing behaviour by [@jmdowrick](https://github.com/jmdowrick) in [#339](https://github.com/physiomelinks/phlynx/pull/339)
* Update import dialog to Hugh's liking by [@jmdowrick](https://github.com/jmdowrick) in [#331](https://github.com/physiomelinks/phlynx/pull/331)
* Ensure that warning dialog checks against the same store by [@jmdowrick](https://github.com/jmdowrick) in [#328](https://github.com/physiomelinks/phlynx/pull/328)
* Fix form behaviour by [@jmdowrick](https://github.com/jmdowrick) in [#325](https://github.com/physiomelinks/phlynx/pull/325)
* Fix vessel array file removal bug by [@jmdowrick](https://github.com/jmdowrick) in [#320](https://github.com/physiomelinks/phlynx/pull/320)
* Introduce the ability to import multiple files by [@jmdowrick](https://github.com/jmdowrick) in [#316](https://github.com/physiomelinks/phlynx/pull/316)
* Fix bugs related to system dialog by [@jmdowrick](https://github.com/jmdowrick) in [#307](https://github.com/physiomelinks/phlynx/pull/307)
* Fix order of columns in parameter export by [@jmdowrick](https://github.com/jmdowrick) in [#294](https://github.com/physiomelinks/phlynx/pull/294)
* Fix circulatory autogen export naming by [@jmdowrick](https://github.com/jmdowrick) in [#291](https://github.com/physiomelinks/phlynx/pull/291)
* Fix parameter export format by [@jmdowrick](https://github.com/jmdowrick) in [#287](https://github.com/physiomelinks/phlynx/pull/287)


#### Documentation Updates
* Improve documentation in README around testing. by [@hsorby](https://github.com/hsorby) in [#496](https://github.com/physiomelinks/phlynx/pull/496)
* Nomenclature update by [@jmdowrick](https://github.com/jmdowrick) in [#427](https://github.com/physiomelinks/phlynx/pull/427)


#### Maintenance Work
* Flatten phlynx workspace file format by [@jmdowrick](https://github.com/jmdowrick) in [#542](https://github.com/physiomelinks/phlynx/pull/542)
* Fix history tracking for clearWorkspace by [@jmdowrick](https://github.com/jmdowrick) in [#532](https://github.com/physiomelinks/phlynx/pull/532)
* Make imports easier by [@jmdowrick](https://github.com/jmdowrick) in [#507](https://github.com/physiomelinks/phlynx/pull/507)
* Add contextual side bar by [@jmdowrick](https://github.com/jmdowrick) in [#503](https://github.com/physiomelinks/phlynx/pull/503)
* Fix css of edge connection dialog handles by [@jmdowrick](https://github.com/jmdowrick) in [#509](https://github.com/physiomelinks/phlynx/pull/509)
* Consolidate editor dialogs by [@jmdowrick](https://github.com/jmdowrick) in [#497](https://github.com/physiomelinks/phlynx/pull/497)
* Add Playwright testing using Python unittest framework. by [@hsorby](https://github.com/hsorby) in [#483](https://github.com/physiomelinks/phlynx/pull/483)
* Remove element plus from PhLynx by [@jmdowrick](https://github.com/jmdowrick) in [#482](https://github.com/physiomelinks/phlynx/pull/482)
* Maintenance data refactor by [@jmdowrick](https://github.com/jmdowrick) in [#443](https://github.com/physiomelinks/phlynx/pull/443)
* Nomenclature update by [@jmdowrick](https://github.com/jmdowrick) in [#427](https://github.com/physiomelinks/phlynx/pull/427)
* Introduce edge connection dialogue by [@jmdowrick](https://github.com/jmdowrick) in [#392](https://github.com/physiomelinks/phlynx/pull/392)
* Improve UX for multiport sum by [@jmdowrick](https://github.com/jmdowrick) in [#384](https://github.com/physiomelinks/phlynx/pull/384)
* Handle non-standard units requiring affine transform by [@jmdowrick](https://github.com/jmdowrick) in [#370](https://github.com/physiomelinks/phlynx/pull/370)
* Combine unit and module file imports by [@jmdowrick](https://github.com/jmdowrick) in [#359](https://github.com/physiomelinks/phlynx/pull/359)
* Improve module list ux by [@jmdowrick](https://github.com/jmdowrick) in [#352](https://github.com/physiomelinks/phlynx/pull/352)
* Make module creation easier by [@jmdowrick](https://github.com/jmdowrick) in [#334](https://github.com/physiomelinks/phlynx/pull/334)


#### Contributors

<kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd>


---

## v0.2.4
###### Released on 2026-02-11

#### New Features
* Correct PhLynx circulatory autogen export formats by [@jmdowrick](https://github.com/jmdowrick) in [#262](https://github.com/physiomelinks/phlynx/pull/262)
* Add search bar to workspace by [@jmdowrick](https://github.com/jmdowrick) in [#257](https://github.com/physiomelinks/phlynx/pull/257)
* Add bulk variable type updating by [@jmdowrick](https://github.com/jmdowrick) in [#242](https://github.com/physiomelinks/phlynx/pull/242)


#### Fixed Bugs
* Fix up suffixes for exporting and saving assets by [@hsorby](https://github.com/hsorby) in [#273](https://github.com/physiomelinks/phlynx/pull/273)
* Update parameters when parameters are imported by [@hsorby](https://github.com/hsorby) in [#266](https://github.com/physiomelinks/phlynx/pull/266)
* Suffix for export should change depending on what export is taking place by [@hsorby](https://github.com/hsorby) in [#265](https://github.com/physiomelinks/phlynx/pull/265)
* Rename module after first edit by [@hsorby](https://github.com/hsorby) in [#264](https://github.com/physiomelinks/phlynx/pull/264)


#### Maintenance Work
* Offset notifications off the header  by [@hsorby](https://github.com/hsorby) in [#268](https://github.com/physiomelinks/phlynx/pull/268)
* Add keyboard shortcuts by [@jmdowrick](https://github.com/jmdowrick) in [#267](https://github.com/physiomelinks/phlynx/pull/267)
* Add module config getter to builder store by [@jmdowrick](https://github.com/jmdowrick) in [#261](https://github.com/physiomelinks/phlynx/pull/261)
* Add final module and config files for vital workshop by [@jmdowrick](https://github.com/jmdowrick) in [#252](https://github.com/physiomelinks/phlynx/pull/252)


#### Contributors

<kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd>



---

## v0.2.3
###### Released on 2026-02-10

#### Not Specified
* Temp disable of limited port option selection by [@jmdowrick](https://github.com/jmdowrick) in [#223](https://github.com/physiomelinks/phlynx/pull/223)
* Add report issue link to the work bench by [@jmdowrick](https://github.com/jmdowrick) in [#212](https://github.com/physiomelinks/phlynx/pull/212)
* Fix screenshot bug by [@jmdowrick](https://github.com/jmdowrick) in [#216](https://github.com/physiomelinks/phlynx/pull/216)
* Adjust border of module nodes by [@jmdowrick](https://github.com/jmdowrick) in [#211](https://github.com/physiomelinks/phlynx/pull/211)


#### New Features
* Load resources externally using Jsdelivr by [@hsorby](https://github.com/hsorby) in [#230](https://github.com/physiomelinks/phlynx/pull/230)
* Add tool tips to module node by [@jmdowrick](https://github.com/jmdowrick) in [#210](https://github.com/physiomelinks/phlynx/pull/210)
* Add clear workspace button by [@jmdowrick](https://github.com/jmdowrick) in [#208](https://github.com/physiomelinks/phlynx/pull/208)
* Add edit parameter dialog by [@jmdowrick](https://github.com/jmdowrick) in [#199](https://github.com/physiomelinks/phlynx/pull/199)
* OpenCORr ready link by [@hsorby](https://github.com/hsorby) in [#198](https://github.com/physiomelinks/phlynx/pull/198)


#### Fixed Bugs
* Set variable type for non editable types so they are saved. by [@hsorby](https://github.com/hsorby) in [#238](https://github.com/physiomelinks/phlynx/pull/238) [#225](https://github.com/physiomelinks/phlynx/pull/225)
* Add clear workspace button by [@jmdowrick](https://github.com/jmdowrick) in [#208](https://github.com/physiomelinks/phlynx/pull/208)
* Fix exporting with the wrong extension. by [@hsorby](https://github.com/hsorby) in [#236](https://github.com/physiomelinks/phlynx/pull/236)
* Print purge urls when variable set true. Fix bug when editing moduleswithout config by [@hsorby](https://github.com/hsorby) in [#235](https://github.com/physiomelinks/phlynx/pull/235)
* Fixes bug in garbage collection of CellML WASM by [@hsorby](https://github.com/hsorby) in [#233](https://github.com/physiomelinks/phlynx/pull/233)
* Bug fix positionless vessel array by [@jmdowrick](https://github.com/jmdowrick) in [#228](https://github.com/physiomelinks/phlynx/pull/228)
* Allow shift + space to enter a space in CellML Text Editor. by [@hsorby](https://github.com/hsorby) in [#227](https://github.com/physiomelinks/phlynx/pull/227)
* Add public and private to import parser by [@jmdowrick](https://github.com/jmdowrick) in [#219](https://github.com/physiomelinks/phlynx/pull/219)
* Add edit parameter dialog by [@jmdowrick](https://github.com/jmdowrick) in [#199](https://github.com/physiomelinks/phlynx/pull/199)
* Fix alignment between selection box and module node by [@jmdowrick](https://github.com/jmdowrick) in [#205](https://github.com/physiomelinks/phlynx/pull/205)
* Bug fix module name equivalence check by [@jmdowrick](https://github.com/jmdowrick) in [#204](https://github.com/physiomelinks/phlynx/pull/204)
* Fix bug with using asteisk in version for non-release state by [@hsorby](https://github.com/hsorby) in [#192](https://github.com/physiomelinks/phlynx/pull/192)
* Use changelogs/latest.md to determine if application is not at a release point by [@hsorby](https://github.com/hsorby) in [#189](https://github.com/physiomelinks/phlynx/pull/189)


#### Maintenance Work
* Use syntax highlighting from CellML Text library by [@hsorby](https://github.com/hsorby) in [#208] (https://github.com/physiomelinks/phlynx/pull/208)
* Add select all on ctrl+A command by [@jmdowrick](https://github.com/jmdowrick) in [#201](https://github.com/physiomelinks/phlynx/pull/201)
* Add a workflow to prepare a staging branch for release. by [@hsorby](https://github.com/hsorby) in [#194](https://github.com/physiomelinks/phlynx/pull/194)


#### Contributors

<kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd>



---

## v0.2.2
###### Released on 2026-02-02

#### Fixed Bugs
* Ensure circulatory autogen import checks cellml module source file by [@jmdowrick](https://github.com/jmdowrick) in [#167](https://github.com/physiomelinks/phlynx/pull/167)
* Upgrade cellml-text-editor. by [@hsorby](https://github.com/hsorby) in [#164](https://github.com/physiomelinks/phlynx/pull/164)
* Fix header trimming in import vessel array by [@jmdowrick](https://github.com/jmdowrick) in [#161](https://github.com/physiomelinks/phlynx/pull/161)


#### Documentation Updates
* Add script to combine version specific changelogs. by [@hsorby](https://github.com/hsorby) in [#184](https://github.com/physiomelinks/phlynx/pull/184)


#### Maintenance Work
* Add visual indicator to version number by [@hsorby](https://github.com/hsorby) in [#178](https://github.com/physiomelinks/phlynx/pull/178)
* Add changelogs to the website by [@hsorby](https://github.com/hsorby) in [#174](https://github.com/physiomelinks/phlynx/pull/174)
* Add build details to footer of About page. by [@hsorby](https://github.com/hsorby) in [#172](https://github.com/physiomelinks/phlynx/pull/172)


#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd>



---

## v0.2.1
###### Released on 2026-01-29

#### Fixed Bugs
* Make succesful export message respect export mode. by [@hsorby](https://github.com/hsorby) in [#143](https://github.com/physiomelinks/phlynx/pull/143)
* Fix updating port values on CellML model change by [@hsorby](https://github.com/hsorby) in [#144](https://github.com/physiomelinks/phlynx/pull/144)


#### Documentation Updates
* Update copyright year and owner in LICENSE file by [@hsorby](https://github.com/hsorby) in [#153](https://github.com/physiomelinks/phlynx/pull/153)


#### Contributors

<kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd>


---

## v0.2.0
###### Released on 2026-01-29

#### Not Specified
* Improve cellml text view ux by [@jmdowrick](https://github.com/jmdowrick) in [#134](https://github.com/physiomelinks/phlynx/pull/134)
* Fix layout of module buttons by [@jmdowrick](https://github.com/jmdowrick) in [#114](https://github.com/physiomelinks/phlynx/pull/114)
* Add functionality to edit modules by [@hsorby](https://github.com/hsorby) in [#109](https://github.com/physiomelinks/phlynx/pull/109)
* Minor improvements by [@hsorby](https://github.com/hsorby) in [#108](https://github.com/physiomelinks/phlynx/pull/108)
* Feature omnibus by [@hsorby](https://github.com/hsorby) in [#103](https://github.com/physiomelinks/phlynx/pull/103)
* Update browser phlynx icon by [@jmdowrick](https://github.com/jmdowrick) in [#74](https://github.com/physiomelinks/phlynx/pull/74)
* updating the README for phlynx by [@FinbarArgus](https://github.com/FinbarArgus) in [#72](https://github.com/physiomelinks/phlynx/pull/72)
* Add copy paste functionality for main flow canvas. by [@hsorby](https://github.com/hsorby) in [#59](https://github.com/physiomelinks/phlynx/pull/59)
* Feature docs by [@hsorby](https://github.com/hsorby) in [#58](https://github.com/physiomelinks/phlynx/pull/58)
* Add macro building functionality by [@hsorby](https://github.com/hsorby) in [#57](https://github.com/physiomelinks/phlynx/pull/57)
* Introduce entrance and exit ports to model builder by [@jmdowrick](https://github.com/jmdowrick) in [#56](https://github.com/physiomelinks/phlynx/pull/56)
* Introduce ability to populate workspace using circulatory autogen config files by [@jmdowrick](https://github.com/jmdowrick) in [#55](https://github.com/physiomelinks/phlynx/pull/55)
* Add multi port sum logic by [@jmdowrick](https://github.com/jmdowrick) in [#53](https://github.com/physiomelinks/phlynx/pull/53)
* Feature add png screenshot by [@jmdowrick](https://github.com/jmdowrick) in [#46](https://github.com/physiomelinks/phlynx/pull/46)
* Add controls to workspace area by [@jmdowrick](https://github.com/jmdowrick) in [#36](https://github.com/physiomelinks/phlynx/pull/36)


#### New Features
* Overhaul parameter file handling by [@jmdowrick](https://github.com/jmdowrick) in [#145](https://github.com/physiomelinks/phlynx/pull/145)
* Add template module with a blank component for users to start editing. by [@hsorby](https://github.com/hsorby) in [#128](https://github.com/physiomelinks/phlynx/pull/128)
* Allow users to select multiple options by [@jmdowrick](https://github.com/jmdowrick) in [#61](https://github.com/physiomelinks/phlynx/pull/61)
* Add ability to undo redo some actions by [@hsorby](https://github.com/hsorby) in [#54](https://github.com/physiomelinks/phlynx/pull/54)
* Add snap to grid feature by [@jmdowrick](https://github.com/jmdowrick) in [#47](https://github.com/physiomelinks/phlynx/pull/47)
* Add ability to change modules in place by [@jmdowrick](https://github.com/jmdowrick) in [#37](https://github.com/physiomelinks/phlynx/pull/37)
* Make minimap interactable by [@jmdowrick](https://github.com/jmdowrick) in [#35](https://github.com/physiomelinks/phlynx/pull/35)
* Add a visual indicator to highlighted region by [@jmdowrick](https://github.com/jmdowrick) in [#33](https://github.com/physiomelinks/phlynx/pull/33)
* Add non-editable label to module nodes by [@jmdowrick](https://github.com/jmdowrick) in [#23](https://github.com/physiomelinks/phlynx/pull/23)


#### Fixed Bugs
* Bug fix import solo parameter file by [@jmdowrick](https://github.com/jmdowrick) in [#150](https://github.com/physiomelinks/phlynx/pull/150)
* Fix parameter file handling during CA config export by [@jmdowrick](https://github.com/jmdowrick) in [#129](https://github.com/physiomelinks/phlynx/pull/129)
* Fix module editing when mutliple math documents are present. by [@hsorby](https://github.com/hsorby) in [#117](https://github.com/physiomelinks/phlynx/pull/117)
* Fix module config to have correct format by [@jmdowrick](https://github.com/jmdowrick) in [#112](https://github.com/physiomelinks/phlynx/pull/112)
* Update documentation UX and populate with updated features by [@jmdowrick](https://github.com/jmdowrick) in [#102](https://github.com/physiomelinks/phlynx/pull/102)
* Adjust module node height minimum  by [@jmdowrick](https://github.com/jmdowrick) in [#44](https://github.com/physiomelinks/phlynx/pull/44)
* Make Delete delete again by [@jmdowrick](https://github.com/jmdowrick) in [#45](https://github.com/physiomelinks/phlynx/pull/45)
* Bug fix node deletion tracking by [@jmdowrick](https://github.com/jmdowrick) in [#43](https://github.com/physiomelinks/phlynx/pull/43)
* Prevent drag when editing module node by [@jmdowrick](https://github.com/jmdowrick) in [#31](https://github.com/physiomelinks/phlynx/pull/31)


#### Documentation Updates
* Update documentation to reflect new v0.2.0 features by [@jmdowrick](https://github.com/jmdowrick) in [#135](https://github.com/physiomelinks/phlynx/pull/135)


#### Maintenance Work
* Add user tracking with Google tag events by [@hsorby](https://github.com/hsorby) in [#141](https://github.com/physiomelinks/phlynx/pull/141)
* Moving to custom domain doesn't require the base url to be set. by [@hsorby](https://github.com/hsorby) in [#132](https://github.com/physiomelinks/phlynx/pull/132)
* Finish rebranding to PhLynx by [@hsorby](https://github.com/hsorby) in [#105](https://github.com/physiomelinks/phlynx/pull/105)
* Update documentation UX and populate with updated features by [@jmdowrick](https://github.com/jmdowrick) in [#102](https://github.com/physiomelinks/phlynx/pull/102)
* Update from yarn v1.22.x to yarn v4.12.0 by [@jmdowrick](https://github.com/jmdowrick) in [#69](https://github.com/physiomelinks/phlynx/pull/69)


#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/FinbarArgus">
    <img src="https://avatars.githubusercontent.com/u/64084030?v=4&s=100" width="50" height="50"><br>
    <sub>@FinbarArgus</sub>
  </a>
</kbd>


---

## v0.1.0
###### Released on 2025-10-30

#### Not Specified
* Increase workspace size and zoom out limit by [@jmdowrick](https://github.com/jmdowrick) in [#20](https://github.com/physiomelinks/phlynx/pull/20)
* Consider all connected nodes to determine if a port is a multi port. by [@hsorby](https://github.com/hsorby) in [#19](https://github.com/physiomelinks/phlynx/pull/19)
* Improve global constant, and constant detection. by [@hsorby](https://github.com/hsorby) in [#16](https://github.com/physiomelinks/phlynx/pull/16)
* Add extra clarification around what it means to be a constant variable. by [@hsorby](https://github.com/hsorby) in [#14](https://github.com/physiomelinks/phlynx/pull/14)
* Fix export of variables in general ports. by [@hsorby](https://github.com/hsorby) in [#13](https://github.com/physiomelinks/phlynx/pull/13)


#### Contributors

<kbd>
  <a href="https://github.com/jmdowrick">
    <img src="https://avatars.githubusercontent.com/u/146781982?u=94c7295b017c61161e81ba34c929524b31a423c2&v=4&s=100" width="50" height="50"><br>
    <sub>@jmdowrick</sub>
  </a>
</kbd> <kbd>
  <a href="https://github.com/hsorby">
    <img src="https://avatars.githubusercontent.com/u/778048?u=31d6ee5b17c95630c61a61e7cfe0c008b138b769&v=4&s=100" width="50" height="50"><br>
    <sub>@hsorby</sub>
  </a>
</kbd>


---
