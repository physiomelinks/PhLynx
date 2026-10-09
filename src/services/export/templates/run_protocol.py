#!/usr/bin/env python3
"""Runs a protocol exported from PhLynx with libcuflynx (circulatory_autogen), and plots what it records. Edit freely.

OBS_DATA's protocol_info sets up the experiments, and its prediction_items say what to record: a variable's trace, or
a feature, which is an operation over one sub-experiment (a peak, say). libcuflynx computes the features with its own
operation functions, so they are the numbers circulatory_autogen and CUFLynx compute. Writes traces.csv,
features.csv and a figure for each plot.
"""
# ---- Written by PhLynx's export ------------------------------------------------------------------------------------
MODEL = 'model.cellml'
OBS_DATA = 'obs_data.json'
DT = 0.1  # the time between recorded points
SOLVER_INFO = {}  # CVODE's settings, as libcuflynx names them
PARAMETER_NAMES = {}  # protocol parameters libcuflynx can't find in MODEL -> the model's names for them
FEATURE_PLOTS = []  # features against another feature, a protocol input or the experiment
OPERATION_FUNCS_PATH = None  # a file of your own operation functions, for features that use them
# ---- End of what PhLynx wrote --------------------------------------------------------------------------------------
import argparse
import json
import os
import warnings

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from matplotlib.colors import is_color_like

try:
    from libcuflynx.param_id import prediction_features as pf
    from libcuflynx.param_id.operation_funcs import get_operation_funcs_dict_for_mode
    from libcuflynx.parsers.PrimitiveParsers import ObsAndParamDataParser
    from libcuflynx.protocol_runners import ProtocolExecutor, ProtocolRunner
except ImportError as error:
    raise SystemExit('This script needs libcuflynx from circulatory_autogen #536 (commit 7e9fdb5 or later), which '
                     f'computes prediction items\' features: pip install -r requirements.txt. ({error})')

HERE = os.path.dirname(os.path.abspath(__file__))
LINE_STYLES = ['-', '--', ':', '-.']


def load():
    """OBS_DATA as written, and its protocol and prediction items as libcuflynx parses them, parameters renamed."""
    with open(os.path.join(HERE, OBS_DATA), encoding='utf-8-sig') as f:
        obs = json.load(f)
    renamed = json.loads(json.dumps(obs))
    changes = renamed['protocol_info'].get('params_to_change', {})
    renamed['protocol_info']['params_to_change'] = {PARAMETER_NAMES.get(k, k): v for k, v in changes.items()}
    parsed = ObsAndParamDataParser().parse_obs_data_json(obs_data_dict=renamed)
    if not parsed['prediction_info']['data_item_names']:
        raise SystemExit(f'{OBS_DATA} has no prediction_items, so there is nothing to record. Add outputs to the '
                         'protocol in PhLynx, or write prediction_items yourself.')
    return obs['protocol_info'], parsed['protocol_info'], parsed['prediction_info']


def number(protocol_info, ref, e):
    """The number the protocol sets an input to in a sub-experiment of experiment e, or nan if it changes there."""
    value = protocol_info['params_to_change'][ref['input']][e][ref['subexperiment_idx']]
    return float(value) if isinstance(value, (int, float)) else np.nan


def check_plots(protocol_info, items):
    """Stops, naming them all, when FEATURE_PLOTS names features or inputs OBS_DATA doesn't have."""
    groups = {g for g, op in zip(items['item_names_for_plotting'], items['operations']) if op is not None}
    missing = set()
    for plot in FEATURE_PLOTS:
        for axis in (plot['x'], plot['y'], plot.get('series')):
            if isinstance(axis, dict):
                missing |= {axis['input']} - set(protocol_info.get('params_to_change', {}))
            elif axis not in (None, 'experiment'):
                missing |= {axis} - groups
    if missing:
        raise SystemExit(f'FEATURE_PLOTS names {", ".join(sorted(missing))}, which {OBS_DATA} has no feature or input '
                         f'called. Its features are {", ".join(sorted(groups)) or "none"}.')


