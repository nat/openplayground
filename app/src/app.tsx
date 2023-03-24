import React, { useEffect } from "react"
import Playground from './pages/playground';
import Compare from './pages/compare';
import Settings from './pages/settings';
import {SSE} from "sse.js"
import {
  EditorState,
  convertFromRaw,
} from "draft-js"
import {
  BrowserRouter,
  Route,
  Routes,
} from "react-router-dom"
import { Toaster } from "./components/ui/toaster"
import { useToast } from "./hooks/ui/use-toast"

const ENDPOINT_URL = process.env.NODE_ENV === "production" || !process.env.ENDPOINT_URL ? "" : process.env.ENDPOINT_URL

const DEFAULT_PARAMETERS_STATE = {
  temperature: 1.0,
  maximumLength: 200,
  topP: 0.9,
  topK: 0,
  repetitionPenalty: 1.0,
  frequencyPenalty: 0.0,
  presencePenalty: 0.0,
  stopSequences: [],
  highlightModels: true,
  showProbabilities: false
}

const DEFAULT_EDITOR_STATE = {
  prompt: "",
  prePrompt: "",
  internalState: null
}

const DEFAULT_HISTORY_STATE = {
  show: false,
  entries: [],
  current: null
}

const DEFAULT_CONTEXTS = {
  PAGES: {
    playground:{
      history: DEFAULT_HISTORY_STATE,
      editor: {...DEFAULT_EDITOR_STATE, previousInternalState: null  },
      modelsState: [],
      parameters: DEFAULT_PARAMETERS_STATE
    },
    compare:{
      history: DEFAULT_HISTORY_STATE,
      editor: DEFAULT_EDITOR_STATE,
      modelsState: [],
      parameters: {
        ...DEFAULT_PARAMETERS_STATE,
        selectAllModels: false,
        showParametersTable: false
      }
    },
  },
  MODELS: [],
}

let SETTINGS = null;

try {
  SETTINGS = JSON.parse(localStorage.getItem("openplayground_settings"));
  if (!SETTINGS) throw new Error("no settings")
} catch (e) {
  localStorage.clear();
  SETTINGS = {};
} finally {
  if (!SETTINGS.pages) {
    SETTINGS.pages = DEFAULT_CONTEXTS.PAGES;
  }
  if (!SETTINGS.models) {
    SETTINGS.models = DEFAULT_CONTEXTS.MODELS;
  }
}

DEFAULT_CONTEXTS.PAGES = SETTINGS.pages;
DEFAULT_CONTEXTS.MODELS = SETTINGS.models;

//Remove me soon
export const ModelContext = React.createContext({});

export const APIContext = React.createContext({ENDPOINT_URL: ENDPOINT_URL});

export const EditorContext = React.createContext({});
export const ModelsStateContext = React.createContext([]);
export const ParametersContext = React.createContext({});
export const HistoryContext = React.createContext({});
export const ModelsContext = React.createContext(DEFAULT_CONTEXTS.MODELS);

const saveSettings = () => {
  let _settings = JSON.stringify(SETTINGS)
  let SETTINGS_SIZE = _settings.length * 2 / 1024 / 1024;

  if (SETTINGS_SIZE >= 5) {
    const shouldDownloadHistory = confirm("Local Storage is full. Do you wish to download your history prior to clearing storage?");

    const first_entry = SETTINGS.pages["playground"].history.entries.shift()

    if (shouldDownloadHistory) {
      const element = document.createElement("a")
      const history_json = SETTINGS.pages["playground"].history.entries.map((entry: any) => {
        const model = entry.modelsState.find(({selected}) => selected)
        const text = EditorState.createWithContent(convertFromRaw(entry.editor.internalState)).getCurrentContent().getPlainText()
        return {
          model: model.name,
          date: entry.date,
          timestamp: entry.timestamp,
          text: text,
          parameters: entry.parameters
        }
      })

      const file = new Blob([JSON.stringify(history_json)], {
        type: "application/json",
      })
      element.href = URL.createObjectURL(file)
      element.download = "history.json"
      document.body.appendChild(element)
      element.click()
    }

    SETTINGS.pages["playground"].history.entries = [first_entry]
    SETTINGS.pages["playground"].history.current = first_entry
    _settings = JSON.stringify(SETTINGS)
  }

  localStorage.setItem("openplayground_settings", _settings)
}

