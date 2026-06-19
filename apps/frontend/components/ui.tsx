'use client';

import { LucideIcon } from 'lucide-react';
import {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export { toast } from 'sonner';

/* ============================ Spinner ============================ */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ============================ Button ============================ */
type BtnSize = 'sm' | 'md' | 'lg';
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

const btnSizes: Record<BtnSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded',
  md: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  lg: 'h-10 px-4 text-sm gap-2 rounded-md',
};
const btnVariants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary/90 shadow-1',
  secondary: 'bg-surface-2 text-fg border border-border hover:bg-surface-3',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  outline: 'border border-line text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-1',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: BtnSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon: IconC, iconRight: IconR, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium transition-app',
        'disabled:cursor-not-allowed disabled:opacity-50',
        btnSizes[size],
        btnVariants[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : IconC && <IconC size={size === 'sm' ? 13 : 15} strokeWidth={2} />}
      {children}
      {IconR && <IconR size={size === 'sm' ? 13 : 15} strokeWidth={2} />}
    </button>
  ),
);
Button.displayName = 'Button';

export function IconButton({ icon: IconC, label, size = 'md', className, ...props }: { icon: LucideIcon; label: string; size?: BtnSize } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const dim = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8';
  return (
    <button
      aria-label={label}
      title={label}
      className={cn('inline-flex items-center justify-center rounded-md text-fg-muted transition-app hover:bg-surface-2 hover:text-fg', dim, className)}
      {...props}
    >
      <IconC size={16} strokeWidth={2} />
    </button>
  );
}

/* ============================ Inputs ============================ */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: boolean; icon?: LucideIcon }>(
  ({ className, error, icon: IconC, ...props }, ref) => (
    <div className="relative">
      {IconC && <IconC size={15} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />}
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-md border bg-surface px-3 text-sm text-fg placeholder:text-fg-faint transition-app',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--c-ring)]',
          IconC && 'pl-8',
          error ? 'border-danger' : 'border-border',
          className,
        )}
        {...props}
      />
    </div>
  ),
);
TextInput.displayName = 'TextInput';

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint transition-app',
        'focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--c-ring)]',
        error ? 'border-danger' : 'border-border',
        className,
      )}
      {...props}
    />
  ),
);
TextArea.displayName = 'TextArea';

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn('mb-1.5 block text-xs font-medium text-fg-muted', className)}>{children}</label>;
}

/* ============================ Card ============================ */
type CardVariant = 'flat' | 'outline' | 'elevated' | 'sunken';
const cardVariants: Record<CardVariant, string> = {
  flat: 'bg-surface',
  outline: 'bg-surface border border-border',
  elevated: 'bg-surface border border-border shadow-2',
  sunken: 'bg-surface-2 border border-border',
};
export function Card({ children, className, variant = 'outline', onClick }: { children: ReactNode; className?: string; variant?: CardVariant; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn('rounded-lg p-4 transition-app', cardVariants[variant], onClick && 'cursor-pointer hover:border-line', className)}>
      {children}
    </div>
  );
}

/* ============================ Badge ============================ */
type Tone = 'neutral' | 'primary' | 'accent' | 'warn' | 'danger' | 'info' | 'success';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted border-border',
  primary: 'bg-primary-soft text-primary border-primary/30',
  accent: 'bg-accent/10 text-accent border-accent/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  info: 'bg-info/10 text-info border-info/30',
  success: 'bg-accent/10 text-accent border-accent/30',
};
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xxs font-medium', tones[tone], className)}>{children}</span>;
}

/* ============================ Chip（可选标签） ============================ */
export function Chip({ active, onClick, children, icon: IconC }: { active?: boolean; onClick?: () => void; children: ReactNode; icon?: LucideIcon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-app',
        active ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {IconC && <IconC size={13} strokeWidth={2} />}
      {children}
    </button>
  );
}

/* ============================ Avatar ============================ */
export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const ch = name?.[0] ?? '?';
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-medium text-primary', className)}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {ch}
    </span>
  );
}

/* ============================ Skeleton ============================ */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('skeleton rounded', className)} style={style} />;
}
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}
export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <Skeleton className="mb-3 h-5 w-1/2" />
      <SkeletonText lines={3} />
    </div>
  );
}