def check_names(helper, protocol, items):
    """Stops when MODEL lacks parameters the protocol sets, naming them all; gives the items whose variables it has."""
    resolve = getattr(helper, '_resolve_name', None)  # the Myokit helper's; without it, libcuflynx says itself
    known = (lambda name: resolve(name)[0] is not None) if resolve else (lambda name: True)
    missing = [name for name in protocol['params_to_change'] if not known(name)]
    if missing:
        raise SystemExit(f'{MODEL} has no variable called {", ".join(missing)}, which the protocol sets. Give each '
                         "the model's name for it in PARAMETER_NAMES, at the top of this script.")
    lacking = [[name for name in operands if not known(name)] for operands in items['operands']]
    skipped = [f"{items['data_item_names'][i]} ({', '.join(names)})" for i, names in enumerate(lacking) if names]
    if skipped:
        warnings.warn(f'{MODEL} has no variable for these prediction items, so they are skipped: {"; ".join(skipped)}')
    return [i for i, names in enumerate(lacking) if not names]


def classify(items, kept, funcs):
    """Splits the items into traces (no operation) and features (an operation giving a number), warning of the rest."""
    traces, features, skipped = [], [], []
    for i in kept:
        if items['operations'][i] is None:
            traces.append(i)
            continue
        try:
            (features if pf.is_scalar_feature(items, i, funcs) else skipped).append(i)
        except ValueError:  # an operation libcuflynx doesn't have: see OPERATION_FUNCS_PATH
            skipped.append(i)
    if skipped:
        warnings.warn('These prediction items are skipped, as their operation is unknown or gives more than one '
                      f'number: {", ".join(items["data_item_names"][i] for i in skipped)}')
    return traces, features


def sub_slices(t, sim_times):
    """Where each sub-experiment is in an experiment's joined time course, its first point the one before's last."""
    edges = [int(np.abs(t - edge).argmin()) for edge in np.cumsum([0, *sim_times])]
    return [slice(a, b + 1) for a, b in zip(edges, edges[1:])]


def record_traces(protocol, items, traces, operands, by_sub, times):
    """Each trace item's variables over its experiment's sub-experiments, joined as libcuflynx joins them."""
    recorded = {}
    for i in traces:
        e, s = int(items['experiment_idxs'][i]), int(items['subexperiment_idxs'][i])
        for name in items['operands'][i]:
            key = (e, items['trace_names_for_plotting'][i], name, items['units'][i])
            recorded.setdefault(key, set()).add(s)
    rows = []
    for (e, group, name, unit), subs in recorded.items():
        t, j = np.asarray(times[e]), operands.index(name)
        slices = sub_slices(t, protocol['sim_times'][e])
        for s in sorted(subs):
            at = slices[s]
            values = np.ravel(by_sub[e, s][j][0])
            values = np.broadcast_to(values, (at.stop - at.start,))  # a constant is logged once
            first = 1 if s - 1 in subs else 0  # the point the sub-experiment before ended on
            rows.append(pd.DataFrame({'experiment': e, 'subexperiment': s, 'group': group, 'variable': name,
                                      'unit': unit, 'time': t[at][first:], 'value': values[first:]}))
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def evaluate_features(protocol, items, features, funcs, by_sub, offset):
    """Each feature, as libcuflynx's features_from_segments computes it, skipping any it can't with a warning."""
    rows, done = [], {}
    for k, (i, (e, s)) in enumerate(zip(features, pf.feature_segments(items, features, protocol))):
        name = items['data_item_names'][i]
        try:
            value = pf.evaluate_feature(items, i, funcs, list(by_sub[e, s][offset + k]), temp_results=done)
        except Exception as error:
            warnings.warn(f'{name} is skipped: {error}')
            continue
        done[name] = value
        rows.append({'item': name, 'feature': items['item_names_for_plotting'][i], 'experiment': e, 'subexperiment': s,
                     'operation': items['operations'][i], 'unit': items['units'][i], 'value': value})
    return pd.DataFrame(rows, columns=['item', 'feature', 'experiment', 'subexperiment', 'operation', 'unit', 'value'])


