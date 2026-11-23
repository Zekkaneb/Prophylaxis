import { useCallback, useEffect, useRef, useState } from 'react';
import SideNav, { type TabId } from './components/SideNav';
import Dashboard from './components/Dashboard';
import CourseLibrary from './components/CourseLibrary';
import StudyView from './components/StudyView';
import Drill from './components/Drill';
import PlayPage from './components/PlayPage';
import WoodpeckerTrainer from './components/WoodpeckerTrainer';
import GameReviewDashboard from './components/GameReviewDashboard';
import AnalysisPage from './components/AnalysisPage';
import SettingsDrawer from './components/SettingsDrawer';
import AccountMenu from './components/AccountMenu';
import { PersistentBoardProvider } from './board/PersistentBoard';
import { listCourses } from './courses/courseService';
import type { PgnCourseRecord } from './courses/types';
import { createBackup, downloadBackup, restoreBackup } from './services/backupService';
import { useAppearance } from './theme/ThemeProvider';
import './shell.css';

/* -------------------------------------------------------------------------- */
/*                                  Routing                                   */
/* -------------------------------------------------------------------------- */

interface Route {
  tab: TabId;
  /** Present on `#/courses/<id>`: the course open in the study view. */
  courseId: string | null;
}

const TAB_IDS: TabId[] = [
  'dashboard',
  'courses',
  'drill',
  'play',
  'review',
  'analysis',
  'puzzles',
];

/** Tabs that are a fixed-height board room: the window never scrolls there. */
const WORKBENCH_TABS: TabId[] = ['play', 'review', 'analysis', 'puzzles'];

/**
 * Old links keep working: the tools hub and the retired How To / Classroom
 * tabs fold into the five current destinations.
 */
const LEGACY_HASHES: Record<string, string> = {
  '#/how-to': '#/dashboard',
  '#/classroom': '#/courses',
  '#/tools/repertoire': '#/courses',
  '#/tools/woodpecker': '#/puzzles',
  '#/tools/review': '#/review',
  '#/openings': '#/courses',
  '#/woodpecker': '#/puzzles',
  '#/review': '#/review',
  '#/tools/analysis': '#/analysis',
};

function parseRoute(hash: string): Route {
  const raw = LEGACY_HASHES[hash] ?? hash;
  const parts = raw
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  const tab = TAB_IDS.find((entry) => entry === parts[0]) ?? 'dashboard';
  const courseId = tab === 'courses' && parts[1] ? parts[1] : null;
  return { tab, courseId };
}

function hashFor(route: Route): string {
  if (route.tab === 'courses' && route.courseId) {
    return `#/courses/${encodeURIComponent(route.courseId)}`;
  }
  return `#/${route.tab}`;
}

