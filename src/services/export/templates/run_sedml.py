#!/usr/bin/env python3
"""
Runs a protocol that PhLynx exported: reads protocol.sedml (SED-ML Level 1 Version 4) with libsedml, simulates its
CellML model with Myokit, and writes the document's plots, reports and a summary of the run.

PhLynx writes each experiment of a protocol as nested repeated tasks whose sub-tasks change the model as they go.
libOpenCOR will run protocol.sedml directly once it supports RepeatedTask; until then this script runs the part of
SED-ML that PhLynx writes: CellML 2.0 models, uniform time courses on CVODE, nested repeated tasks (vector, uniform
and functional ranges in lockstep; set values on repeated tasks and on sub-tasks), data generators with dimension
terms, 2D plots, figures, styles and reports. Anything else stops it with a message saying what isn't supported.

One reading goes beyond the standard: a uniform time course whose output starts where it ends gives exactly one point,
at that time. PhLynx writes a segment that keeps only its last point this way (its sub-task's id ends with `_single`).

Usage:
    python run_sedml.py [protocol.sedml] [--out DIR] [--no-show] [--format png,svg,pdf] [--dpi N] [--verbose]

Exits 2 when the document or its model can't be run (or a package in requirements.txt isn't installed), and 1 when
a simulation fails.
"""
import argparse
import ast
import difflib
import json
import logging
import math
import operator
import os
import platform
import re
import sys
import time
import traceback
import xml.etree.ElementTree as ElementTree

try:
    import libsedml
    import matplotlib
    import matplotlib.figure
    import myokit
    import numpy as np
    import pandas as pd
    import seaborn as sns
    from myokit.formats.cellml import v2 as cellml
except ImportError as missing:
    print(f"error: the Python package {missing.name} isn't installed. Install what this script needs with:\n"
          "    pip install -r requirements.txt\n(see README.md: Myokit also needs a C compiler and SUNDIALS).",
          file=sys.stderr)
    sys.exit(2)

log = logging.getLogger("run_sedml")

CVODE = "KISAO:0000019"
REL_TOL, ABS_TOL, MAX_STEP, MAX_STEPS, METHOD = (f"KISAO:0000{n}" for n in (209, 211, 467, 415, 475))
TIME_SYMBOLS = {"KISAO:0000832", "urn:sedml:symbol:time"}


def exact_mean(values):
    """The mean, summed without rounding error, so a constant's mean is that constant."""
    return math.fsum(values) / len(values)


# KiSAO aggregation functions (children of KISAO:0000824) a dimensionTerm may name.
REDUCTIONS = {
    "KISAO:0000841": exact_mean, "KISAO:0000825": np.nanmean, "KISAO:0000830": np.max, "KISAO:0000828": np.nanmax,
    "KISAO:0000840": np.min, "KISAO:0000829": np.nanmin, "KISAO:0000845": np.sum, "KISAO:0000844": np.nansum,
    "KISAO:0000857": np.median, "KISAO:0000856": np.nanmedian, "KISAO:0000842": np.std, "KISAO:0000826": np.nanstd,
    "KISAO:0000859": np.var, "KISAO:0000858": np.nanvar, "KISAO:0000847": np.prod, "KISAO:0000846": np.nanprod,
}
XPATH = re.compile(r"""^/\w+:model/\w+:component\[@name=(['"])(?P<c>[^'"]+)\1\]/\w+:variable\[@name=(['"])(?P<v>[^'"]+)\3\]$""")
LINES = {libsedml.SEDML_LINETYPE_SOLID: "-", libsedml.SEDML_LINETYPE_DASH: "--", libsedml.SEDML_LINETYPE_DOT: ":",
         libsedml.SEDML_LINETYPE_DASHDOT: "-.", libsedml.SEDML_LINETYPE_DASHDOTDOT: (0, (3, 1, 1, 1, 1, 1)),
         libsedml.SEDML_LINETYPE_NONE: "None"}
MARKERS = {libsedml.SEDML_MARKERTYPE_CIRCLE: "o", libsedml.SEDML_MARKERTYPE_SQUARE: "s",
           libsedml.SEDML_MARKERTYPE_TRIANGLEUP: "^", libsedml.SEDML_MARKERTYPE_TRIANGLEDOWN: "v",
           libsedml.SEDML_MARKERTYPE_TRIANGLELEFT: "<", libsedml.SEDML_MARKERTYPE_TRIANGLERIGHT: ">",
           libsedml.SEDML_MARKERTYPE_DIAMOND: "D", libsedml.SEDML_MARKERTYPE_PLUS: "+",
           libsedml.SEDML_MARKERTYPE_XCROSS: "x", libsedml.SEDML_MARKERTYPE_STAR: "*",
           libsedml.SEDML_MARKERTYPE_HDASH: "_", libsedml.SEDML_MARKERTYPE_VDASH: "|", libsedml.SEDML_MARKERTYPE_NONE: "None"}