def run(protocol, items):
    """Runs every experiment once, recording every trace and feature item; gives their tables and the times."""
    runner = ProtocolRunner(os.path.join(HERE, MODEL), inp_data_dict={'dt': DT, 'solver_info': SOLVER_INFO},
                            solver='CVODE_myokit')
    helper = runner.sim_helper
    kept = check_names(helper, protocol, items)
    helper.set_protocol_info(protocol)  # binds a paced input to Myokit's pacing
    funcs = get_operation_funcs_dict_for_mode('numpy', OPERATION_FUNCS_PATH)
    traces, features = classify(items, kept, funcs)
    operands = list(dict.fromkeys(name for i in traces for name in items['operands'][i]))
    asked = [[name] for name in operands] + pf.result_variables(items, features)
    if not asked:
        raise SystemExit('None of the prediction items can be recorded: see the warnings above.')
    ok, by_sub, _, times = ProtocolExecutor(helper).run_protocol(protocol, result_variables=asked)
    if not ok:
        raise SystemExit('The protocol failed to run: try a smaller MaximumStep or tighter tolerances in SOLVER_INFO.')
    return (record_traces(protocol, items, traces, operands, by_sub, times),
            evaluate_features(protocol, items, features, funcs, by_sub, offset=len(operands)), times)


def experiment_styles(protocol_info, n):
    """Each experiment's label and colour, as the protocol names them, else numbered in seaborn's palette."""
    given = lambda key: list(protocol_info.get(key) or [])[:n] + [None] * max(0, n - len(protocol_info.get(key) or []))
    labels = [label or f'Experiment {e + 1}' for e, label in enumerate(given('experiment_labels'))]
    palette = sns.color_palette('deep', n)
    colours = [c if isinstance(c, str) and is_color_like(c) else palette[e]
               for e, c in enumerate(given('experiment_colors'))]
    return labels, colours


def with_unit(text, unit):
    """A name with its unit, as the axes show them."""
    return f'{text} ({unit})' if unit and unit != 'dimensionless' else text


def trace_figure(traces, labels, colours):
    """A plot per trace_name_for_plotting, every experiment on it in its colour."""
    groups = list(dict.fromkeys(traces['group']))
    fig, axes = plt.subplots(len(groups), 1, squeeze=False, sharex=True, figsize=(7, 2.6 * len(groups)),
                             layout='constrained')
    for ax, group in zip(axes[:, 0], groups):
        rows = traces[traces['group'] == group]
        names = list(dict.fromkeys(rows['variable']))
        for (name, e), own in rows.groupby(['variable', 'experiment'], sort=False):
            # A gap where a sub-experiment isn't recorded.
            for r, part in own.groupby((own['subexperiment'].diff().fillna(1) > 1).cumsum()):
                ax.plot(part['time'], part['value'], color=colours[e], ls=LINE_STYLES[names.index(name) % 4],
                        label=None if r else (labels[e] if len(names) == 1 else f'{name} · {labels[e]}'))
        ax.set(title=group, ylabel=with_unit(group, rows['unit'].iloc[0]))
        ax.legend(fontsize='x-small')
    axes[-1, 0].set_xlabel('Time')
    return fig