/* ============================ EmptyState ============================ */
export function EmptyState({ icon: IconC, title, desc, action }: { icon?: LucideIcon; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {IconC && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-fg-faint">
          <IconC size={22} strokeWidth={1.5} />
        </div>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {desc && <p className="mt-1 max-w-xs text-xs text-fg-muted">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ============================ ProgressBar ============================ */
export function ProgressBar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'accent' | 'danger' }) {
  const bg = tone === 'accent' ? 'bg-accent' : tone === 'danger' ? 'bg-danger' : 'bg-primary';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div className={cn('h-full rounded-full transition-all duration-app', bg)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* ============================ Switch ============================ */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-app', checked ? 'bg-primary' : 'bg-surface-3')}
    >
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow-1 transition-app', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      {label && <span className="sr-only">{label}</span>}
    </button>
  );
}

/* ============================ Tooltip ============================ */
export function Tooltip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        className={cn(
          'pointer-events-none absolute left-1/2 z-pop -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-3 px-2 py-1 text-xxs text-fg opacity-0 shadow-pop transition-app group-hover/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {label}
      </span>
    </span>
  );
}

/* ============================ Tabs（统一） ============================ */
export interface TabItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
}
export function Tabs({ tabs, value, onChange, className }: { tabs: TabItem[]; value: string; onChange: (k: string) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-border no-scrollbar', className)} role="tablist">
      {tabs.map((t) => {
        const active = t.key === value;
        const IconC = t.icon;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm transition-app',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {IconC && <IconC size={15} strokeWidth={2} />}
            {t.label}
            {t.count != null && <span className="rounded bg-surface-2 px-1 text-xxs text-fg-muted">{t.count}</span>}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        );
      })}
    </div>
  );
}

/* ============================ SegmentedControl ============================ */
export function SegmentedControl<T extends string>({ options, value, onChange, size = 'md' }: { options: { value: T; label: string; icon?: LucideIcon }[]; value: T; onChange: (v: T) => void; size?: BtnSize }) {
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5', size === 'sm' && 'text-xs')}>
      {options.map((o) => {
        const active = o.value === value;
        const IconC = o.icon;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn('inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-app', active ? 'bg-surface text-fg shadow-1' : 'text-fg-muted hover:text-fg')}
          >
            {IconC && <IconC size={13} strokeWidth={2} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================ Select（自定义下拉） ============================ */
export function Select<T extends string | number>({ value, onChange, options, placeholder, className }: { value?: T; onChange: (v: T) => void; options: { value: T; label: string }[]; placeholder?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn('flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface px-3 text-sm text-fg transition-app hover:bg-surface-2', className)}>
        <span className={cn(!current && 'text-fg-faint')}>{current?.label ?? placeholder ?? '请选择'}</span>
        <ChevronDownIcon size={15} className="text-fg-faint" />
      </button>
    }>
      <div className="max-h-60 overflow-auto py-1">
        {options.map((o) => (
          <button
            key={String(o.value)}
            onClick={() => { onChange(o.value); setOpen(false); }}
            className={cn('flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-app hover:bg-surface-2', o.value === value ? 'text-primary' : 'text-fg')}
          >
            {o.label}
            {o.value === value && <CheckIcon size={14} />}
          </button>
        ))}
      </div>
    </Popover>
  );
}

/* ============================ Dropdown / Menu ============================ */
export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  danger?: boolean;
  divider?: boolean;
}
export function Menu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} align={align} trigger={<span onClick={() => setOpen((o) => !o)}>{trigger}</span>}>
      <div className="min-w-[10rem] py-1">
        {items.map((it, i) =>
          it.divider ? (
            <div key={i} className="my-1 h-px bg-border" />
          ) : (
            <button
              key={i}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-app hover:bg-surface-2', it.danger ? 'text-danger' : 'text-fg')}
            >
              {it.icon && <it.icon size={15} strokeWidth={2} />}
              {it.label}
            </button>
          ),
        )}
      </div>
    </Popover>
  );
}