function useDebounce(func, delay) {
  const timeoutRef = React.useRef(null);

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, []);

  function debouncedFunction(...args) {
    clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      func(...args);
    }, delay);
  }

  return debouncedFunction;
}

const ContextWrapper = ({page, children}) => {
  const pendingCompletionRequest = React.useRef(false);
  const apiSubscribers = React.useRef([]);
 
  const [apiContext, _] = React.useState({
    ENDPOINT_URL: ENDPOINT_URL,
    subscribe_completion: (callback) => {
      apiSubscribers.current.push(callback);
    },
    unsubscribe_completion: (callback) => {
      apiSubscribers.current = apiSubscribers.current.filter((cb) => cb !== callback);
    },
    completion_request: ({prompt, models}) => {
      pendingCompletionRequest.current = true;
      let sse_request = null;

      function beforeUnloadHandler() {
        if (sse_request) sse_request.close()
      }

      window.addEventListener('beforeunload', beforeUnloadHandler);
 
      const completionsBuffer = {};
      let error_occured = false;
      let request_complete = false;
      sse_request = new SSE(
        ENDPOINT_URL.concat('/api/stream'),
        {
          payload: JSON.stringify({
          prompt: prompt,
          models: models.map((model) => {
            completionsBuffer[model.tag] = [];
            return model
          }),
        })
        }
      )
          
      apiSubscribers.current.forEach((callback) => callback({
        "event": "open"
      }))

      sse_request.onopen = async () => {
        const bulk_write = () => {
          setTimeout(() => {
            let newTokens = false;
            let batchUpdate = {};
                
            for (let modelTag in completionsBuffer) {
              if (completionsBuffer[modelTag].length > 0) {
                newTokens = true;
                batchUpdate[modelTag] = completionsBuffer[modelTag].splice(0, completionsBuffer[modelTag].length)
              }
            }
      
            if (newTokens) {
              apiSubscribers.current.forEach((callback) => callback({
                event: "completion",
                data: batchUpdate
              }));
            }

            if (!request_complete) bulk_write();
          }, 20)
        };
        bulk_write();
      }

      sse_request.addEventListener("infer", (event: any) => {
        let resp = JSON.parse(event.data)
        completionsBuffer[resp.modelTag].push(resp)
      });
      
      sse_request.addEventListener("status", (event: any) => {
        apiSubscribers.current.forEach((callback) => callback({
          event: "status",
          data: JSON.parse(event.data)
        }))
      });
      
      const close_sse = () => {
        request_complete = true;
        apiSubscribers.current.forEach((callback) => callback({
          "event": "close",
          "meta": {error: error_occured}
        }))
        window.removeEventListener('beforeunload', beforeUnloadHandler);
      }
      
      sse_request.addEventListener("error", (event) => {
        error_occured = true;
        try {
          const message = JSON.parse(event.data)

          apiSubscribers.current.forEach((callback) => callback({
            "event": "error",
            "data": message.status 
          }))
        } catch (e) {
          apiSubscribers.current.forEach((callback) => callback({
            "event": "error",
            "data": "Unknown error"
          }))
        }
              
        close_sse();
      });
      
      sse_request.addEventListener("abort", (event) => {
        error_occured = true;
        close_sse();
      });
      
      sse_request.addEventListener("readystatechange", (event) => {
        if (event.readyState === 2) close_sse();
      });
      
      sse_request.stream();
 
      const cancel_callback = () => {
        apiSubscribers.current.forEach((callback) => callback({
          "event": "cancel",
        }))

        if (sse_request) sse_request.close();
      }

      return cancel_callback;
    },
    cancelCompletionRequest: () => {
      pendingCompletionRequest.current = false;
    }
  });

  const [editorContext, _setEditorContext] = React.useState(DEFAULT_CONTEXTS.PAGES[page].editor);
  const [parametersContext, _setParametersContext] = React.useState(DEFAULT_CONTEXTS.PAGES[page].parameters);
  const [modelsStateContext, _setModelsStateContext] = React.useState(DEFAULT_CONTEXTS.PAGES[page].modelsState);
  const [modelsContext, _setModelsContext] = React.useState(DEFAULT_CONTEXTS.MODELS);
  const [historyContext, _setHistoryContext] = React.useState(DEFAULT_CONTEXTS.PAGES[page].history);
  
  const editorContextRef = React.useRef(editorContext);
  const historyContextRef = React.useRef(historyContext);

  React.useEffect(() => {
    historyContextRef.current = historyContext;
    editorContextRef.current = editorContext;
  }, [historyContext, editorContext]);

  const debouncedSettingsSave = useDebounce(saveSettings, 3000);

  const setEditorContext = (newEditorContext) => {
    //console.warn("Setting the editor....", newEditorContext)
    SETTINGS.pages[page].editor = {...SETTINGS.pages[page].editor, ...newEditorContext};

    const _editor = {...SETTINGS.pages[page].editor, internalState: null };

    _setEditorContext(_editor);
    debouncedSettingsSave()
  }

  const setParametersContext = (newParameters) => {
    SETTINGS.pages[page].parameters = newParameters;

    debouncedSettingsSave()
    _setParametersContext(SETTINGS.pages[page].parameters);
  }

  const setModelsContext = (newModels) => {
    SETTINGS.models = newModels;
    
    debouncedSettingsSave()
    _setModelsContext(newModels);
  }

  const setModelsStateContext = (newModelsState) => {
    SETTINGS.pages[page].modelsState = newModelsState;
    
    debouncedSettingsSave()
    _setModelsStateContext(newModelsState);
  }

  const toggleShowHistory = (value) => {
    const _newHistory = {
      ...SETTINGS.pages[page].history,
      show: (value === undefined || value === null) ? !SETTINGS.pages[page].history.show : value
    }

    _setHistoryContext(_newHistory);

    SETTINGS.pages[page].history = _newHistory;
    debouncedSettingsSave()
  }

  const addHistoryEntry = (editorState) => {
    //check if device is mobile by navigator
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) return;

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    
    const newEntry = {
      timestamp:  currentDate.getTime(),
      date:     `${year}-${month}-${day}`,
      editor:      {
        ...editorContextRef.current,
        internalState: editorState
      },
      parameters:  SETTINGS.pages[page].parameters,
      modelsState: SETTINGS.pages[page].modelsState,
    }

    const _newHistory = {
      ...SETTINGS.pages[page].history,
      entries: [newEntry, ...SETTINGS.pages[page].history.entries],
      current: newEntry
    }

    _setHistoryContext(_newHistory);

    //console.warn("Adding to history", _newHistory)
    SETTINGS.pages[page].history = _newHistory;
    debouncedSettingsSave()
  }

  const removeHistoryEntry = (entry) => {
    const _newHistory = {
      ...SETTINGS.pages[page].history,
      entries: SETTINGS.pages[page].history.entries.filter((historyEntry) => historyEntry !== entry)
    }

    _setHistoryContext(_newHistory);

    SETTINGS.pages[page].history = _newHistory;
    debouncedSettingsSave()
  }

  const clearHistory = () => {
    const _newHistory = {
      entries: [],
      show: false,
      current: null
    }

    _setHistoryContext(_newHistory);

    SETTINGS.pages[page].history = _newHistory;
    debouncedSettingsSave()
  }

  const selectHistoryItem = (entry) => {
    SETTINGS.pages[page].history.current = entry;
    _setEditorContext(entry.editor);

    _setHistoryContext(SETTINGS.pages[page].history);
    setParametersContext(entry.parameters);
    setModelsStateContext(entry.modelsState);
  }

  React.useEffect(() => {
    const fetchDefaultParameters = async () => {
      const response = await fetch(
        ENDPOINT_URL.concat("/api/all_models"),
        {
          method: "GET",
        }
      )
 
      const json_params = await response.json();
      const models = {};
    
      const PAGE_MODELS_STATE = SETTINGS.pages[page].modelsState;
     
      for (const [model_key, modelDetails] of Object.entries(json_params)) {
        const existingModelEntry = (PAGE_MODELS_STATE.find((model) => model.name === model_key));

        if (!existingModelEntry) {
          PAGE_MODELS_STATE.push({
            name: model_key,
            tag: model_key,
            provider: modelDetails.provider,
            parameters: Object.entries(modelDetails.parameters).reduce((acc, [key, fields]) => {
              acc[key] = fields.value;
              return acc;
            }, {}),
            enabled: (page === "compare") ? false : true,
            selected: false
          })
        } else {
          if (!existingModelEntry.parameters) {
            existingModelEntry.provider = modelDetails.provider,
            existingModelEntry.tag = model_key;
            existingModelEntry.parameters = Object.entries(modelDetails.parameters).reduce((acc, [key, fields]) => {
              acc[key] = fields.value;
              return acc;
            }, {});
          }
        }

        models[model_key] = {
          name: model_key,
          defaultParameters: modelDetails.parameters,
          provider: modelDetails.provider,
        }
      }
      
      const SERVER_SIDE_MODELS = Object.keys(json_params); // We purge models often, no need to keep them in the local storage
      for (const {name} of PAGE_MODELS_STATE) {
        if (!SERVER_SIDE_MODELS.includes(name)) {
          PAGE_MODELS_STATE.splice(PAGE_MODELS_STATE.findIndex((model) => model.name === name), 1)
        }
      }

      setModelsContext(models)
      setModelsStateContext(PAGE_MODELS_STATE)
    }
  
    fetchDefaultParameters().catch(console.error)
  }, [])

  return (
    <APIContext.Provider value = {apiContext}>
      <HistoryContext.Provider value = {{
        historyContext, selectHistoryItem,
        addHistoryEntry, removeHistoryEntry, clearHistory, toggleShowHistory
      }}>
        <EditorContext.Provider value = {{editorContext, setEditorContext}}>
          <ParametersContext.Provider value = {{parametersContext, setParametersContext}}>
            <ModelsContext.Provider value = {{modelsContext, setModelsContext}}>
              <ModelsStateContext.Provider value = {{modelsStateContext, setModelsStateContext}}>
                {children}
              </ModelsStateContext.Provider>
            </ModelsContext.Provider>
          </ParametersContext.Provider>
        </EditorContext.Provider>
      </HistoryContext.Provider>
    </APIContext.Provider>
  )
}

