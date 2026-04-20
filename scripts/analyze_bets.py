#!/usr/bin/env python3
"""
Аналіз ставок за діапазон дат: збирає всі ставки в flat-рядки,
обраховує Edge, виявляє фліпи TM→TB, формує JSON для Google Sheets.
"""

import json
import os
from datetime import datetime

DATES = ['2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18', '2026-04-19']
DATA_DIR = '/Users/maralov/personal/parserFootballOdds/data/logs'

ODDS_MAP = {
    # (period_bucket, bet_direction) -> odds
    ('60-70', 'TM'): 2.4,   # реальний ринок ~2.3-2.5, беремо середнє
    ('60-70', 'TB'): 2.4,
    ('70-80', 'TM'): 1.8,
    ('70-80', 'TB'): 1.8,
    ('80-90+', 'TM'): 2.5,
    ('80-90+', 'TB'): 2.5,
}


def get_odds(period: str, bet: str) -> float:
    direction = 'TB' if 'ТБ' in bet or 'TB' in bet else 'TM'
    bucket = get_period_bucket(period)
    return ODDS_MAP.get((bucket, direction), 2.0)


def get_period_bucket(period: str) -> str:
    if period == '60-70':
        return '60-70'
    if period in ('70-80',):
        return '70-80'
    if period in ('80-90+', '80-90', '85+', '85-90+'):
        return '80-90+'
    # fallback by content
    if period.startswith('60'):
        return '60-70'
    if period.startswith('70'):
        return '70-80'
    return '80-90+'


def calc_edge(bet: str, p_goal: float, p_dry: float, odds: float) -> float:
    """Edge = P(win) * odds - 1"""
    direction = 'TB' if 'ТБ' in bet or 'TB' in bet else 'TM'
    p_win = p_goal if direction == 'TB' else p_dry
    return round(p_win * odds - 1, 4)


def load_url_map(date: str) -> dict:
    path = os.path.join(DATA_DIR, date, 'matches.json')
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        matches = json.load(f)
    return {m['matchId']: m.get('desktopUrl', m.get('mobileUrl', '')) for m in matches}


def detect_flip(periods: list) -> bool:
    """Повертає True якщо в матчі є зміна напряму ТМ→ТБ або ТБ→ТМ"""
    if len(periods) < 2:
        return False
    directions = []
    for p in periods:
        bet = p.get('bet', '')
        if 'ТБ' in bet or 'TB' in bet:
            directions.append('TB')
        else:
            directions.append('TM')
    for i in range(1, len(directions)):
        if directions[i] != directions[i - 1]:
            return True
    return False


def build_rows() -> list:
    rows = []

    for date in DATES:
        pred_path = os.path.join(DATA_DIR, date, 'prediction.json')
        if not os.path.exists(pred_path):
            continue

        with open(pred_path) as f:
            pred = json.load(f)

        url_map = load_url_map(date)

        for match in pred.get('matches', []):
            match_id = match['matchId']
            league = match.get('league', '')
            home = match.get('home', '')
            away = match.get('away', '')
            url = url_map.get(match_id, '')

            final = match.get('finalResult', {})
            actual = final.get('actualResult', {})
            if isinstance(actual, dict):
                score_str = f"{actual.get('home', '?')}:{actual.get('away', '?')}"
            else:
                score_str = str(actual)
            total_goals = final.get('totalGoals', '?')

            periods = match.get('periods', [])
            has_flip = detect_flip(periods)

            for i, period_data in enumerate(periods):
                period = period_data.get('period', '')
                period_bucket = get_period_bucket(period)
                minute = period_data.get('minute', '')
                bet = period_data.get('bet', '')
                confidence = period_data.get('confidence', '')
                p_goal = period_data.get('pGoal', None)
                p_dry = period_data.get('pDry', None)
                signal_quality = period_data.get('signalQuality', None)
                hit = period_data.get('hit', None)
                snapshots = period_data.get('snapshots', None)
                ts = period_data.get('timestamp', '')

                direction = 'TB' if ('ТБ' in bet or 'TB' in bet) else 'TM'
                odds = get_odds(period, bet)
                edge = calc_edge(bet, p_goal or 0, p_dry or 0, odds) if p_goal is not None else None

                # Flip позначка: якщо матч має фліп і це не перша ставка — позначаємо
                flip_type = ''
                if has_flip and i == 0:
                    flip_type = 'initial'
                elif has_flip and i > 0:
                    prev_bet = periods[i - 1].get('bet', '')
                    prev_dir = 'TB' if ('ТБ' in prev_bet or 'TB' in prev_bet) else 'TM'
                    if prev_dir != direction:
                        flip_type = f'flip_{prev_dir}→{direction}'

                row = {
                    'date': date,
                    'matchId': match_id,
                    'league': league,
                    'match': f'{home} vs {away}',
                    'url': url,
                    'period': period_bucket,
                    'minute': minute,
                    'bet': bet,
                    'direction': direction,
                    'has_flip': has_flip,
                    'flip_type': flip_type,
                    'odds': odds,
                    'confidence': confidence,
                    'pGoal': p_goal,
                    'pDry': p_dry,
                    'signalQuality': signal_quality,
                    'edge': edge,
                    'snapshots': snapshots,
                    'result': 'WIN' if hit else ('LOSS' if hit is False else 'PENDING'),
                    'finalScore': score_str,
                    'totalGoals': total_goals,
                    'timestamp': ts,
                }
                rows.append(row)

    return rows


