import React from "react"
import Playground from "./pages/playground"
import Compare from "./pages/compare"
import About from "./pages/about"
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
            path="/about"
            element={
              <>
                  <About />
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