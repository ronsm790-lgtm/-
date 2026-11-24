import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { RotateCcw } from 'lucide-react';

export interface UndoEntry {
  id: string;
  label: string;
  undo: () => Promise<void> | void;
}

interface UndoContextValue {
  stack: UndoEntry[];
  pushUndo: (label: string, undo: () => Promise<void> | void) => void;
  triggerUndo: () => Promise<void>;
  clearUndo: () => void;
  isUndoing: boolean;
  lastMessage: string | null;
}

const UndoContext = createContext<UndoContextValue | null>(null);

export function UndoProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<UndoEntry[]>([]);
  const [isUndoing, setIsUndoing] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const pushUndo = useCallback((label: string, undo: () => Promise<void> | void) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setStack((prev) => [...prev.slice(-24), { id, label, undo }]);
  }, []);

  const clearUndo = useCallback(() => {
    setStack([]);
  }, []);

  const triggerUndo = useCallback(async () => {
    if (isUndoing) return;
    const latest = stack[stack.length - 1];
    if (!latest) return;

    setIsUndoing(true);
    try {
      await latest.undo();
      setStack((prev) => prev.slice(0, -1));
      setLastMessage(`تم التراجع عن: ${latest.label}`);
      setTimeout(() => setLastMessage(null), 3500);
    } catch (err) {
      setLastMessage(err instanceof Error ? err.message : 'تعذر تنفيذ التراجع');
      setTimeout(() => setLastMessage(null), 4000);
    } finally {
      setIsUndoing(false);
    }
  }, [isUndoing, stack]);

  const value = useMemo(
    () => ({
      stack,
      pushUndo,
      triggerUndo,
      clearUndo,
      isUndoing,
      lastMessage,
    }),
    [stack, pushUndo, triggerUndo, clearUndo, isUndoing, lastMessage]
  );

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
}

export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    throw new Error('useUndo must be used within UndoProvider');
  }
  return ctx;
}

export function FloatingUndoButton() {
  const { stack, triggerUndo, isUndoing, lastMessage } = useUndo();

  if (stack.length === 0 && !lastMessage) {
    return null;
  }

  const latest = stack[stack.length - 1];

  return (
    <div className="no-print fixed bottom-4 left-4 z-40 flex flex-col items-start gap-2 max-w-[calc(100vw-2rem)]">
      {lastMessage && (
        <div
          role="status"
          className="px-3 py-2 rounded-lg bg-[#0B1F3A] text-white text-xs font-semibold shadow-lg border border-slate-700"
        >
          {lastMessage}
        </div>
      )}
      {latest && (
        <button
          type="button"
          onClick={() => void triggerUndo()}
          disabled={isUndoing}
          aria-label={`تراجع عن ${latest.label}`}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs sm:text-sm font-bold shadow-lg border border-amber-500 transition-colors cursor-pointer disabled:opacity-60"
        >
          <RotateCcw className={`w-4 h-4 shrink-0 ${isUndoing ? 'animate-spin' : ''}`} />
          <span className="truncate max-w-[230px]">
            {isUndoing ? 'جاري التراجع...' : `تراجع (${stack.length}): ${latest.label}`}
          </span>
        </button>
      )}
    </div>
  );
}
