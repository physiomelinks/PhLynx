#!/usr/bin/env python3
"""Runs a protocol exported from PhLynx with libcuflynx (circulatory_autogen), and plots what it records. Edit freely.

OBS_DATA's protocol_info sets up the experiments, and its prediction_items say what to record: a variable's trace, or
a feature, which is an operation over one sub-experiment (a peak, say). libcuflynx computes the features with its own
operation functions, so they are the numbers circulatory_autogen and CUFLynx compute. Its prediction_plots pair the
features across the experiments, as PhLynx plots them. Writes traces.csv, features.csv and a figure for each plot.
"""
# ---- Written by PhLynx's export ------------------------------------------------------------------------------------
MODEL = 'model.cellml'
OBS_DATA = 'obs_data.json'
DT = 0.1  # the time between recorded points
TIME_UNIT = ''  # the unit of time, as the model has it
SOLVER_INFO = {}  # CVODE's settings, as libcuflynx names them
PARAMETER_NAMES = {}  # protocol parameters libcuflynx can't find in MODEL -> the model's names for them, in outputs too
OPERATION_FUNCS_PATH = None  # a file of your own operation functions, for features that use them
# ---- End of what PhLynx wrote --------------------------------------------------------------------------------------
import argparse
import json
import os
import re
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
# A prediction plot's keys, and the ways it reads x: another feature, or an input's value.
PLOT_KEYS = ('name', 'kind', 'x', 'y', 'series')
PLOT_KINDS = ('feature_vs_feature', 'feature_vs_input')


def rename_operands(item):
    """Gives an item the model's names for the parameters it records (PARAMETER_NAMES), its plotting names kept."""
    name = item.get('data_item_name', item.get('variable'))
    operands = item.get('operands') or ([name] if name is not None else [])  # libcuflynx's default: its own name
    if not isinstance(operands, list) or not any(isinstance(o, str) and o in PARAMETER_NAMES for o in operands):
        return
    if item.get('trace_name_for_plotting') is None and 'name_for_plotting' not in item:
        item['trace_name_for_plotting'] = str(operands[0])  # as libcuflynx would name it before the rename
    item['operands'] = [PARAMETER_NAMES.get(o, o) if isinstance(o, str) else o for o in operands]


def load():
    """OBS_DATA's protocol and prediction plots as written, and its protocol and prediction items as libcuflynx parses
    them, parameters renamed."""
    with open(os.path.join(HERE, OBS_DATA), encoding='utf-8-sig') as f:
        obs = json.load(f)
    renamed = json.loads(json.dumps(obs))
    changes = renamed['protocol_info'].get('params_to_change', {})
    renamed['protocol_info']['params_to_change'] = {PARAMETER_NAMES.get(k, k): v for k, v in changes.items()}
    for item in renamed.get('prediction_items') or []:
        if isinstance(item, dict):
            rename_operands(item)
    parsed = ObsAndParamDataParser().parse_obs_data_json(obs_data_dict=renamed)
    if not parsed['prediction_info']['data_item_names']:
        raise SystemExit(f'{OBS_DATA} has no prediction_items, so there is nothing to record. Add outputs under '
                         "Outputs in PhLynx's protocol editor (Edit the protocol) and export again, or add "
                         'prediction_items to it.')
    plots = obs.get('prediction_plots') or []
    if not isinstance(plots, list):
        warnings.warn(f'{OBS_DATA}\'s prediction_plots is not a list, so no feature plot is drawn.')
        plots = []
    return obs['protocol_info'], plots, parsed['protocol_info'], parsed['prediction_info']


def input_value(protocol_info, ref, e):
    """The number a prediction plot's input reference reads in experiment e, or nan if it isn't one there."""
    value = protocol_info['params_to_change'][ref['params_to_change']][e][ref['subexperiment_idx']]
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else np.nan


def describe_input(ref):
    """An input reference, as the axes and PhLynx name it."""
    return f"{ref['params_to_change']} (sub-experiment {ref['subexperiment_idx'] + 1})"


