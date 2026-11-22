/* --------------------------------------------------------------------------
   The one and only board.

   `PersistentBoardProvider` sits above the tab router and renders a single
   <ChessBoardWrapper> instance for the whole app. Views no longer render a
   board themselves: they render a <BoardSlot>, which only reserves the board's
   box in their layout and publishes the props that view wants (position,
   arrows, interactivity, handlers) to the shared instance.

   Switching tabs therefore never mounts, unmounts or resizes the board. The
   layer is measured against the active slot and clipped to that slot's scroll
   viewport, so an oversized board still pans inside its own panel and never
   paints over the rails.
   -------------------------------------------------------------------------- */

import {
  Component,
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import ChessBoardWrapper, {
  type ChessBoardWrapperHandle,
  type ChessBoardWrapperProps,
} from '../components/ChessBoardWrapper';
import BoardScaleGrip from '../components/BoardScaleGrip';
import './PersistentBoard.css';

/**
 * Keeps a board that cannot be measured yet from taking the app down.
 *
 * The board measures its squares to size the pieces; in a tab that is not
 * laying out (backgrounded, mid-navigation) that measurement is missing and the
 * board throws "Square width not found". The failure is transient, so it is
 * contained here and retried a few times instead of reaching the app's error
 * boundary, where it would replace the whole screen.
 */
class BoardGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private retries = 0;
  private timer: number | null = null;

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    if (import.meta.env.DEV) console.warn('[board] the board is not laid out yet', error);
    if (this.retries >= 3) return;
    this.retries += 1;
    this.timer = window.setTimeout(() => this.setState({ failed: false }), 400 * this.retries);
  }

  componentWillUnmount(): void {
    if (this.timer) window.clearTimeout(this.timer);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

interface BoardStore {
  getProps: () => ChessBoardWrapperProps;
  getSlot: () => HTMLElement | null;
  subscribe: (listener: () => void) => () => void;
  publish: (slot: HTMLElement | null, props: ChessBoardWrapperProps) => void;
}

function createBoardStore(): BoardStore {
  let props: ChessBoardWrapperProps = {};
  let slot: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getProps: () => props,
    getSlot: () => slot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(nextSlot, nextProps) {
      if (slot === nextSlot && props === nextProps) return;
      slot = nextSlot;
      props = nextProps;
      emit();
    },
  };
}

export interface BoardLayer {
  /** The single board handle; views drive playback/reset through this. */
  handle: RefObject<ChessBoardWrapperHandle | null>;
  publish: (slot: HTMLElement | null, props: ChessBoardWrapperProps) => void;
}

const BoardLayerContext = createContext<BoardLayer | null>(null);

/** The shared board handle, for views that need `playMoves` / `reset`. */
export function useBoardHandle(): RefObject<ChessBoardWrapperHandle | null> {
  const layer = useContext(BoardLayerContext);
  if (!layer) {
    throw new Error('useBoardHandle must be used inside <PersistentBoardProvider>.');
  }
  return layer.handle;
}

/* -------------------------------------------------------------------------- */
/*                                   Layer                                    */
/* -------------------------------------------------------------------------- */

/** The nearest ancestor that clips, or null when only the viewport does. */
function findClipHost(slot: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = slot.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return node;
    node = node.parentElement;
  }
  return null;
}

