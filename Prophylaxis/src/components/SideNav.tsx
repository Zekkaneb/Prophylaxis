import { memo, useEffect, useRef, useState } from 'react';
import BoardUtility from './BoardUtility';
import './SideNav.css';

export type TabId = 'dashboard' | 'courses' | 'drill' | 'play' | 'review' | 'puzzles';

interface TabDef {
  id: TabId;
  label: string;
  href: string;
  /** One glyph per room: the whole label when the rail is collapsed. */
  glyph: string;
}

/**
 * Study material first (library, drill, puzzles), then the playing room and its
 * analysis: the same order the old top bar used, read top to bottom.
 */
const TABS: TabDef[] = [
  { id: 'dashboard', label: 'Dashboard', href: '#/dashboard', glyph: '▦' },
  { id: 'courses', label: 'Courses', href: '#/courses', glyph: '♜' },
  { id: 'drill', label: 'Drill', href: '#/drill', glyph: '⚔' },
  { id: 'puzzles', label: 'Puzzles', href: '#/puzzles', glyph: '✧' },
  { id: 'play', label: 'Play', href: '#/play', glyph: '♟' },
  { id: 'review', label: 'Review', href: '#/review', glyph: '⌕' },
];

/** Tabs that render a board: only those get the size control. */
const BOARD_TABS: TabId[] = ['courses', 'drill', 'play', 'review', 'puzzles'];

/** Typing is instant; the filter commit waits for a pause. */
const SEARCH_DEBOUNCE_MS = 140;

/** Remembers whether the rail was left open or folded to icons. */
const COLLAPSE_KEY = 'chess-trainer.sidebar.v1';

/** Below this width the bar always shows the room names (see `mobile.css`). */
const PHONE_QUERY = '(max-width: 640px)';

function isPhone(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

function readCollapsed(): boolean {
  /* A phone has no rail to reclaim: the labelled bar is the navigation. */
  if (isPhone()) return false;
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored) return stored === 'collapsed';
    /* First visit: a board room needs the width, so only a genuinely wide
       window starts with the labels showing. */
    return window.innerWidth < 1500;
  } catch {
    return false;
  }
}

export interface SideNavProps {
  tab: TabId;
  soundOn: boolean;
  busy: 'export' | 'import' | null;
  onQuery: (value: string) => void;
  onSearchSubmit: () => void;
  onNavigate: (tab: TabId) => void;
  onSettings: () => void;
  onExport: () => void;
  onImport: () => void;
  onToggleSound: () => void;
}

/**
 * The app's only navigation: a left rail that folds down to its icons.
 *
 * Everything the top bar held lives here — rooms, search, board size, sound,
 * settings and the local data actions — so the board rooms get the full window
 * height instead of losing a strip to a horizontal bar. Memoised, and the
 * search field keeps its own state and debounces the commit upward, so
 * keystrokes never re-render the page underneath.
 */