def feature_groups(items):
    """Each group of prediction items (item_name_for_plotting): its items by experiment, and whether each is a feature,
    an operation that isn't a series."""
    groups = {}
    for i, group in enumerate(items['item_names_for_plotting']):
        entry = groups.setdefault(group, {'by_experiment': {}, 'is_feature': True})
        entry['by_experiment'].setdefault(int(items['experiment_idxs'][i]), []).append(items['data_item_names'][i])
        if items['operations'][i] is None or items['data_types'][i] == 'series':
            entry['is_feature'] = False
    return groups


def plot_problems(plot, groups, protocol_info, names):
    """What stops a prediction plot being drawn, as PhLynx's protocol editor checks it."""
    if not isinstance(plot, dict):
        return [f'it must be a dict, not {type(plot).__name__}']
    unknown = sorted(set(plot) - set(PLOT_KEYS))
    problems = [f'it has keys it does not take: {", ".join(unknown)}'] if unknown else []
    if not isinstance(plot.get('name'), str) or not plot['name'].strip():
        problems.append('it needs a name')
    elif names.count(plot['name']) > 1:
        problems.append('another plot has its name')
    kind = plot.get('kind')
    if kind not in PLOT_KINDS:
        problems.append(f'its kind must be {" or ".join(PLOT_KINDS)}, not {kind!r}')

    def group(axis):
        name = plot.get(axis)
        entry = groups.get(name) if isinstance(name, str) else None
        if entry is None:
            problems.append(f'{axis} names no group of prediction items: {name!r}')
        elif not entry['is_feature']:
            problems.append(f'{axis} names {name!r}, which has items that are not features')
        elif any(len(names_in) > 1 for names_in in entry['by_experiment'].values()):
            problems.append(f'{axis} names {name!r}, which has more than one item in an experiment; a plot takes one')
        return entry

    def input_ref(axis, experiments):
        ref = plot.get(axis)
        if not isinstance(ref, dict) or set(ref) != {'params_to_change', 'subexperiment_idx'}:
            problems.append(f"{axis} must be {{'params_to_change': <key>, 'subexperiment_idx': <int>}}, not {ref!r}")
            return
        rows = (protocol_info.get('params_to_change') or {}).get(ref['params_to_change'])
        if rows is None:
            problems.append(f"{axis} names {ref['params_to_change']!r}, which the protocol doesn't set")
            return
        sub = ref['subexperiment_idx']
        if not isinstance(sub, int) or isinstance(sub, bool) or sub < 0:
            problems.append(f'{axis} names the sub-experiment {sub!r}, not one counted from 0')
            return
        for e in experiments:
            try:
                value = rows[e][sub]
            except (IndexError, KeyError, TypeError):
                value = None
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                problems.append(f'{axis} reads {describe_input(ref)} in experiment {e + 1}, which is {value!r}, not a number')

    y = group('y')
    experiments = sorted(y['by_experiment']) if y else []
    if kind == 'feature_vs_feature':
        x = group('x')
        if x and y and sorted(x['by_experiment']) != experiments:
            problems.append('x and y cover different experiments; each point needs both')
    elif kind == 'feature_vs_input':
        input_ref('x', experiments)
    if plot.get('series') is not None:
        input_ref('series', experiments)
    return problems


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
    axes[-1, 0].set_xlabel(with_unit('Time', TIME_UNIT))
    return fig


def item_identity(items, name):
    """What tells a feature's items apart across the experiments: its operation, sub-experiment, operands and
    operation_kwargs, as PhLynx draws a line per item; and a label, and its operands and kwargs to add to it."""
    i = items['data_item_names'].index(name)
    operands, kwargs = list(items['operands'][i]), dict(items['operation_kwargs'][i] or {})
    operation, s = items['operations'][i], int(items['subexperiment_idxs'][i])
    detail = '; '.join(part for part in (', '.join(operands), ', '.join(f'{k} {v}' for k, v in kwargs.items())) if part)
    return json.dumps([operation, s, operands, sorted(kwargs.items())], default=str), f'{operation}, sub-experiment {s + 1}', detail