/* Popover 底件：portal + 定位（trigger 下方）+ 外部点击关闭 */
function Popover({ open, onOpenChange, trigger, children, align = 'end' }: { open: boolean; onOpenChange: (v: boolean) => void; trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const left = align === 'end' ? r.right : r.left;
    setPos({ top: r.bottom + 4, left, width: r.width });
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || contentRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open, onOpenChange]);
  return (
    <div ref={ref} className="relative inline-flex">
      {trigger}
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={contentRef}
          className="fixed z-pop min-w-[10rem] animate-scale-in rounded-md border border-border bg-surface shadow-pop"
          style={{ top: pos.top, left: align === 'end' ? pos.left - 160 : pos.left }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ============================ Modal ============================ */
type ModalSize = 'sm' | 'md' | 'lg' | 'xl';
const modalSizes: Record<ModalSize, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
export function Modal({ open, onClose, title, desc, children, footer, size = 'md', icon: IconC }: { open: boolean; onClose: () => void; title?: string; desc?: string; children: ReactNode; footer?: ReactNode; size?: ModalSize; icon?: LucideIcon }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4 animate-fade-in" onClick={onClose}>
      <div className={cn('max-h-[88vh] w-full overflow-hidden rounded-xl border border-border bg-surface shadow-3 animate-scale-in', modalSizes[size])} onClick={(e) => e.stopPropagation()}>
        {(title || IconC) && (
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            {IconC && <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary"><IconC size={17} /></div>}
            <div className="flex-1">
              {title && <h3 className="font-semibold text-fg">{title}</h3>}
              {desc && <p className="mt-0.5 text-xs text-fg-muted">{desc}</p>}
            </div>
            <IconButton icon={XIcon} label="关闭" onClick={onClose} />
          </div>
        )}
        <div className="max-h-[60vh] overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ============================ ConfirmDialog（命令式） ============================ */
interface ConfirmOpts { title: string; desc?: string; confirmText?: string; cancelText?: string; danger?: boolean; }
const ConfirmCtx = createContext<(opts: ConfirmOpts) => Promise<boolean>>(async () => false);
export function useConfirm() {
  return useContext(ConfirmCtx);
}
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    setOpen(true);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);
  const close = (v: boolean) => { setOpen(false); resolver.current?.(v); resolver.current = null; };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={open}
        onClose={() => close(false)}
        title={opts?.title}
        desc={opts?.desc}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>{opts?.cancelText ?? '取消'}</Button>
            <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{opts?.confirmText ?? '确认'}</Button>
          </>
        }
      >
        <></>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

/* ============================ Breadcrumb ============================ */
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-fg-muted">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <ChevronRightIcon size={13} className="text-fg-faint" />}
          {it.href ? <a href={it.href} className="transition-app hover:text-fg">{it.label}</a> : <span className="text-fg">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/* ============================ Sidebar / NavItem ============================ */
export function NavItem({ active, icon: IconC, label, onClick, count }: { active?: boolean; icon: LucideIcon; label: string; onClick?: () => void; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-app',
        active ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
      )}
    >
      <IconC size={16} strokeWidth={active ? 2.2 : 1.8} className={active ? 'text-primary' : ''} />
      <span className="flex-1 text-left">{label}</span>
      {count != null && count > 0 && <span className="rounded bg-surface-3 px-1.5 text-xxs text-fg-muted">{count}</span>}
    </button>
  );
}

/* ============================ Stat ============================ */
export function Stat({ label, value, icon: IconC, hint }: { label: string; value: ReactNode; icon?: LucideIcon; hint?: string }) {
  return (
    <Card variant="outline" className="p-3">
      <div className="flex items-center justify-between">
        <span className="text-overline">{label}</span>
        {IconC && <IconC size={15} className="text-fg-faint" strokeWidth={1.8} />}
      </div>
      <div className="mt-1 text-xl font-semibold text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-xxs text-fg-faint">{hint}</div>}
    </Card>
  );
}

/* ============================ Disclosure ============================ */
export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-md border border-border bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-fg">
        <span>{summary}</span>
        <ChevronDownIcon size={15} className={cn('text-fg-faint transition-app', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-border px-3 py-2 animate-fade-in">{children}</div>}
    </div>
  );
}

/* ============================ icons（lucide 重导出常用） ============================ */
import {
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  Check as CheckIcon,
  X as XIcon,
} from 'lucide-react';