FUNCTIONS = {"abs": np.abs, "exp": np.exp, "ln": np.log, "log10": np.log10, "sqrt": np.sqrt, "floor": np.floor,
             "ceil": np.ceil, "sin": np.sin, "cos": np.cos, "tan": np.tan, "pow": np.power, "sum": np.sum,
             "product": np.prod, "max": lambda *a: np.max(a[0]) if len(a) == 1 else np.maximum.reduce(a),
             "min": lambda *a: np.min(a[0]) if len(a) == 1 else np.minimum.reduce(a),
             "log": lambda *a: np.log10(a[0]) if len(a) == 1 else np.log(a[1]) / np.log(a[0])}
CONSTANTS = {"pi": np.pi, "exponentiale": np.e, "true": True, "false": False, "INF": np.inf, "NaN": np.nan}
OPERATORS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
             ast.Pow: operator.pow, ast.Mod: np.mod, ast.USub: operator.neg, ast.UAdd: operator.pos,
             ast.Not: np.logical_not, ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt,
             ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge}


class DocumentError(Exception):
    """A document or model this script can't run (exit 2)."""


class RunError(Exception):
    """A simulation that failed (exit 1)."""


def children(element, name: str) -> list:
    """Lists a libsedml element's children of one kind, e.g. children(task, 'SubTask')."""
    return [getattr(element, f"get{name}")(i) for i in range(getattr(element, f"getNum{name}s")())]