def features_figure(features, items, labels, colours):
    """A plot per feature (item_name_for_plotting): a point per experiment, in its colour, and a line per item (its
    operation, sub-experiment, operands and kwargs) when the feature has more than one item in an experiment."""
    groups = list(dict.fromkeys(features['feature']))
    cols = min(len(groups), 3)
    rows_count = -(-len(groups) // cols)
    fig, axes = plt.subplots(rows_count, cols, squeeze=False, figsize=(3.4 * cols, 3 * rows_count),
                             layout='constrained')
    for ax, group in zip(axes.flat, groups):
        rows = features[features['feature'] == group].sort_values('experiment')
        repeated = rows['experiment'].duplicated().any()
        if repeated:
            identities = {name: item_identity(items, name) for name in rows['item']}
            line = rows['item'].map(lambda name: identities[name][0])
            names = {key: (label, detail) for key, label, detail in identities.values()}
            bases = [label for label, _ in names.values()]
            parts = [(key, rows[line == key]) for key in dict.fromkeys(line)]
        else:
            parts = [(None, rows)]
        for n, (key, own) in enumerate(parts):
            x = own['experiment'] + 1
            label = None
            if repeated:
                base, detail = names[key]
                label = f'{base} ({detail})' if bases.count(base) > 1 and detail else base
            ax.plot(x, own['value'], color='0.7', ls=LINE_STYLES[n % 4], zorder=1, label=label)
            ax.scatter(x, own['value'], c=[colours[e] for e in own['experiment']], zorder=2)
        experiments = sorted(set(rows['experiment']))
        ax.set_xticks([e + 1 for e in experiments], [labels[e] for e in experiments], rotation=30, ha='right')
        ax.set(title=group, ylabel=with_unit(group, rows['unit'].iloc[0]))
        if repeated:
            ax.legend(fontsize='x-small')
    for ax in axes.flat[len(groups):]:
        ax.set_visible(False)
    return fig


def measured(items, name):
    """A y item's own value and std, as obs_data gives them, or nan where it has none."""
    i = items['data_item_names'].index(name)
    number = lambda v: float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else np.nan
    return number(items['values'][i]), number(items['stds'][i])


def plot_points(plot, features, items, protocol_info, groups):
    """A prediction plot's points, as PhLynx pairs them: one per experiment of its y group, sorted by series, then x,
    with the y item's measured value and std; one whose feature wasn't computed is skipped with a warning."""
    value = features.set_index(['feature', 'experiment'])['value']
    rows = []
    for e in sorted(groups[plot['y']]['by_experiment']):
        y = value.get((plot['y'], e), np.nan)
        if plot['kind'] == 'feature_vs_feature':
            x = value.get((plot['x'], e), np.nan)
        else:
            x = input_value(protocol_info, plot['x'], e)
        if not (np.isfinite(x) and np.isfinite(y)):
            warnings.warn(f"The feature plot {plot['name']} leaves out experiment {e + 1}: its features weren't computed "
                          '(see the warnings above).')
            continue
        series = input_value(protocol_info, plot['series'], e) if plot.get('series') else np.nan
        value_measured, std = measured(items, groups[plot['y']]['by_experiment'][e][0])
        rows.append({'experiment': e, 'x': float(x), 'y': float(y), 'series': series, 'measured': value_measured, 'std': std})
    df = pd.DataFrame(rows, columns=['experiment', 'x', 'y', 'series', 'measured', 'std'])
    return df.sort_values(['series', 'x'], kind='stable', na_position='first') if len(df) else df


def draw_measured(ax, df, colour, label):
    """A prediction plot's measured values, where its y items have them: rings with their std as error bars."""
    own = df[np.isfinite(df['measured'])]
    if len(own):
        ax.errorbar(own['x'], own['measured'], yerr=own['std'].fillna(0), fmt='o', mfc='none', color=colour, capsize=3,
                    zorder=3, label=label)


def prediction_plot(plot, features, items, protocol_info, groups, labels, colours):
    """A prediction plot: a line per series value, in its own colour, or else a line through a point per experiment,
    in its colour, and the y items' measured values with their std, as PhLynx draws it. None when it has no point."""
    df = plot_points(plot, features, items, protocol_info, groups)
    if not len(df):
        warnings.warn(f"The feature plot {plot['name']} is skipped: none of its features were computed.")
        return None
    units = features.groupby('feature')['unit'].first()
    fig, ax = plt.subplots(figsize=(5, 3.5), layout='constrained')
    if plot.get('series'):
        palette = sns.color_palette('deep', df['series'].nunique())
        for k, (value, line) in enumerate(df.groupby('series', sort=True)):
            label = f"{describe_input(plot['series'])} = {value:g}"
            ax.plot(line['x'], line['y'], marker='o', color=palette[k], label=label)
            draw_measured(ax, line, palette[k], f'{label}, measured')
    else:
        ax.plot(df['x'], df['y'], color='0.6', zorder=1)
        for _, point in df.iterrows():
            e = int(point['experiment'])
            ax.scatter(point['x'], point['y'], color=colours[e], zorder=2, label=labels[e])
        draw_measured(ax, df, '0.35', 'Measured')
    if plot['kind'] == 'feature_vs_input':
        xlabel = describe_input(plot['x'])
    else:
        xlabel = with_unit(plot['x'], units.get(plot['x']))
    ax.set(title=plot['name'], xlabel=xlabel, ylabel=with_unit(plot['y'], units.get(plot['y'])))
    ax.legend(fontsize='x-small')
    return fig


def figure_name(name, taken):
    """A file stem for a prediction plot, from its name, not one taken."""
    stem = re.sub(r'[^\w\-]+', '_', name).strip('_') or 'feature_plot'
    unique, n = stem, 2
    while unique in taken:
        unique, n = f'{stem}_{n}', n + 1
    return unique


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
    parser.add_argument('--out', default=os.path.join(HERE, 'results'),
                        help='where to write the figures and tables (default: results, beside this script)')
    parser.add_argument('--format', default='png', help='figure formats, comma-separated: png, svg, pdf')
    parser.add_argument('--show', action='store_true', help='open the figures as well')
    args = parser.parse_args()
    warnings.formatwarning = lambda message, *_, **__: f'Warning: {message}\n'

    protocol_info, plots, protocol, items = load()
    traces, features, times = run(protocol, items)
    # The tables first, so a plot that fails loses nothing computed.
    os.makedirs(args.out, exist_ok=True)
    traces.to_csv(os.path.join(args.out, 'traces.csv'), index=False)
    features.to_csv(os.path.join(args.out, 'features.csv'), index=False)

    labels, colours = experiment_styles(protocol_info, len(times))
    sns.set_theme(style='ticks', context='paper')
    figures = {}
    if len(traces):
        figures['traces'] = trace_figure(traces, labels, colours)
    if len(features):
        figures['features'] = features_figure(features, items, labels, colours)
    groups = feature_groups(items)
    names = [plot.get('name') for plot in plots if isinstance(plot, dict)]
    for n, plot in enumerate(plots, 1):
        problems = plot_problems(plot, groups, protocol_info, names)
        if problems:
            name = plot.get('name') if isinstance(plot, dict) else None
            warnings.warn(f'The feature plot {name or n} is skipped: {"; ".join(problems)}.')
            continue
        figure = prediction_plot(plot, features, items, protocol_info, groups, labels, colours) if len(features) else None
        if figure is not None:
            figures[figure_name(plot['name'], figures)] = figure
    figures.update(your_plots(traces, features, labels, colours))

    for name, fig in figures.items():
        for fmt in args.format.split(','):
            fig.savefig(os.path.join(args.out, f'{name}.{fmt.strip()}'), dpi=200)
    print(f'Wrote {len(figures)} figure(s), traces.csv and features.csv to {args.out}')
    if args.show:
        plt.show()


if __name__ == '__main__':
    main()
