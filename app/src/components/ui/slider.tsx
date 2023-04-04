"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "../../lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => {
  const [isDragging, setIsDragging] = React.useState(false);
  const { onValueChange, onValueCommit, ...rest } = props;

  const _onValueChange = (value) => {
    //remove classes ease-in duration-500
    if (thumbRef.current) thumbRef.current.parentElement.classList.remove("ease-in", "duration-500")

    if (!isDragging) setIsDragging(true);
    if (onValueChange) onValueChange(value)
  }

  const _onValueCommit = (value) => {
    setIsDragging(false);
    if(onValueCommit) onValueCommit(value)
  }

  const thumbRef = React.useRef(null);

  React.useEffect(() => {
    setTimeout(() => {
      //prevent animation on initial render
      thumbRef.current.parentElement.classList.add("ease-in", "duration-500");
    }, 0)
    
  }, []);

  return (
  <SliderPrimitive.Root
    onValueChange={_onValueChange}
    onValueCommit={_onValueCommit}
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...rest}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <SliderPrimitive.Range className={`absolute h-full bg-slate-600  dark:bg-slate-800 ${isDragging ? "" : "ease-in duration-500" }`} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb ref={thumbRef}
      className={`block h-4 w-4 rounded-full border-2 border-slate-800 bg-white transition-colors focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:pointer-events-none disabled:bg-slate-200  disabled:opacity-50 dark:border-slate-100 dark:bg-slate-400 dark:focus:ring-slate-400 dark:focus:ring-offset-slate-900 ${isDragging ? "cursor-grabbing" : "cursor-grab ease-in duration-500" } disabled:cursor-default`} />
  </SliderPrimitive.Root>
)})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
