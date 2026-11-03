'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@classloom/ui/lib/utils';

/** An on/off setting. Label it with `aria-labelledby` or a wrapping label; 44 px on touch. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer border-input focus-visible:border-ring focus-visible:ring-ring/50 data-checked:bg-primary data-checked:border-primary data-unchecked:bg-input/60 dark:data-unchecked:bg-input/80 relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors outline-none after:absolute after:inset-x-0 after:-inset-y-2.5 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-background pointer-events-none block size-5 translate-x-0.5 rounded-full shadow-sm transition-transform data-checked:translate-x-[1.375rem]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
