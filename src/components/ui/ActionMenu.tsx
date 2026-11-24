import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
} from 'react';
import { ChevronDown } from 'lucide-react';

export interface ActionMenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'emerald' | 'amber' | 'danger';
  dividerBefore?: boolean;
  fileAccept?: string;
  onFileChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

export interface ActionMenuProps {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  items: ActionMenuItem[];
  variant?: 'navy' | 'blue' | 'gold' | 'emerald' | 'secondary';
  align?: 'start' | 'end';
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const VARIANT_CLASSES: Record<NonNullable<ActionMenuProps['variant']>, string> = {
  navy: 'bg-[#0B1F3A] hover:bg-[#1E4E8C] text-white border border-[#0B1F3A]',
  blue: 'bg-[#1E4E8C] hover:bg-[#0B1F3A] text-white border border-[#1E4E8C]',
  gold: 'bg-[#F5E6B3] hover:bg-[#ebd796] text-[#0B1F3A] border border-[#C59B27]',
  emerald: 'bg-emerald-700 hover:bg-emerald-800 text-white border border-emerald-700',
  secondary: 'bg-white hover:bg-slate-100 text-[#0B1F3A] border border-slate-300',
};

const TONE_CLASSES: Record<NonNullable<ActionMenuItem['tone']>, string> = {
  default: 'text-[#0B1F3A] hover:bg-slate-50',
  primary: 'text-[#1E4E8C] hover:bg-sky-50/70',
  emerald: 'text-emerald-800 hover:bg-emerald-50/80',
  amber: 'text-amber-900 hover:bg-amber-50/80',
  danger: 'text-red-700 hover:bg-red-50/80',
};

export function ActionMenu({
  label,
  icon: TriggerIcon,
  items,
  variant = 'navy',
  align = 'end',
  disabled = false,
  size = 'md',
  className = '',
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const sizeClass =
    size === 'sm'
      ? 'min-h-[38px] px-3 py-1.5 text-xs'
      : 'min-h-[44px] px-3.5 py-2 text-xs sm:text-sm';

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center justify-between gap-2 rounded-lg font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${sizeClass} ${VARIANT_CLASSES[variant]}`}
      >
        <span className="inline-flex items-center gap-2">
          {TriggerIcon && (
            <TriggerIcon
              className={`w-4 h-4 shrink-0 ${
                variant === 'navy' || variant === 'blue' ? 'text-[#C59B27]' : ''
              }`}
            />
          )}
          <span>{label}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Hidden file inputs remain mounted cleanly outside dropdown open state */}
      {items
        .filter((it) => Boolean(it.onFileChange))
        .map((it) => (
          <input
            key={`file-${it.id}`}
            ref={(el) => {
              fileInputRefs.current[it.id] = el;
            }}
            type="file"
            accept={it.fileAccept || '.xlsx,.xls,.csv'}
            onChange={(e) => {
              it.onFileChange?.(e);
            }}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
        ))}

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={`absolute top-full mt-1.5 z-50 min-w-[235px] max-w-[92vw] rounded-xl border border-slate-200 bg-white shadow-xl py-1.5 text-right ${
            align === 'start' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item) => {
            const ItemIcon = item.icon;
            const tone = item.tone ?? 'default';
            return (
              <div key={item.id}>
                {item.dividerBefore && <div className="my-1 border-t border-slate-100" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    if (item.onFileChange) {
                      fileInputRefs.current[item.id]?.click();
                    } else {
                      item.onClick?.();
                    }
                  }}
                  className={`w-full px-3.5 py-2.5 flex items-start gap-2.5 text-right transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${TONE_CLASSES[tone]}`}
                >
                  {ItemIcon && <ItemIcon className="w-4 h-4 shrink-0 mt-0.5 opacity-85" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold leading-snug">{item.label}</span>
                    {item.description && (
                      <span className="block text-[11px] font-normal text-slate-500 mt-0.5 leading-snug">
                        {item.description}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
