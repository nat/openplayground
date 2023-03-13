import React from "react"
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
  return (
    <BrowserRouter>
      <RoutesProvider />
    </BrowserRouter>
  )
}