import React, { Component, useEffect } from "react"
import Playground from "./pages/playground"
import Compare from "./pages/compare"
import Settings from "./pages/settings"

import { createBrowserRouter, Link, Router, RouterProvider } from "react-router-dom"
import ErrorPage from "./error-page"
import { Toaster } from "./components/ui/toaster"
import { useToast } from "./hooks/ui/use-toast"
import { ToastAction } from "./components/ui/toast"

const ENDPOINT_URL = process.env.NODE_ENV === "production" || !process.env.ENDPOINT_URL ? "" : process.env.ENDPOINT_URL

const CONFIG = {
  "model_providers": [
    "OpenAI",
    "HuggingFace Hosted",
    "co:here",
  ]
}
/*
ROOT LEVEL STATE FOR MODELS IN DROPDOWN
playground is able to add to that state, and settings is able to read from that state
when downloaded settings is just adding it in
*/
const router = createBrowserRouter([
  {
    path: "/",
    element: <Playground />,
    errorElement: <ErrorPage />,
  },
  {
    path: "/compare",
    element: <Compare />,
    errorElement: <ErrorPage />,
  },
  {
    path: "/settings",
    element: <Settings />,
    errorElement: <ErrorPage />,
  },
])

export const ModelContext = React.createContext({});
export const APIContext = React.createContext({});

export default function App() {
  const [availableModels, setAvailableModels] = React.useState({})
  // TODO: change apiKeyAvailable to a better variable name - as it holds the api not just booleans
  const [apiKeyAvailable, setApiKeyAvailable] = React.useState({})
  const { toast } = useToast()

  useEffect(() => {
    let model_keys = {}
    const preloadData = async (model_arr: string[], model_keys: {}) => {
      const res = await fetch(`${ENDPOINT_URL|| ""}/api/check-key-store`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          },
        body: JSON.stringify({
          model_provider: model_arr,
          })
        })
        console.log(res)
        const data = await res.json()
        console.log(data)
        let models_not_available = []
        for (key in data) {
          model_keys[key] = data[key] != "" ? true : false // if empty api key then not available 
          if (!model_keys[key]) models_not_available.push(key) 
          let APIProviderKey = "api_" + key
          model_keys[APIProviderKey] = data[key]
        }
        if (models_not_available.length > 0) {
          toast({
            variant: "destructive",
            title: "Some API keys aren't set up yet",
            description: "The following model providers need API keys to use: " + models_not_available.join(", ") + ". You can set them up on the Settings page."
          })
        }
        // set api key available or not state
        setApiKeyAvailable(model_keys)
        console.log("main render done")
    }
    let model_arr = []
    for (var key in CONFIG["model_providers"]) {
      model_arr.push(CONFIG["model_providers"][key])
    }
    preloadData(model_arr, model_keys)
  }, [])

  return (
    <APIContext.Provider value={{ apiKeyAvailable: apiKeyAvailable, setApiKeyAvailable: setApiKeyAvailable }}>
      <ModelContext.Provider value={{ availableModels: availableModels, setAvailableModels: setAvailableModels }}>
        <RouterProvider router={router} />
        <Toaster />
      </ModelContext.Provider>
    </APIContext.Provider>
  )
}