def analytics_summary(rows: list) -> dict:
    from collections import defaultdict

    def group_stats(items):
        wins = sum(1 for r in items if r['result'] == 'WIN')
        losses = sum(1 for r in items if r['result'] == 'LOSS')
        total = wins + losses
        edges = [r['edge'] for r in items if r['edge'] is not None]
        sqs = [r['signalQuality'] for r in items if r['signalQuality'] is not None]
        return {
            'total': total,
            'wins': wins,
            'losses': losses,
            'hitRate': round(wins / total, 3) if total else None,
            'avgEdge': round(sum(edges) / len(edges), 4) if edges else None,
            'avgSignalQuality': round(sum(sqs) / len(sqs), 4) if sqs else None,
        }

    resolved = [r for r in rows if r['result'] in ('WIN', 'LOSS')]

    # По діапазонам
    by_period = defaultdict(list)
    for r in resolved:
        by_period[r['period']].append(r)

    # По типу ставки
    by_bet = defaultdict(list)
    for r in resolved:
        by_bet[r['direction']].append(r)

    # Фліпи vs звичайні
    flips = [r for r in resolved if r['has_flip']]
    no_flips = [r for r in resolved if not r['has_flip']]

    # Edge бакети
    edge_buckets = defaultdict(list)
    for r in resolved:
        e = r['edge']
        if e is None:
            continue
        if e < 0:
            bucket = 'edge_negative'
        elif e < 0.1:
            bucket = 'edge_0_10pct'
        elif e < 0.2:
            bucket = 'edge_10_20pct'
        elif e < 0.3:
            bucket = 'edge_20_30pct'
        else:
            bucket = 'edge_30pct_plus'
        edge_buckets[bucket].append(r)

    # Signal Quality бакети
    sq_buckets = defaultdict(list)
    for r in resolved:
        sq = r['signalQuality']
        if sq is None:
            continue
        if sq < 0.65:
            bucket = 'sq_low'
        elif sq < 0.75:
            bucket = 'sq_medium'
        elif sq < 0.85:
            bucket = 'sq_high'
        else:
            bucket = 'sq_very_high'
        sq_buckets[bucket].append(r)

    # Confidence
    conf_buckets = defaultdict(list)
    for r in resolved:
        conf_buckets[r['confidence']].append(r)

    return {
        'totalRows': len(resolved),
        'overall': group_stats(resolved),
        'byPeriod': {k: group_stats(v) for k, v in sorted(by_period.items())},
        'byBetDirection': {k: group_stats(v) for k, v in sorted(by_bet.items())},
        'flipsVsNormal': {
            'flips': group_stats(flips),
            'noFlips': group_stats(no_flips),
        },
        'byEdgeBucket': {k: group_stats(v) for k, v in sorted(edge_buckets.items())},
        'bySignalQuality': {k: group_stats(v) for k, v in sorted(sq_buckets.items())},
        'byConfidence': {k: group_stats(v) for k, v in sorted(conf_buckets.items())},
    }


def main():
    rows = build_rows()
    summary = analytics_summary(rows)

    output = {
        'generatedAt': datetime.utcnow().isoformat() + 'Z',
        'dateRange': {'from': DATES[0], 'to': DATES[-1]},
        'analytics': summary,
        'rows': rows,
    }

    out_path = '/Users/maralov/personal/parserFootballOdds/data/logs/analysis_04-15_to_04-19.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Збережено: {out_path}")
    print(f"Всього рядків (ставок): {len(rows)}")
    print("\n=== АНАЛІТИКА ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