function PersistentBoard({ store }: { store: BoardStore }) {
  const props = useSyncExternalStore(store.subscribe, store.getProps, store.getProps);
  const handle = useBoardHandle();
  const clipRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const clip = clipRef.current;
    const frame = frameRef.current;
    if (!clip || !frame) return;

    let raf = 0;
    let observed: HTMLElement | null = null;
    /* The clipping ancestor is cached: walking the tree and reading computed
       styles on every scroll frame is what made long pages feel heavy. */
    let host: HTMLElement | null = null;
    let clipWidth = -1;
    let clipHeight = -1;
    let frameWidth = -1;
    let frameHeight = -1;

    function measure() {
      raf = 0;
      if (!clip || !frame) return;
      const slot = store.getSlot();
      if (observed !== slot) {
        slotObserver.disconnect();
        observed = slot;
        host = slot ? findClipHost(slot) : null;
        if (slot) {
          slotObserver.observe(slot);
          /* The slot's container can change width without the slot changing
             size (a folding side rail shifts a height-limited board), so watch
             one level up as well. */
          if (slot.parentElement) slotObserver.observe(slot.parentElement);
          /* The clip is the slot ∩ its scroll host, so the host resizing (a
             board column giving width back to the transport, say) moves the
             window even when the board itself keeps its size. */
          if (host) slotObserver.observe(host);
        }
      }
      if (!slot || !slot.isConnected) {
        clip.style.visibility = 'hidden';
        return;
      }

      const box = slot.getBoundingClientRect();
      const hostBox = host?.isConnected ? host.getBoundingClientRect() : null;
      // The viewport always clips; the slot's own scroll area clips on top of
      // that, so a panned board never spills over the surrounding panels.
      const left = Math.max(box.left, hostBox?.left ?? 0, 0);
      const top = Math.max(box.top, hostBox?.top ?? 0, 0);
      const right = Math.min(box.right, hostBox?.right ?? window.innerWidth, window.innerWidth);
      const bottom = Math.min(
        box.bottom,
        hostBox?.bottom ?? window.innerHeight,
        window.innerHeight,
      );

      if (!box.width || !box.height || right - left < 2 || bottom - top < 2) {
        clip.style.visibility = 'hidden';
        return;
      }

      const width = right - left;
      const height = bottom - top;
      clip.style.visibility = 'visible';
      /* Transform, not left/top: the clip box then slides on the compositor
         instead of forcing a layout mid-scroll. */
      clip.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      if (clipWidth !== width || clipHeight !== height) {
        clipWidth = width;
        clipHeight = height;
        clip.style.width = `${width}px`;
        clip.style.height = `${height}px`;
      }
      frame.style.transform = `translate3d(${box.left - left}px, ${box.top - top}px, 0)`;
      /* The slot owns the board's size (fitted to the window), so the layer is
         always exactly as big as the box the view reserved: no oversized board
         to pan, no second sizing rule to keep in sync. */
      if (frameWidth !== box.width || frameHeight !== box.height) {
        frameWidth = box.width;
        frameHeight = box.height;
        frame.style.width = `${box.width}px`;
        frame.style.height = `${box.height}px`;
        /* Published for the overlays inside the board (badge size): they scale
           with the square, so they need the board's real pixel width. */
        frame.style.setProperty('--board-px', `${Math.round(box.width)}px`);
      }
    }

    function schedule() {
      if (raf) return;
      raf = window.requestAnimationFrame(measure);
    }

    const slotObserver = new ResizeObserver(schedule);

    measureRef.current = measure;
    measure();

    /* No transitionrun/transitionend: every hover in the app fired one of those
       and re-measured the board. Layout changes now reach us through the two
       observers, scroll and resize. */
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    const documentObserver = new ResizeObserver(schedule);
    documentObserver.observe(document.documentElement);
    /* Web fonts and piece art land late and shift the slot once. */
    document.fonts?.ready.then(schedule).catch(() => {});

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      slotObserver.disconnect();
      documentObserver.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      measureRef.current = () => {};
    };
  }, [store]);

  /* A new view publishing its slot/props: re-measure before the next paint. */
  useLayoutEffect(() => {
    measureRef.current();
  }, [props]);

  return (
    <div className="board-layer">
      <div className="board-layer__clip" ref={clipRef} style={{ visibility: 'hidden' }}>
        <div className="board-layer__board" ref={frameRef}>
          <BoardGuard>
            <ChessBoardWrapper ref={handle} {...props} />
            {/* The board's own corner arrow: in the layer, with the board, so
                it rides the frame's corner on every screen and can never be
                buried under a view's wrapper. */}
            <BoardScaleGrip />
          </BoardGuard>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Provider                                  */
/* -------------------------------------------------------------------------- */

export function PersistentBoardProvider({ children }: { children: ReactNode }) {
  const store = useMemo(createBoardStore, []);
  const handle = useRef<ChessBoardWrapperHandle | null>(null);
  const layer = useMemo<BoardLayer>(
    () => ({ handle, publish: store.publish }),
    [store],
  );

  return (
    <BoardLayerContext.Provider value={layer}>
      {children}
      <PersistentBoard store={store} />
    </BoardLayerContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Slot                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reserves the board's box in a view and hands that view's board props to the
 * shared instance. Renders nothing visible: the board itself lives in the
 * persistent layer above the router.
 */
export function BoardSlot({
  props,
  className,
}: {
  props: ChessBoardWrapperProps;
  className?: string;
}) {
  const layer = useContext(BoardLayerContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !layer) return;
    layer.publish(element, latest.current);
    return () => {
      // Keep the props: the next view publishes its own before paint, and
      // clearing them here would flash the board back to an empty position.
      layer.publish(null, latest.current);
    };
  });

  return (
    <div
      ref={ref}
      className={className ? `board-slot ${className}` : 'board-slot'}
      data-board-slot=""
    />
  );
}