def features_figure(features, labels, colours):
    """A plot per feature (item_name_for_plotting): a point per experiment, in its colour."""
    groups = list(dict.fromkeys(features['feature']))
    cols = min(len(groups), 3)
    rows_count = -(-len(groups) // cols)
    fig, axes = plt.subplots(rows_count, cols, squeeze=False, figsize=(3.4 * cols, 3 * rows_count),
                             layout='constrained')
    for ax, group in zip(axes.flat, groups):
        rows = features[features['feature'] == group].sort_values('experiment')
        x = rows['experiment'] + 1
        ax.plot(x, rows['value'], color='0.7', zorder=1)
        ax.scatter(x, rows['value'], c=[colours[e] for e in rows['experiment']], zorder=2)
        ax.set_xticks(x, [labels[e] for e in rows['experiment']], rotation=30, ha='right')
        ax.set(title=group, ylabel=with_unit(group, rows['unit'].iloc[0]))
    for ax in axes.flat[len(groups):]:
        ax.set_visible(False)
    return fig


def axis_values(axis, experiments, by, protocol_info):
    """A FEATURE_PLOTS axis's value in each experiment: a feature's, an input's number, or the experiment's number."""
    if axis == 'experiment':
        return experiments + 1
    if isinstance(axis, dict):
        return [number(protocol_info, axis, e) for e in experiments]
    return by[axis].reindex(experiments).to_numpy()


def axis_name(axis):
    """A FEATURE_PLOTS axis's name."""
    if isinstance(axis, dict):
        return f"{axis['input']} (sub-experiment {axis['subexperiment_idx'] + 1})"
    return 'Experiment' if axis == 'experiment' else axis


def feature_plot(plot, features, protocol_info):
    """A FEATURE_PLOTS pairing: a point per experiment, and a line per series value when it has a series."""
    by = features.pivot_table(index='experiment', columns='feature', values='value')
    df = pd.DataFrame({'y': by[plot['y']]}).dropna()
    df['x'] = axis_values(plot['x'], df.index, by, protocol_info)
    series = plot.get('series')
    if series:
        df['series'] = [f"{series['input']} = {v:g}" for v in axis_values(series, df.index, by, protocol_info)]
    fig, ax = plt.subplots(figsize=(5, 3.5), layout='constrained')
    sns.lineplot(df.dropna(subset=['x']).sort_values('x'), x='x', y='y', hue='series' if series else None,
                 marker='o', ax=ax, sort=False)
    ax.set(title=plot.get('title') or plot['y'], xlabel=axis_name(plot['x']), ylabel=plot['y'])
    if series:
        ax.get_legend().set_title(None)  # each entry names its input
    return fig


# ---- Your plots ----------------------------------------------------------------------------------------------------
def your_plots(traces, features, labels, colours):
    """Your own figures, by file name. traces and features are the tables written to traces.csv and features.csv."""
    figures = {}
    # For example, the first trace plot's variable in experiment 1 alone:
    #   rows = traces[(traces['experiment'] == 0) & (traces['group'] == traces['group'].iloc[0])]
    #   fig, ax = plt.subplots()
    #   ax.plot(rows['time'], rows['value'], color=colours[0], label=labels[0])
    #   figures['my_plot'] = fig
    return figures
# ---- End of your plots ---------------------------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', default='results', help='where to write the figures and tables (default: results)')
    parser.add_argument('--format', default='png', help='figure formats, comma-separated: png, svg, pdf')
    parser.add_argument('--show', action='store_true', help='open the figures as well')
    args = parser.parse_args()
    warnings.formatwarning = lambda message, *_, **__: f'Warning: {message}\n'

    protocol_info, protocol, items = load()
    check_plots(protocol_info, items)
    traces, features, times = run(protocol, items)
    labels, colours = experiment_styles(protocol_info, len(times))
    sns.set_theme(style='ticks', context='paper')
    figures = {}
    if len(traces):
        figures['traces'] = trace_figure(traces, labels, colours)
    if len(features):
        figures['features'] = features_figure(features, labels, colours)
    for n, plot in enumerate(FEATURE_PLOTS, 1):
        figures[f'feature_plot_{n}'] = feature_plot(plot, features, protocol_info)
    figures.update(your_plots(traces, features, labels, colours))

    os.makedirs(args.out, exist_ok=True)
    for name, fig in figures.items():
        for fmt in args.format.split(','):
            fig.savefig(os.path.join(args.out, f'{name}.{fmt.strip()}'), dpi=200)
    traces.to_csv(os.path.join(args.out, 'traces.csv'), index=False)
    features.to_csv(os.path.join(args.out, 'features.csv'), index=False)
    print(f'Wrote {len(figures)} figure(s), traces.csv and features.csv to {args.out}')
    if args.show:
        plt.show()


if __name__ == '__main__':
    main()
