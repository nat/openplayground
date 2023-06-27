import { FC, ReactNode, useEffect, useRef, useState } from "react"

const ScrollContainer: FC<{ children: ReactNode }> = ({ children }) => {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const prevRender = useRef(false)

  useEffect(() => {
    const outerHeight = outerRef.current!.clientHeight
    const innerHeight = innerRef.current!.clientHeight

    outerRef.current!.scrollTo({
      top: innerHeight - outerHeight,
      left: 0,
      behavior: prevRender.current ? "smooth" : "auto",
    })

    prevRender.current = true
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