function SideNavComponent({
  tab,
  soundOn,
  busy,
  onQuery,
  onSearchSubmit,
  onNavigate,
  onSettings,
  onExport,
  onImport,
  onToggleSound,
}: SideNavProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wantsSearchFocus = useRef(false);

  /* Commit the filter after a short pause; the field itself stays responsive. */
  useEffect(() => {
    const timer = setTimeout(() => onQuery(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [onQuery, text]);

  useEffect(() => {
    /* A phone never folds, so it must not overwrite the desktop preference. */
    if (isPhone()) return;
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? 'collapsed' : 'open');
    } catch {
      /* Private mode: the rail simply forgets its state between visits. */
    }
  }, [collapsed]);

  /* Narrowing the window into phone width opens the labels back up, so the
     rooms never collapse into unlabelled glyphs on a small screen. */
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const sync = () => {
      if (query.matches) setCollapsed(false);
    };
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /* The search button opens the rail and puts the caret in the field. */
  useEffect(() => {
    if (collapsed || !wantsSearchFocus.current) return;
    wantsSearchFocus.current = false;
    inputRef.current?.focus();
  }, [collapsed]);

  return (
    /* The rail's width drives the board's column, so the board layer is told to
       re-measure once the fold finishes and the board can re-centre. */
    <aside
      className={`sidenav${collapsed ? ' is-collapsed' : ''}`}
      aria-label="Primary"
      onTransitionEnd={(event) => {
        if (event.propertyName === 'width') window.dispatchEvent(new Event('resize'));
      }}
    >
      <div className="sidenav__top">
        <a
          className="brand"
          href="#/dashboard"
          aria-label="Prophylaxis — dashboard"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (tab !== 'dashboard') onNavigate('dashboard');
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            ♞
          </span>
          {collapsed ? null : (
            <span>
              Prophy<span className="brand-light">laxis</span>
            </span>
          )}
        </a>

        <button
          type="button"
          className="sidenav__toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => {
            setCollapsed((value) => !value);
            /* Width transitions can change where the slot sits without changing
               its size, which the slot observer alone cannot see. */
            window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
          }}
        >
          <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
        </button>
      </div>

      <nav className="main-nav" aria-label="Rooms">
        {TABS.map((entry) => (
          <a
            key={entry.id}
            className={`nav-item${tab === entry.id ? ' active' : ''}`}
            href={entry.href}
            aria-current={tab === entry.id ? 'page' : undefined}
            aria-label={collapsed ? entry.label : undefined}
            title={collapsed ? entry.label : undefined}
            onClick={(event) => {
              /* Let modified clicks open a new tab; plain clicks stay in-app. */
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (entry.id !== tab) onNavigate(entry.id);
            }}
          >
            <span aria-hidden="true">{entry.glyph}</span>
            {collapsed ? null : (
              <em>{entry.label}</em>
            )}
          </a>
        ))}
      </nav>

      <div className="sidenav__search">
        {collapsed ? (
          <button
            type="button"
            className="sidenav__search-btn"
            aria-label="Search courses and lines"
            title="Search"
            onClick={() => {
              wantsSearchFocus.current = true;
              setCollapsed(false);
            }}
          >
            <span aria-hidden="true">⌕</span>
          </button>
        ) : (
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              onQuery(text);
              onSearchSubmit();
            }}
          >
            <span aria-hidden="true">⌕</span>
            <input
              ref={inputRef}
              type="search"
              name="course-search"
              value={text}
              placeholder="Search courses, lines…"
              aria-label="Search courses and lines"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setText('');
                  onQuery('');
                }
              }}
            />
          </form>
        )}
      </div>

      <div className="sidebar-bottom">
        {BOARD_TABS.includes(tab) ? <BoardUtility /> : null}

        <button
          type="button"
          className="nav-item sidenav__action"
          aria-pressed={soundOn}
          aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
          title={soundOn ? 'Mute sounds' : 'Unmute sounds'}
          onClick={onToggleSound}
        >
          <span aria-hidden="true">{soundOn ? '◉' : '◌'}</span>
          {collapsed ? null : <em>Sound {soundOn ? 'on' : 'off'}</em>}
        </button>

        <button
          type="button"
          className="nav-item sidenav__action"
          aria-label="Settings"
          title="Settings"
          onClick={onSettings}
        >
          <span aria-hidden="true">⚙</span>
          {collapsed ? null : <em>Settings</em>}
        </button>

        <button
          type="button"
          className="nav-item sidenav__action"
          aria-label="Export data"
          title="Export data"
          onClick={onExport}
          disabled={busy !== null}
        >
          <span aria-hidden="true">↓</span>
          {collapsed ? null : (
            <em>{busy === 'export' ? 'Exporting…' : 'Export data'}</em>
          )}
        </button>

        <button
          type="button"
          className="nav-item sidenav__action"
          aria-label="Import data"
          title="Import data"
          onClick={onImport}
          disabled={busy !== null}
        >
          <span aria-hidden="true">↑</span>
          {collapsed ? null : (
            <em>{busy === 'import' ? 'Importing…' : 'Import data'}</em>
          )}
        </button>
      </div>
    </aside>
  );
}

export default memo(SideNavComponent);
