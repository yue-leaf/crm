import React, { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type Props = Omit<React.ComponentProps<typeof Button>, 'onClick' | 'asChild'> & {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
};

// Keep the original label in the layout while only this button awaits its action.
export function ActionButton({ onClick, disabled, children, className = '', ...props }: Props) {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const click = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (running.current || disabled) { event.preventDefault(); return; }
    running.current = true;
    try {
      const result = onClick?.(event);
      if (result && typeof result.then === 'function') {
        if (mounted.current) setPending(true);
        await result;
      }
    } catch (error: unknown) {
      if (mounted.current) toast.error(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return <Button {...props} className={`crm-action-button ${className}`} disabled={disabled || pending}
    aria-busy={pending} onClick={click}>
    <span className="crm-action-label" style={{ opacity: pending ? 0 : undefined }}>{children}</span>
    {pending && <span className="crm-action-spinner" aria-hidden="true"><LoaderCircle size={16} className="spin" /></span>}
  </Button>;
}
