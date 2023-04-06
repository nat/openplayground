import { FC, ReactNode, useEffect, useRef } from "react"

const ScrollContainer: FC<{ children: ReactNode }> = ({ children }) => {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  // FIXME: We don't actually need this effect. We just need to differentiate
  // between first and subsequent renders in the `useEffect` below.
  useEffect(() => {
    const outerHeight = outerRef.current!.clientHeight
    const innerHeight = innerRef.current!.clientHeight

    outerRef.current!.scrollTo({
      top: innerHeight - outerHeight,
      left: 0,
    })
  }, [])

  useEffect(() => {
    const outerHeight = outerRef.current!.clientHeight
    const innerHeight = innerRef.current!.clientHeight

    outerRef.current!.scrollTo({
      top: innerHeight - outerHeight,
      left: 0,
      behavior: "smooth",
    })
  }, [children])

  return (
    <div
      className="relative h-full overflow-scroll overscroll-contain"
      ref={outerRef}
    >
      <div className="relative" ref={innerRef}>
        {children}
      </div>
    </div>
  )
}

export default ScrollContainer
