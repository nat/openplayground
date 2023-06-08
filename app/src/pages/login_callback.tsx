/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { finishLoginFlow } from '../utils/auth'

const LoginCallback = () => {
  const [searchParams] = useSearchParams()
  const code = searchParams.get('code')

  useEffect(() => {
    if (code) {
      finishLoginFlow(code)
    }
  }, [])

  return (
    <div className="h-full w-full prose flex flex-col justify-center items-center max-w-full">
      <h2>Logging you in ...</h2>
    </div>
  )
}

export default LoginCallback
