import json
import math
import sqlite3
from contextlib import closing
from pathlib import Path


def validate_state(state):
    def number(value):
        return type(value) in (int, float) and math.isfinite(value) and value >= 0

    def ids(values):
        return isinstance(values, list) and len(values) <= 12000 and all(isinstance(v, str) and 0 < len(v) < 200 for v in values)

    if not isinstance(state, dict) or type(state.get('version')) is not int or state['version'] != 1:
        raise ValueError('Invalid progress version')
    if not all(ids(state.get(key)) for key in ('known', 'unknown')):
        raise ValueError('Invalid word collection')
    for key in ('mistakes', 'levels', 'days'):
        values = state.get(key)
        if not isinstance(values, dict) or len(values) > 12000 or not all(0 < len(k) < 200 and number(v) for k, v in values.items()):
            raise ValueError('Invalid progress counters')
    if not all(number(state.get(key)) for key in ('answers', 'correct')) or state['correct'] > state['answers']:
        raise ValueError('Invalid answer counters')
    history = state.get('history')
    if not isinstance(history, list) or len(history) > 100:
        raise ValueError('Invalid history')
    for entry in history:
        if not isinstance(entry, dict) or not isinstance(entry.get('title'), str) or not isinstance(entry.get('date'), str) or not all(number(entry.get(k)) for k in ('elapsed', 'total', 'correct', 'errors', 'unknown')):
            raise ValueError('Invalid history entry')
    settings = state.get('settings')
    if not isinstance(settings, dict) or not all(type(settings.get(k)) is bool for k in ('sound', 'autoplay')) or settings.get('theme') not in ('light', 'dark'):
        raise ValueError('Invalid settings')
    session = state.get('session')
    if session is not None:
        if not isinstance(session, dict) or session.get('mode') not in ('level', 'test', 'custom', 'mistakes', 'unknowns', 'phrasal') or session.get('direction') not in ('en_ru', 'ru_en') or not isinstance(session.get('title'), str):
            raise ValueError('Invalid session')
        if not ids(session.get('queue')) or not session['queue'] or type(session.get('position')) is not int or not 0 <= session['position'] < len(session['queue']):
            raise ValueError('Invalid session position')
        if not all(number(session.get(k)) for k in ('elapsed', 'correct', 'errors', 'unknown')):
            raise ValueError('Invalid session counters')
    return state


class ProgressStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=10)) as connection, connection:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, state TEXT)')
            connection.execute('INSERT OR IGNORE INTO progress VALUES (1, 0, NULL)')

    @staticmethod
    def document(row):
        return {'revision': row[0], 'state': json.loads(row[1]) if row[1] is not None else None}

    def read(self):
        with closing(sqlite3.connect(self.path, timeout=10)) as connection, connection:
            return self.document(connection.execute('SELECT revision, state FROM progress WHERE id = 1').fetchone())

    def write(self, revision, state):
        if type(revision) is not int or revision < 0:
            raise ValueError('Invalid revision')
        validate_state(state)
        body = json.dumps(state, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        with closing(sqlite3.connect(self.path, timeout=10)) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT revision, state FROM progress WHERE id = 1').fetchone()
            if row[0] != revision:
                return False, self.document(row)
            connection.execute('UPDATE progress SET revision = ?, state = ? WHERE id = 1', (revision + 1, body))
        return True, {'revision': revision + 1}
