import PlaySection from './play/PlaySection';

/**
 * Playing tab: New Game / Current Game / Game History.
 *
 * The tab is a hash route (`#/play`); the three views are local state so moving
 * between them never unmounts a live game.
 */
export default function PlayPage() {
  return (
    <section className="page page--play" aria-label="Play">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Playing room</p>
          <h1>Play a game</h1>
          <p className="subheading">
            Thirteen personalities, two bots, and a clock that behaves like a real one — all
            local, all saved here.
          </p>
        </div>
      </header>
      <PlaySection />
    </section>
  );
}
