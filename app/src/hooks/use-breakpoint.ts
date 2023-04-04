// @ts-ignore
// https://stackoverflow.com/a/71098593/2865073
import { useMediaQuery } from "react-responsive"
import resolveConfig from "tailwindcss/resolveConfig"
import tailwindConfig from "../../tailwind.config"
const fullConfig = resolveConfig(tailwindConfig)

const breakpoints = fullConfig.theme?.screens

type BreakpointKey = keyof typeof breakpoints

export function useBreakpoint<K extends BreakpointKey>(breakpointKey: any) {
  const bool = useMediaQuery({
    query: `(min-width: ${breakpoints[breakpointKey]})`,
  })
  const capitalizedKey =
    breakpointKey[0].toUpperCase() + breakpointKey.substring(1)
  type Key = `is${Capitalize<K>}`
  return {
    [`is${capitalizedKey}`]: bool,
  } as Record<any, boolean>
}