/* -------------------------------------------------------------------------- */
/*                                    App                                     */
/* -------------------------------------------------------------------------- */

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const routeRef = useRef(route);

  const [course, setCourse] = useState<PgnCourseRecord | null>(null);
  const [query, setQuery] = useState('');
  /* A finished game handed from Play to Review, analysed as soon as it opens. */
  const [reviewGameId, setReviewGameId] = useState<string | null>(null);
  /* A line handed from the sandbox to Review, analysed the same way. */
  const [reviewPgn, setReviewPgn] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const { soundOn, setSoundOn, fitBoard } = useAppearance();
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(
    null,
  );

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const go = useCallback((patch: Partial<Route>) => {
    const next: Route = { ...routeRef.current, ...patch };
    const hash = hashFor(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    routeRef.current = next;
    setRoute(next);
  }, []);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    const sync = () => {
      const next = parseRoute(window.location.hash);
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  /* Load the course referenced by `#/courses/<id>` (and drop stale ids). */
  useEffect(() => {
    if (route.tab !== 'courses' || !route.courseId) {
      setCourse(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listCourses();
        if (cancelled) return;
        const found = rows.find((entry) => entry.course_id === route.courseId);
        if (found) setCourse(found);
        else go({ courseId: null });
      } catch (cause) {
        if (!cancelled) notify(`Could not open that course: ${(cause as Error).message}`, 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [go, notify, route.courseId, route.tab]);

  const handleExport = useCallback(async () => {
    setBusy('export');
    try {
      const payload = await createBackup();
      downloadBackup(payload);
      const total = Object.values(payload.tables).reduce(
        (sum, rows) => sum + (rows?.length ?? 0),
        0,
      );
      notify(`Exported ${total} records to a backup file.`);
    } catch (cause) {
      notify(`Export failed: ${(cause as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const handleImport = useCallback(
    async (file: File) => {
      const confirmed = window.confirm(
        'Importing a backup replaces all locally stored reviews, puzzles, courses and drill history. Continue?',
      );
      if (!confirmed) {
        if (fileInput.current) fileInput.current.value = '';
        return;
      }
      setBusy('import');
      try {
        const summary = await restoreBackup(file);
        notify(`Restored ${summary.total} records from “${file.name}”.`);
      } catch (cause) {
        notify(`Import failed: ${(cause as Error).message}`, 'error');
      } finally {
        setBusy(null);
        if (fileInput.current) fileInput.current.value = '';
      }
    },
    [notify],
  );

  /* Stable handlers: the memoised pages only re-render when their data moves. */
  const navigateTab = useCallback((tab: TabId) => go({ tab, courseId: null }), [go]);
  const openCourse = useCallback(
    (courseId: string) => go({ tab: 'courses', courseId }),
    [go],
  );
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const exitStudy = useCallback(() => go({ courseId: null }), [go]);
  const openReview = useCallback(() => go({ tab: 'review', courseId: null }), [go]);
  const startGameReview = useCallback(
    (gameId: string) => {
      setReviewGameId(gameId);
      go({ tab: 'review', courseId: null });
    },
    [go],
  );
  const clearReviewGame = useCallback(() => setReviewGameId(null), []);
  const startPgnReview = useCallback(
    (pgn: string) => {
      setReviewGameId(null);
      setReviewPgn(pgn);
      go({ tab: 'review', courseId: null });
    },
    [go],
  );
  const clearReviewPgn = useCallback(() => setReviewPgn(null), []);
  const openDrill = useCallback(() => go({ tab: 'drill', courseId: null }), [go]);
  const openPuzzles = useCallback(() => go({ tab: 'puzzles', courseId: null }), [go]);
  const handleSearchSubmit = useCallback(
    () => go({ tab: 'courses', courseId: null }),
    [go],
  );
  const handleToggleSound = useCallback(() => setSoundOn(!soundOn), [setSoundOn, soundOn]);
  const handleExportClick = useCallback(() => void handleExport(), [handleExport]);
  const handleImportClick = useCallback(() => fileInput.current?.click(), []);

  /* Every room opens on a fitted board: the corner grip is the only manual
     adjustment left, so a stale size never follows the user into a new board. */
  useEffect(() => {
    fitBoard();
  }, [fitBoard, route.tab]);

  /* A board room holds the whole window; a document page scrolls inside it. */
  const locked = WORKBENCH_TABS.includes(route.tab) || Boolean(route.tab === 'courses' && course);

  return (
    <PersistentBoardProvider>
    <div className={`app-shell${locked ? ' app-shell--locked' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <AccountMenu />

      <SideNav
        tab={route.tab}
        soundOn={soundOn}
        busy={busy}
        query={query}
        onQuery={setQuery}
        onSearchSubmit={handleSearchSubmit}
        onNavigate={navigateTab}
        onSettings={openSettings}
        onExport={handleExportClick}
        onImport={handleImportClick}
        onToggleSound={handleToggleSound}
      />

      <div className="app-shell__body">
      <main className="app-main" id="main" tabIndex={-1}>
        <div className="view">
          {route.tab === 'dashboard' && (
            <Dashboard
              onNavigate={navigateTab}
              onOpenCourse={openCourse}
              onOpenDrill={openDrill}
              onOpenReview={openReview}
              onOpenPuzzles={openPuzzles}
            />
          )}

          {route.tab === 'courses' &&
            (course ? (
              <StudyView
                key={course.course_id}
                course={course}
                onExit={exitStudy}
                onNotify={notify}
                onOpenSettings={openSettings}
                onOpenReview={openReview}
              />
            ) : (
              <div className="page page--courses">
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">Courses</p>
                    <h1>
                      Your repertoire <em>library.</em>
                    </h1>
                    <p className="subheading">
                      Import a PGN study, pick the side you play, and every line becomes
                      something to read, test and drill.
                    </p>
                  </div>
                  <div className="heading-actions">
                    <button type="button" className="secondary-btn" onClick={openDrill}>
                      Open drill
                    </button>
                  </div>
                </div>

                <CourseLibrary
                  query={query}
                  onClearSearch={() => setQuery('')}
                  onStudy={openCourse}
                  onNotify={notify}
                />
              </div>
            ))}

          {route.tab === 'drill' && (
            <Drill onBrowseCourses={() => navigateTab('courses')} onNotify={notify} />
          )}

          {route.tab === 'play' && <PlayPage onReviewGame={startGameReview} />}

          {route.tab === 'review' && (
            <div className="page page--review">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">Analysis</p>
                  <h1>
                    Review your <em>games.</em>
                  </h1>
                  <p className="subheading">
                    Stockfish runs in your browser — every move graded, no upload.
                  </p>
                </div>
              </div>
              <GameReviewDashboard
                initialGameId={reviewGameId}
                onInitialConsumed={clearReviewGame}
                initialPgn={reviewPgn}
                onInitialPgnConsumed={clearReviewPgn}
              />
            </div>
          )}

          {route.tab === 'analysis' && (
            <div className="page page--analysis">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">Analysis</p>
                  <h1>
                    Explore the <em>position.</em>
                  </h1>
                  <p className="subheading">
                    A scratchpad board with a live engine — nothing is saved and no game is
                    touched.
                  </p>
                </div>
              </div>
              <AnalysisPage onSendToReview={startPgnReview} />
            </div>
          )}

          {route.tab === 'puzzles' && (
            <div className="page page--puzzles">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">Puzzles</p>
                  <h1>
                    Cycle the <em>same puzzles.</em>
                  </h1>
                  <p className="subheading">
                    One frozen set, replayed until the pattern is automatic — speed and
                    accuracy tell you when to move on.
                  </p>
                </div>
              </div>
              <WoodpeckerTrainer />
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div
          className={`app__toast ${toast.tone === 'error' ? 'is-error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onExport={handleExportClick}
        onImport={handleImportClick}
        dataBusy={busy}
      />

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImport(file);
        }}
      />
    </div>
    </PersistentBoardProvider>
  );
}