def evaluate_math(math, names: dict, where: str):
    """Evaluates a MathML formula on numbers or numpy arrays, allowing only arithmetic, comparisons and FUNCTIONS."""
    formula = libsedml.formulaToL3String(math) if math is not None else None
    if not formula:
        raise DocumentError(f"{where} has no math.")
    source = re.sub(r"!(?!=)", " not ", formula.replace("^", "**").replace("&&", " and ").replace("||", " or "))

    def value(node):
        """Evaluates one node of the parsed formula."""
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id in names:
                return names[node.id]
            if node.id in CONSTANTS:
                return CONSTANTS[node.id]
            raise DocumentError(f"{where}: its math uses '{node.id}', which it doesn't define.")
        if isinstance(node, ast.BinOp) and type(node.op) in OPERATORS:
            return OPERATORS[type(node.op)](value(node.left), value(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in OPERATORS:
            return OPERATORS[type(node.op)](value(node.operand))
        if isinstance(node, ast.Compare) and all(type(op) in OPERATORS for op in node.ops):
            sides = [value(node.left)] + [value(n) for n in node.comparators]
            return np.logical_and.reduce([OPERATORS[type(op)](a, b) for op, a, b in zip(node.ops, sides, sides[1:])])
        if isinstance(node, ast.BoolOp):
            join = np.logical_and if isinstance(node.op, ast.And) else np.logical_or
            return join.reduce([value(n) for n in node.values])
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            args = [value(n) for n in node.args]
            if node.func.id == "piecewise":
                return np.select([np.asarray(c, bool) for c in args[1::2]], args[0:-1:2], args[-1] if len(args) % 2 else np.nan)
            if node.func.id in FUNCTIONS:
                return FUNCTIONS[node.func.id](*args)
        raise DocumentError(f"{where}: its math '{formula}' uses something this script doesn't support.")

    try:
        return value(ast.parse(source, mode="eval").body)
    except SyntaxError:
        raise DocumentError(f"{where}: can't read its math '{formula}'.") from None


def load_document(path: str):
    """Reads a SED-ML document, checks what this script needs of it, and returns it with each repeated task's concatenate."""
    if not os.path.isfile(path):
        raise DocumentError(f"Can't find {path}.")
    doc = libsedml.readSedMLFromFile(path)
    errors = []
    for error in children(doc, "Error"):
        message = f"{os.path.basename(path)}, line {error.getLine()}: {error.getMessage().strip()}"
        (errors.append(message) if error.getSeverity() >= libsedml.LIBSEDML_SEV_ERROR else log.warning(message))
    if errors:
        raise DocumentError("libsedml can't read the document:\n  " + "\n  ".join(errors))
    # libsedml can lose concatenate on read, so take it from the XML itself.
    concatenate = {el.get("id"): el.get("concatenate", "false").strip() in ("true", "1")
                   for el in ElementTree.parse(path).getroot().iter() if el.tag.rsplit("}", 1)[-1] == "repeatedTask"}
    problems = check_document(doc, os.path.dirname(os.path.abspath(path)))
    if problems:
        raise DocumentError("The document can't be run:\n  " + "\n  ".join(problems))
    return doc, concatenate


def check_document(doc, folder: str) -> list[str]:
    """Cross-checks the document's ids and lists what it uses that this script can't run."""
    problems = []
    models = {m.getId() for m in doc.getListOfModels()}
    sims = {s.getId() for s in doc.getListOfSimulations()}
    tasks = {t.getId(): t for t in doc.getListOfTasks()}
    dgs = {d.getId() for d in doc.getListOfDataGenerators()}
    outputs = {o.getId(): o for o in doc.getListOfOutputs()}
    styles = {s.getId(): s for s in doc.getListOfStyles()}
    for model in doc.getListOfModels():
        if "cellml" not in model.getLanguage():
            problems.append(f"Model '{model.getId()}' isn't CellML ({model.getLanguage() or 'no language'}).")
        if model.getNumChanges():
            problems.append(f"Model '{model.getId()}' has changes, which this script doesn't support.")
        if not os.path.isfile(os.path.join(folder, model.getSource())):
            problems.append(f"Model '{model.getId()}': can't find its source '{model.getSource()}'.")
    if len(models) != 1:
        problems.append(f"This script runs documents with one model; this one has {len(models)}.")
    for sim in doc.getListOfSimulations():
        if not isinstance(sim, libsedml.SedUniformTimeCourse):
            problems.append(f"Simulation '{sim.getId()}' is a {sim.getElementName()}; only uniformTimeCourse is supported.")
    for task in tasks.values():
        where = f"Task '{task.getId()}'"
        if isinstance(task, libsedml.SedRepeatedTask):
            ranges = children(task, "Range")
            if task.getRangeId() not in {r.getId() for r in ranges}:
                problems.append(f"{where}: its range '{task.getRangeId()}' isn't one of its ranges.")
            problems += [f"{where}: {r.getElementName()} isn't supported." for r in ranges if isinstance(r, libsedml.SedDataRange)]
            problems += [f"{where}: sub-task '{s.getId()}' runs '{s.getTask()}', which isn't a task."
                         for s in children(task, "SubTask") if s.getTask() not in tasks]
            changes = children(task, "TaskChange") + [c for s in children(task, "SubTask") for c in children(s, "TaskChange")]
            for change in changes:
                if not isinstance(change, libsedml.SedSetValue):
                    problems.append(f"{where}: {change.getElementName()} isn't supported; only setValue is.")
                elif change.getModelReference() not in models:
                    problems.append(f"{where}: a setValue changes '{change.getModelReference()}', which isn't a model.")
        elif type(task) is libsedml.SedTask:
            if task.getModelReference() not in models or task.getSimulationReference() not in sims:
                problems.append(f"{where}: its model or simulation isn't in the document.")
        else:
            problems.append(f"{where} is a {task.getElementName()}, which isn't supported.")
    problems += [f"Task '{t}' runs itself through its sub-tasks." for t in tasks if reaches(tasks, t, t, set())]
    for dg in doc.getListOfDataGenerators():
        for var in dg.getListOfVariables():
            where = f"Data generator '{dg.getId()}', variable '{var.getId()}'"
            if var.getTaskReference() not in tasks:
                problems.append(f"{where}: its task '{var.getTaskReference()}' isn't in the document.")
            if not var.isSetTarget() and var.getSymbol() not in TIME_SYMBOLS:
                problems.append(f"{where}: needs a target or the time symbol.")
            if var.isSetDimensionTerm() and var.getDimensionTerm() not in REDUCTIONS:
                problems.append(f"{where}: the dimensionTerm {var.getDimensionTerm()} isn't supported.")
    for output in outputs.values():
        where = f"Output '{output.getId()}'"
        if isinstance(output, libsedml.SedPlot2D):
            for curve in output.getListOfCurves():
                if curve.getXDataReference() not in dgs or curve.getYDataReference() not in dgs:
                    problems.append(f"{where}: curve '{curve.getId()}' plots a data generator that isn't in the document.")
                if curve.isSetStyle() and curve.getStyle() not in styles:
                    problems.append(f"{where}: curve '{curve.getId()}' has the style '{curve.getStyle()}', which isn't defined.")
        elif isinstance(output, libsedml.SedFigure):
            problems += [f"{where}: sub-plot of '{s.getPlot()}', which isn't a 2D plot." for s in output.getListOfSubPlots()
                         if not isinstance(outputs.get(s.getPlot()), libsedml.SedPlot2D)]
        elif isinstance(output, libsedml.SedReport):
            problems += [f"{where}: dataset '{s.getId()}' reports a data generator that isn't in the document."
                         for s in output.getListOfDataSets() if s.getDataReference() not in dgs]
        else:
            problems.append(f"{where} is a {output.getElementName()}, which isn't supported.")
    problems += [f"Style '{s.getId()}': its base style '{s.getBaseStyle()}' isn't defined."
                 for s in styles.values() if s.isSetBaseStyle() and s.getBaseStyle() not in styles]
    return problems


def reaches(tasks: dict, start: str, goal: str, seen: set) -> bool:
    """Whether the task 'start' runs the task 'goal' through its sub-tasks."""
    task = tasks.get(start)
    if not isinstance(task, libsedml.SedRepeatedTask) or start in seen:
        return False
    seen.add(start)
    return any(s.getTask() == goal or reaches(tasks, s.getTask(), goal, seen) for s in children(task, "SubTask"))


def load_model(path: str):
    """Imports a CellML 2.0 model into Myokit, returning the Myokit model and the CellML one it came from."""
    try:
        source = cellml.parse_file(path)
        return source.myokit_model(), source
    except Exception as error:
        raise DocumentError(f"Myokit can't import {os.path.basename(path)}: {error}") from error


def resolve_target(target: str, model, source) -> str:
    """Maps a CellML XPath target to its Myokit qname, through the variable's CellML equivalences."""
    match = XPATH.match(target.strip())
    if not match:
        raise DocumentError(f"Can't read the target {target}: expected "
                            "/cellml:model/cellml:component[@name='c']/cellml:variable[@name='v'].")
    name, variable = match["c"], match["v"]
    try:
        found = source.component(name).variable(variable)
    except KeyError:
        known = [f"{c.name()}/{v.name()}" for c in source.components() for v in c.variables()]
        close = difflib.get_close_matches(f"{name}/{variable}", known, n=3)
        hint = f" Did you mean {' or '.join(close)}?" if close else ""
        raise DocumentError(f"The model has no variable {name}/{variable} (target {target}).{hint}") from None
    members, queue = [found], [found]
    while queue:  # Myokit keeps one member of each equivalence set, so look through the set.
        for other in queue.pop().connected_variables():
            if other not in members:
                members.append(other)
                queue.append(other)
    for member in members:
        qname = f"{member.component().name()}.{member.name()}"
        if model.has_variable(qname):
            return qname
    raise DocumentError(f"Myokit's model has no variable for {name}/{variable}.")


class Runner:
    """Runs a document's tasks on one Myokit simulation, keeping each task's outputs."""

    def __init__(self, doc, model, source, concatenate: dict):
        """Resolves every target in the document and compiles the model."""
        self.doc, self.model, self.concatenate = doc, model, concatenate
        self.time = model.time().qname()
        self.states = {v.qname(): i for i, v in enumerate(model.states())}
        self.defaults = {v.qname(): float(v.eval()) for v in model.variables(deep=True) if v.is_literal()}
        self.constants = dict(self.defaults)
        targets = [v.getTarget() for d in doc.getListOfDataGenerators() for v in d.getListOfVariables() if v.isSetTarget()]
        for task in doc.getListOfTasks():
            for change in self.changes_of(task) + [c for s in self.subtasks_of(task) for c in self.changes_of(s)]:
                targets += [change.getTarget()] + [v.getTarget() for v in change.getListOfVariables() if v.isSetTarget()]
            if isinstance(task, libsedml.SedRepeatedTask):
                targets += [v.getTarget() for r in children(task, "Range") if isinstance(r, libsedml.SedFunctionalRange)
                            for v in r.getListOfVariables() if v.isSetTarget()]
        self.targets = {t: resolve_target(t, model, source) for t in dict.fromkeys(targets)}
        logged = [self.time] + [self.targets[v.getTarget()] for d in doc.getListOfDataGenerators()
                                for v in d.getListOfVariables() if v.isSetTarget()]
        self.logged = list(dict.fromkeys(logged))
        self.dynamic = [q for q in self.logged if q == self.time or q in self.states or not model.get(q).is_constant()]
        self.order = [eq for eqs in model.solvable_order().values() for eq in eqs]
        self.results, self.warned = {}, set()
        log.info("Compiling the model")
        self.sim = myokit.Simulation(model)

    @staticmethod
    def subtasks_of(task) -> list:
        """A repeated task's sub-tasks in their order (none for a plain task)."""
        subtasks = children(task, "SubTask") if isinstance(task, libsedml.SedRepeatedTask) else []
        return sorted(subtasks, key=lambda s: s.getOrder() if s.isSetOrder() else 0)

    @staticmethod
    def changes_of(element) -> list:
        """A repeated task's or sub-task's set values."""
        return children(element, "TaskChange") if hasattr(element, "getNumTaskChanges") else []

    def reset(self):
        """Puts the simulation back to the model's own time, states and constants."""
        self.sim.reset()
        for qname, value in self.defaults.items():
            if self.constants[qname] != value:
                self.sim.set_constant(qname, value)
        self.constants = dict(self.defaults)

    def value_of(self, qname: str) -> float:
        """The current value of a model variable."""
        if qname in self.states:
            return self.sim.state()[self.states[qname]]
        if qname in self.constants:
            return self.constants[qname]
        return self.sim.time() if qname == self.time else self.evaluate_now()[qname]

    def set_value(self, qname: str, value) -> None:
        """Sets a state or a constant of the model."""
        value = float(np.asarray(value).reshape(-1)[-1])
        if qname in self.states:
            state = self.sim.state()
            state[self.states[qname]] = value
            self.sim.set_state(state)
        elif qname in self.constants:
            self.sim.set_constant(qname, value)
            self.constants[qname] = value
        else:
            raise DocumentError(f"{qname} is computed by the model, so a setValue can't set it.")

    def apply_changes(self, element, ranges: dict) -> None:
        """Applies an element's set values, whose math may use the ranges' current values and its own variables."""
        for change in self.changes_of(element):
            names = dict(ranges) | {p.getId(): p.getValue() for p in change.getListOfParameters()}
            for var in change.getListOfVariables():
                names[var.getId()] = self.sim.time() if var.getSymbol() in TIME_SYMBOLS else self.value_of(self.targets[var.getTarget()])
            where = f"The setValue of {change.getTarget()} in '{element.getId()}'"
            self.set_value(self.targets[change.getTarget()], evaluate_math(change.getMath(), names, where))

    def evaluate_now(self) -> dict:
        """Evaluates every model variable at the simulation's current time and state."""
        t, state = self.sim.time(), self.sim.state()
        subst = {myokit.Name(self.model.time()): t}
        derivatives = self.sim.evaluate_derivatives(state, {"time": t})
        for var, x, dx in zip(self.model.states(), state, derivatives):
            subst[myokit.Name(var)] = x
            subst[myokit.Derivative(myokit.Name(var))] = dx
        subst |= {myokit.Name(self.model.get(q)): x for q, x in self.constants.items()}
        for eq in self.order:
            if eq.lhs not in subst:
                subst[eq.lhs] = float(eq.rhs.eval(subst=subst))
        return {lhs.var().qname(): x for lhs, x in subst.items() if isinstance(lhs, myokit.Name)}

    def run_time_course(self, sim) -> dict:
        """Runs a uniform time course from its initial time, returning the logged variables at its output points."""
        self.configure(sim)
        t0, start, end = sim.getInitialTime(), sim.getOutputStartTime(), sim.getOutputEndTime()
        # A time course whose output starts where it ends gives one point, at its end (see the module's docstring).
        points = np.array([end]) if start == end else np.linspace(start, end, sim.getNumberOfSteps() + 1)
        self.sim.set_time(t0)
        logged = None
        if end > t0:
            inside = points[:-1]  # Myokit logs at times before the end; the end point is evaluated after the run.
            logged = self.sim.run(end - t0, log=self.dynamic if len(inside) else myokit.LOG_NONE,
                                  log_times=inside if len(inside) else None)
        computed = any(q not in self.states and q not in self.constants and q != self.time for q in self.logged)
        at_end = self.evaluate_now() if computed else {}
        out = {}
        for qname in self.logged:
            last = self.value_of(qname) if qname not in at_end else at_end[qname]
            if qname in self.dynamic and len(points) > 1:
                out[qname] = np.append(np.asarray(logged[qname], float), last)
            else:
                out[qname] = np.full(len(points), float(last))
        return out

    def configure(self, sim) -> None:
        """Applies a simulation's algorithm and its parameters to Myokit's CVODE."""
        algorithm = sim.getAlgorithm()
        if algorithm.getKisaoID() != CVODE and algorithm.getKisaoID() not in self.warned:
            self.warned.add(algorithm.getKisaoID())
            log.warning(f"Myokit runs {algorithm.getKisaoID()} as CVODE ({CVODE}).")
        params = {p.getKisaoID(): p.getValue() for p in algorithm.getListOfAlgorithmParameters()}
        self.sim.set_tolerance(abs_tol=float(params.get(ABS_TOL, 1e-6)), rel_tol=float(params.get(REL_TOL, 1e-4)))
        max_step = float(params.get(MAX_STEP, 0))
        self.sim.set_max_step_size(max_step if max_step > 0 else None)
        if params.get(METHOD, "BDF").upper() != "BDF" and METHOD not in self.warned:
            self.warned.add(METHOD)
            log.warning(f"Myokit's CVODE integrates with BDF, not {params[METHOD]}.")

    def range_values(self, task, index: int) -> dict:
        """The value of each of a repeated task's ranges at one iteration."""
        values = {}
        for rng in sorted(children(task, "Range"), key=lambda r: isinstance(r, libsedml.SedFunctionalRange)):
            if isinstance(rng, libsedml.SedFunctionalRange):
                names = dict(values) | {p.getId(): p.getValue() for p in rng.getListOfParameters()}
                names |= {v.getId(): self.value_of(self.targets[v.getTarget()]) for v in rng.getListOfVariables()}
                values[rng.getId()] = evaluate_math(rng.getMath(), names, f"Range '{rng.getId()}'")
            else:
                points = self.points_of(rng)
                if index >= len(points):
                    raise DocumentError(f"Range '{rng.getId()}' is shorter than '{task.getRangeId()}'.")
                values[rng.getId()] = points[index]
        return values

    @staticmethod
    def points_of(rng) -> list:
        """A vector or uniform range's values."""
        if isinstance(rng, libsedml.SedVectorRange):
            return list(rng.getValues())
        steps = rng.getNumberOfSteps() if rng.isSetNumberOfSteps() else rng.getNumberOfPoints()
        space = np.geomspace if rng.getType() == "log" else np.linspace
        return list(space(rng.getStart(), rng.getEnd(), steps + 1))

    def execute_task(self, task_id: str) -> dict:
        """Runs a task (repeating it as its ranges say), records its outputs under its id, and returns them."""
        task = self.doc.getTask(task_id)
        if not isinstance(task, libsedml.SedRepeatedTask):
            out = self.run_time_course(self.doc.getSimulation(task.getSimulationReference()))
        else:
            master = next(r for r in children(task, "Range") if r.getId() == task.getRangeId())
            count = len(self.points_of(master)) if not isinstance(master, libsedml.SedFunctionalRange) else 1
            if not self.concatenate.get(task_id, False) and task_id not in self.warned:
                self.warned.add(task_id)
                log.warning(f"Repeated task '{task_id}' doesn't concatenate; this script joins its outputs anyway.")
            chunks = []
            for index in range(count):
                if task.getResetModel():
                    self.reset()
                ranges = self.range_values(task, index)
                self.apply_changes(task, ranges)
                for subtask in self.subtasks_of(task):
                    self.apply_changes(subtask, ranges)
                    chunks.append(self.execute_task(subtask.getTask()))
            out = {q: np.concatenate([c[q] for c in chunks]) for q in self.logged} if chunks else {}
        self.results.setdefault(task_id, []).append(out)
        return out

    def run(self) -> None:
        """Runs every task that no repeated task runs as a sub-task, in document order."""
        nested = {s.getTask() for t in self.doc.getListOfTasks() for s in self.subtasks_of(t)}
        for task in self.doc.getListOfTasks():
            if task.getId() not in nested:
                log.info(f"Running {task.getId()}")
                try:
                    self.execute_task(task.getId())
                except myokit.SimulationError as error:
                    raise RunError(f"Task '{task.getId()}' failed: {error}") from error

    def result(self, task_id: str) -> dict:
        """A task's outputs, joined over every time it ran."""
        runs = [r for r in self.results.get(task_id, []) if r]
        if not runs:
            raise RunError(f"Task '{task_id}' produced no output.")
        return {q: np.concatenate([r[q] for r in runs]) for q in runs[0]}


def evaluate_data_generators(doc, runner: Runner) -> dict:
    """Evaluates each data generator on the tasks' outputs, reducing variables that have a dimensionTerm."""
    data = {}
    for dg in doc.getListOfDataGenerators():
        names = {p.getId(): p.getValue() for p in dg.getListOfParameters()}
        for var in dg.getListOfVariables():
            output = runner.result(var.getTaskReference())
            values = output[runner.time if var.getSymbol() in TIME_SYMBOLS else runner.targets[var.getTarget()]]
            names[var.getId()] = REDUCTIONS[var.getDimensionTerm()](values) if var.isSetDimensionTerm() else values
        value = evaluate_math(dg.getMath(), names, f"Data generator '{dg.getId()}'")
        data[dg.getId()] = np.atleast_1d(np.asarray(value, float))
    return data


def resolve_style(doc, style_id: str) -> dict:
    """A curve's style with its base styles' attributes filled in."""
    chain, seen = [], set()
    while style_id and style_id not in seen and doc.getStyle(style_id) is not None:
        seen.add(style_id)
        chain.insert(0, doc.getStyle(style_id))
        style_id = chain[0].getBaseStyle() if chain[0].isSetBaseStyle() else None
    out = {}
    for style in chain:
        line, marker = style.getLineStyle(), style.getMarkerStyle()
        if style.isSetLineStyle():
            out |= {k: f() for k, s, f in (("line", line.isSetType, line.getType), ("color", line.isSetColor, line.getColor),
                                            ("width", line.isSetThickness, line.getThickness)) if s()}
        if style.isSetMarkerStyle():
            out |= {k: f() for k, s, f in (("marker", marker.isSetType, marker.getType), ("size", marker.isSetSize, marker.getSize),
                                            ("fill", marker.isSetFill, marker.getFill),
                                            ("edge", marker.isSetLineColor, marker.getLineColor)) if s()}
    return out


def colour(hex_code):
    """A SED-ML colour (RRGGBB or RRGGBBAA) for matplotlib."""
    return f"#{hex_code}" if hex_code else None


def draw_plot(ax, plot, doc, data: dict) -> list:
    """Draws a 2D plot's curves on an axis, returning its curves as tidy rows."""
    rows, joined = [], {}
    for curve in plot.getListOfCurves():
        x, y = np.broadcast_arrays(data[curve.getXDataReference()], data[curve.getYDataReference()])
        style = resolve_style(doc, curve.getStyle()) if curve.isSetStyle() else {}
        name = curve.getName() or curve.getId()
        rows += [{"output": plot.getId(), "curve": curve.getId(), "name": name, "index": i, "x": a, "y": b}
                 for i, (a, b) in enumerate(zip(x, y))]
        line = LINES.get(style.get("line", libsedml.SEDML_LINETYPE_SOLID), "-")
        marker = MARKERS.get(style.get("marker", libsedml.SEDML_MARKERTYPE_NONE), "None")
        kw = {"color": colour(style.get("color")), "linewidth": style.get("width", 1.5), "markersize": style.get("size", 6),
              "markerfacecolor": colour(style.get("fill")), "markeredgecolor": colour(style.get("edge"))}
        if len(x) == 1:
            # The join rule: single points whose line style is the same are drawn as one line, sorted by x.
            if line != "None":
                joined.setdefault((line, kw["color"], kw["linewidth"]), []).append((x[0], y[0]))
            kw["color"] = kw["markerfacecolor"] or kw["color"]
            ax.plot(x, y, linestyle="None", marker=marker if marker != "None" else "o", label=name, zorder=3, **kw)
        else:
            ax.plot(x, y, linestyle=line, marker=marker if marker != "None" or line != "None" else "o", label=name, **kw)
    for (line, color, width), points in joined.items():
        if len(points) > 1:
            xs, ys = zip(*sorted(points))
            ax.plot(xs, ys, linestyle=line, color=color or "0.5", linewidth=width, zorder=2)
    for axis, set_label, set_scale, set_lim in ((plot.getXAxis(), ax.set_xlabel, ax.set_xscale, ax.set_xlim),
                                                (plot.getYAxis(), ax.set_ylabel, ax.set_yscale, ax.set_ylim)):
        if axis is not None:
            set_label(axis.getName())
            if axis.getType() == libsedml.SEDML_AXISTYPE_LOG10:
                set_scale("log")
            set_lim(axis.getMin() if axis.isSetMin() else None, axis.getMax() if axis.isSetMax() else None)
    ax.set_title(plot.getName() or plot.getId())
    if plot.getLegend() if plot.isSetLegend() else plot.getNumCurves() > 1:
        # One entry per name: a series' experiments share theirs. Traces fill the axes, so theirs goes beside them.
        handles, labels = ax.get_legend_handles_labels()
        unique = dict(zip(labels, handles))
        traced = len(rows) > plot.getNumCurves()
        place = {"loc": "upper left", "bbox_to_anchor": (1.02, 1)} if traced else {"loc": "best"}
        ax.legend(unique.values(), unique.keys(), frameon=False, fontsize="small", **place)
    return rows


def plot_outputs(doc, data: dict, out_dir: str, formats: list[str], dpi: int, show: bool):
    """Draws each 2D plot that isn't in a figure, and each figure as a grid, saving them in every format."""
    import matplotlib.pyplot as plt

    sns.set_theme(context="paper", style="ticks")
    in_figures = {s.getPlot() for o in doc.getListOfOutputs() if isinstance(o, libsedml.SedFigure) for s in o.getListOfSubPlots()}
    rows, files = [], []
    for output in doc.getListOfOutputs():
        if isinstance(output, libsedml.SedPlot2D) and output.getId() not in in_figures:
            fig, ax = plt.subplots(figsize=(5, 3.5), layout="constrained")
            rows += draw_plot(ax, output, doc, data)
            legend = ax.get_legend()
            if legend is not None and legend.get_bbox_to_anchor().x0 > ax.get_window_extent().x1:
                # Widen the figure by its legend beside the axes, so the axes keep their width.
                fig.set_figwidth(5 + legend.get_window_extent(fig.canvas.get_renderer()).width / fig.dpi)
        elif isinstance(output, libsedml.SedFigure):
            nrows, ncols = output.getNumRows(), output.getNumCols()
            fig, axes = plt.subplots(nrows, ncols, figsize=(4.2 * ncols, 3 * nrows), squeeze=False, layout="constrained")
            used = set()
            for sub in output.getListOfSubPlots():
                ax = axes[sub.getRow() - 1][sub.getCol() - 1]
                rows += draw_plot(ax, doc.getOutput(sub.getPlot()), doc, data)
                used.add(ax)
            for ax in axes.flat:
                ax.set_visible(ax in used)
        else:
            continue
        sns.despine(fig=fig)
        for fmt in formats:
            files.append(os.path.join(out_dir, f"{output.getId()}.{fmt}"))
            fig.savefig(files[-1], dpi=dpi)
        log.info(f"Wrote {output.getId()}")
    if show:
        plt.show()
    plt.close("all")
    return rows, files


def write_reports(doc, data: dict, rows: list, out_dir: str) -> list[str]:
    """Writes each report as a CSV (one column per dataset, by id) and the plotted curves as a tidy traces.csv."""
    files = []
    for report in (o for o in doc.getListOfOutputs() if isinstance(o, libsedml.SedReport)):
        table = pd.DataFrame({s.getId(): pd.Series(data[s.getDataReference()]) for s in report.getListOfDataSets()})
        files.append(os.path.join(out_dir, f"{report.getId()}.csv"))
        table.to_csv(files[-1], index=False)
    files.append(os.path.join(out_dir, "traces.csv"))
    pd.DataFrame(rows, columns=["output", "curve", "name", "index", "x", "y"]).to_csv(files[-1], index=False)
    return files


def has_display() -> bool:
    """Whether figures can be shown on screen."""
    return sys.platform in ("darwin", "win32") or bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def main(argv: list[str] | None = None) -> int:
    """Runs a SED-ML document and writes its outputs; returns the exit code."""
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="Run a protocol exported by PhLynx (protocol.sedml) with Myokit.")
    parser.add_argument("sedml", nargs="?", default=os.path.join(here, "protocol.sedml"), help="the SED-ML document")
    parser.add_argument("--out", help="where to write the results (default: results/ next to the document)")
    parser.add_argument("--no-show", action="store_true", help="write the figures without opening them")
    parser.add_argument("--format", default="png,svg", help="figure formats, e.g. png,svg,pdf (default: png,svg)")
    parser.add_argument("--dpi", type=int, default=300, help="resolution of bitmap figures (default: 300)")
    parser.add_argument("--verbose", action="store_true", help="say what runs as it runs")
    args = parser.parse_args(argv)
    formats = [f.strip().lower() for f in args.format.split(",") if f.strip()]
    supported = matplotlib.figure.Figure().canvas.get_supported_filetypes()
    if not formats or any(f not in supported for f in formats):
        parser.error(f"--format takes formats from {', '.join(sorted(supported))}, separated by commas.")
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s: %(message)s")
    show = not args.no_show and has_display()
    if not show:
        matplotlib.use("Agg")
    path = os.path.abspath(args.sedml)
    out_dir = os.path.abspath(args.out or os.path.join(os.path.dirname(path), "results"))
    timings, started, clock = {}, time.strftime("%Y-%m-%dT%H:%M:%S%z"), time.perf_counter()

    def lap(name: str) -> None:
        """Records how long the step that just finished took."""
        nonlocal clock
        timings[name] = round(time.perf_counter() - clock, 3)
        clock = time.perf_counter()

    try:
        doc, concatenate = load_document(path)
        model_path = os.path.join(os.path.dirname(path), doc.getModel(0).getSource())
        model, source = load_model(model_path)
        runner = Runner(doc, model, source, concatenate)
        lap("load_and_compile")
        runner.run()
        lap("simulate")
        data = evaluate_data_generators(doc, runner)
        lap("data_generators")
        os.makedirs(out_dir, exist_ok=True)
        rows, files = plot_outputs(doc, data, out_dir, formats, args.dpi, show)
        lap("plots")
        files += write_reports(doc, data, rows, out_dir)
        lap("reports")
    except DocumentError as error:
        print(f"error: {error}", file=sys.stderr)
        if args.verbose:
            traceback.print_exc()
        return 2
    except (RunError, myokit.MyokitError, ArithmeticError) as error:
        print(f"error: the simulation failed: {error}", file=sys.stderr)
        if args.verbose:
            traceback.print_exc()
        return 1
    info = {"document": path, "model": model_path, "started": started, "timings_s": timings,
            "versions": {"python": platform.python_version(), "libsedml": libsedml.__version__, "myokit": myokit.__version__,
                         "numpy": np.__version__, "pandas": pd.__version__, "matplotlib": matplotlib.__version__,
                         "seaborn": sns.__version__},
            "outputs": [os.path.relpath(f, out_dir) for f in files]}
    with open(os.path.join(out_dir, "run_info.json"), "w") as f:
        json.dump(info, f, indent=2)
    print(f"Wrote {len(files) + 1} files to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