const SettingsWrapper = ({children}) => {
  const { toast } = useToast()
  const [availableModels, setAvailableModels] = React.useState({})
  const [modelsInformation, setModelsInformation] = React.useState({})

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
      console.log("yo!!")
      console.log(data)
      console.log("hiiii!")
      // the issue is here, something goes wrong here? 
      let models_not_available = []
      for (key in data) {
        console.log(key, data[key])
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
      console.log(models_not_available)
      // set api key available or not state
      console.log("model keys", model_keys)
      setModelsInformation(model_keys)
    }
    preloadData(model_keys)
  }, [])

  return (
    <APIContext.Provider value={{ modelsInformation: modelsInformation, setModelsInformation: setModelsInformation }}>
      <ModelContext.Provider value={{ availableModels: availableModels, setAvailableModels: setAvailableModels }}>
        {children}
      </ModelContext.Provider>
      <Toaster />
    </APIContext.Provider>
  )
}

function ProviderWithRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ContextWrapper key = "playground" page = "playground">
            <Playground/>
          </ContextWrapper>
        }
      />

      <Route
        path="/compare"
        element={
          <ContextWrapper key = "compare" page = "compare">
            <Compare/>
          </ContextWrapper>
        }
      />

      <Route
        path="/settings"
        element={
          <SettingsWrapper>
            <Settings />
          </SettingsWrapper>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ProviderWithRoutes />
    </BrowserRouter>
  )
}