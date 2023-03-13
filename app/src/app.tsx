import React, { useEffect } from "react"
import Playground from "./pages/playground"
import Compare from "./pages/compare"
import Settings from "./pages/settings"
import {
  BrowserRouter,
  Route,
  Routes,
  useNavigate
} from "react-router-dom"

import { Toaster } from "./components/ui/toaster"
import { useToast } from "./hooks/ui/use-toast"

const ENDPOINT_URL =
  process.env.NODE_ENV === "production" || !process.env.ENDPOINT_URL
    ? ""
    : process.env.ENDPOINT_URL

export const ModelContext = React.createContext({});
export const APIContext = React.createContext({});

function RoutesProvider() {
  const [availableModels, setAvailableModels] = React.useState({})
  
  return (
      <ModelContext.Provider value={{ availableModels: availableModels, setAvailableModels: setAvailableModels }}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                  <Playground />
                  <Toaster />
              </>
            }
          />
          <Route
            path="/compare"
            element={
              <>
                  <Compare />
                  <Toaster />
              </>
            }
          />
          <Route
            path="/settings"
            element={
              <>
                  <Settings />
                  <Toaster />
              </>
            }
          />
        </Routes>
      </ModelContext.Provider>
  );
}

export default function App() {
  // TODO: change apiKeyAvailable to a better variable name - as it holds the api not just booleans
  const [modelsInformation, setModelsInformation] = React.useState({})
  const { toast } = useToast()

  useEffect(() => {
    let model_keys = {}
    const preloadData = async (model_keys: {}) => {
      const res = await fetch(ENDPOINT_URL.concat("/api/check-key-store"), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          },
        })
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
        console.log("model keys", model_keys)
        setModelsInformation(model_keys)
    }
    preloadData(model_keys)
  }, [])
  
  return (
    <BrowserRouter>
      <APIContext.Provider value={{ modelsInformation: modelsInformation, setModelsInformation: setModelsInformation }}>
        <RoutesProvider />
      </APIContext.Provider>
    </BrowserRouter>
  )
}