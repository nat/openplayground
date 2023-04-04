import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

export const useCtrlMetaKeyPress = (keys: any, callback: any, node = null) => {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  })

  const handleKeyPress = useCallback(
    (event: any) => {
      if (event.metaKey && event.ctrlKey && keys.some((key: any) => event.key === key)) {
        callbackRef.current(event)
      }
    },
    [keys]
  )

  useEffect(() => {
    const targetNode = node ?? document
    targetNode && targetNode.addEventListener("keydown", handleKeyPress)

    return () =>
      targetNode && targetNode.removeEventListener("keydown", handleKeyPress)
  }, [handleKeyPress, node])
}