import React, { useEffect } from "react"
import {Playground, Compare, Settings} from "./pages"
import {SSE} from "sse.js"
import {
  EditorState,
  convertFromRaw,
} from "draft-js"
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import { Toaster } from "./components/ui/toaster"
import { useToast } from "./hooks/ui/use-toast"
import { SIGN_IN } from "./constans"
import { IsLoggedIn, beginLoginFlow, getAccessToken, getPathToRedirect } from "./utils/auth"
import LoginCallback from "./pages/login_callback"

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

export const APIContext = React.createContext({});
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

const APIContextWrapper = ({children}) => {
  const pendingCompletionRequest = React.useRef(false);
  const textCompletionSubscribers = React.useRef([]);
  const chatCompletionSubscribers = React.useRef([]);
  const notificationSubscribers = React.useRef([]);

  useEffect(() => {
    const sse_request = new SSE("/api/notifications",{headers: { "Authorization": `Bearer ${getAccessToken()}` } })
    
    sse_request.addEventListener("notification", (event: any) => {
      const parsedEvent = JSON.parse(event.data);
      notificationSubscribers.current.forEach((callback) => {
        callback(parsedEvent.message);
      })
    });
    sse_request.stream();
  }, [])

  const Model = {
    getAll: async () => (await fetch("/api/models",{headers: {"Authorization": `Bearer ${getAccessToken()}`}})).json(),
    getAllEnabled: async () => (await fetch("/api/models-enabled", {headers: {"Authorization": `Bearer ${getAccessToken()}`}})).json(),
    toggle: async (provider, model) => (await fetch(`/api/provider/${provider}/model/${encodeURIComponent(model)}/toggle-status`,{headers: {"Authorization": `Bearer ${getAccessToken()}`}})).json(),
    search: async (provider, query) => (await fetch(`/api/provider/${provider}/models/search?query=${query}`,{headers: {"Authorization": `Bearer ${getAccessToken()}`}})).json(),
  };

  const Notifications = {
    subscribe: (callback) => {
      notificationSubscribers.current.push(callback);
    },
    unsubscribe: (callback) => {
      notificationSubscribers.current = notificationSubscribers.current.filter((cb) => cb !== callback);
    },
  };
  
  const Provider = {
    setAPIKey: async (provider, apiKey) => (await fetch(`/api/provider/${provider}/api-key`, {method: "PUT", headers: {"Content-Type": "application/json", "Authorization": `Bearer ${getAccessToken()}`}, 
      body: JSON.stringify({apiKey: apiKey})}
    )).json(),
    getAll: async () => (await fetch("/api/providers", {headers: {"Authorization": `Bearer ${getAccessToken()}`}})).json(),
    getAllWithModels: async () => (await fetch("/api/providers-with-key-and-models", {headers: {"Authorization": `Bearer ${getAccessToken()}`}})).json(),
  };
  
  const Inference = {
    subscribeTextCompletion: (callback) => {
      textCompletionSubscribers.current.push(callback);
    },
    unsubscribeTextCompletion: (callback) => {
      textCompletionSubscribers.current = textCompletionSubscribers.current.filter((cb) => cb !== callback);
    },
    textCompletionRequest: createTextCompletionRequest,
    subscribeChatCompletion: (callback) => {
      chatCompletionSubscribers.current.push(callback);
    },
    unsubscribeChatCompletion: (callback) => {
      chatCompletionSubscribers.current = chatCompletionSubscribers.current.filter((cb) => cb !== callback);
    },
    chatCompletion: createChatCompletionRequest,
  };
  
  const [apiContext, _] = React.useState({
    Model,
    Notifications,
    Provider,
    Inference,
  });
  
  function createTextCompletionRequest({prompt, models}) {
    const url = "/api/inference/text/stream";
    const payload = {
      prompt: prompt,
      models: models,
    };
    return createCompletionRequest(url, payload, textCompletionSubscribers);
  }
  
  function createChatCompletionRequest(prompt, model) {
    const url = "/api/inference/chat/stream";
    const payload = {prompt, model};
    return createCompletionRequest(url, payload, chatCompletionSubscribers);
  }
  
  function createCompletionRequest(url, payload, subscribers) {
    pendingCompletionRequest.current = true;
    let sse_request = null;
  
    function beforeUnloadHandler() {
      if (sse_request) sse_request.close();
    }
  
    window.addEventListener("beforeunload", beforeUnloadHandler);
    const completionsBuffer = createCompletionsBuffer(payload.models);
    let error_occured = false;
    let request_complete = false;
  
    sse_request = new SSE(url, { payload: JSON.stringify(payload), headers: { "Authorization": `Bearer ${getAccessToken()}` } });
  
    bindSSEEvents(sse_request, completionsBuffer, {error_occured, request_complete}, beforeUnloadHandler, subscribers);
  
    return () => {
      if (sse_request) sse_request.close();
    };
  }

  function createCompletionsBuffer(models) {
    const buffer = {};
    models.forEach((model) => {
      buffer[model.tag] = [];
    });
    return buffer;
  }
  
  function bindSSEEvents(sse_request, completionsBuffer, requestState, beforeUnloadHandler, subscribers) {
    sse_request.onopen = async () => {
      bulkWrite(completionsBuffer, requestState, subscribers);
    };
  
    sse_request.addEventListener("infer", (event) => {
      let resp = JSON.parse(event.data);
      completionsBuffer[resp.modelTag].push(resp);
    });
  
    sse_request.addEventListener("status", (event) => {
      subscribers.current.forEach((callback) => callback({
        event: "status",
        data: JSON.parse(event.data)
      }));
    });
  
    sse_request.addEventListener("error", (event) => {
      requestState.error_occured = true;
      try {
        const message = JSON.parse(event.data);
  
        subscribers.current.forEach((callback) => callback({
          "event": "error",
          "data": message.status 
        }));
      } catch (e) {
        subscribers.current.forEach((callback) => callback({
          "event": "error",
          "data": "Unknown error"
        }));
      }
  
      close_sse(sse_request, requestState, beforeUnloadHandler, subscribers);
    });
  
    sse_request.addEventListener("abort", () => {
      requestState.error_occured = true;
      close_sse(sse_request, requestState, beforeUnloadHandler, subscribers);
    });
  
    sse_request.addEventListener("readystatechange", (event) => {
      if (event.readyState === 2) close_sse(sse_request, requestState, beforeUnloadHandler, subscribers);
    });
  
    sse_request.stream();
  }

  function close_sse(sse_request, requestState, beforeUnloadHandler, subscribers) {
    requestState.request_complete = true;
    subscribers.current.forEach((callback) => callback({
      "event": "close",
      "meta": {error: requestState.error_occured},
    }));
    window.removeEventListener("beforeunload", beforeUnloadHandler);
  }  
  
  function bulkWrite(completionsBuffer, requestState, subscribers) {
    setTimeout(() => {
      let newTokens = false;
      let batchUpdate = {};
  
      for (let modelTag in completionsBuffer) {
        if (completionsBuffer[modelTag].length > 0) {
          newTokens = true;
          batchUpdate[modelTag] = completionsBuffer[modelTag].splice(0, completionsBuffer[modelTag].length);
        }
      }
  
      if (newTokens) {
        subscribers.current.forEach((callback) => callback({
          event: "completion",
          data: batchUpdate,
        }));
      }
  
      if (!requestState.request_complete) bulkWrite(completionsBuffer, requestState, subscribers);
    }, 20);
  }

  return (
    <APIContext.Provider value={apiContext}>
      {children}
    </APIContext.Provider>
  )
}

const PlaygroundContextWrapper = ({page, children}) => {
  const apiContext = React.useContext(APIContext)

  const [editorContext, _setEditorContext] = React.useState(DEFAULT_CONTEXTS.PAGES[page].editor);
  const [parametersContext, _setParametersContext] = React.useState(DEFAULT_CONTEXTS.PAGES[page].parameters);
  let [modelsStateContext, _setModelsStateContext] = React.useState(DEFAULT_CONTEXTS.PAGES[page].modelsState);
  const [modelsContext, _setModelsContext] = React.useState(DEFAULT_CONTEXTS.MODELS);
  const [historyContext, _setHistoryContext] = React.useState(DEFAULT_CONTEXTS.PAGES[page].history);

  /* Temporary fix for models that have been purged remotely but are still cached locally */
  for(const {name} of modelsStateContext) {
    if (!modelsContext[name]) {
      modelsStateContext = modelsStateContext.filter(({name: _name}) => _name !== name)
    }
  }
  
  const editorContextRef = React.useRef(editorContext);
  const historyContextRef = React.useRef(historyContext);

  React.useEffect(() => {
    historyContextRef.current = historyContext;
    editorContextRef.current = editorContext;
  }, [historyContext, editorContext]);

  const {toast} = useToast()

  useEffect(() => {
    const notificationCallback = ({event, data, meta}) => {
      console.warn("NOTIFICATION CALLBACK", event, data)

      switch (event) {
        case "modelAdded":
          toast({
            title: "New Model is available!",
            description: `${data.provider}'s model ${data.model} has been added to the playground!`,
          })

          updateModelsData().catch(console.error)
        break;

        case "modelRemoved":
          toast({
            title: "Model removed!",
            description: `${data.provider}'s model ${data.model} has been removed from the playground!`,
          })

          updateModelsData().catch(console.error)
        break;

        default:
          console.log("Unknown event????", event, data);
        break;
      }
    }
    
    apiContext.Notifications.subscribe(notificationCallback)

    return () => {
      apiContext.Notifications.unsubscribe(notificationCallback);
    };
  }, []);

  const updateModelsData = async () => {
    const json_params = await apiContext.Model.getAllEnabled()
    const models = {};
    
    const PAGE_MODELS_STATE = SETTINGS.pages[page].modelsState;
     
    for (const [model_key, modelDetails] of Object.entries(json_params)) {
      const existingModelEntry = (PAGE_MODELS_STATE.find((model) => model.name === model_key));

      if (!existingModelEntry) {
        PAGE_MODELS_STATE.push({
          name: model_key,
          tag: model_key,
          capabilities: modelDetails.capabilities,
          provider: modelDetails.provider,
          model_endpoint: modelDetails.model_endpoint,
          parameters: Object.entries(modelDetails.parameters).reduce((acc, [key, fields]) => {
            acc[key] = fields.value;
            return acc;
          }, {}),
          enabled: (page === "compare") ? false : true,
          selected: false
          })
      } else {
        if (!existingModelEntry.parameters) {
          existingModelEntry.capabilites = modelDetails.capabilities,
          existingModelEntry.provider = modelDetails.provider,
          existingModelEntry.tag = model_key;
          existingModelEntry.model_endpoint = modelDetails.model_endpoint;
          existingModelEntry.parameters = Object.entries(modelDetails.parameters).reduce((acc, [key, fields]) => {
            acc[key] = fields.value;
            return acc;
          }, {});
        }
      }

      models[model_key] = {
        name: model_key,
        capabilities: modelDetails.capabilities,
        defaultParameters: modelDetails.parameters,
        provider: modelDetails.provider,
      }
    }
      
    const SERVER_SIDE_MODELS = Object.keys(json_params);
    for (const {name} of PAGE_MODELS_STATE) {
      if (!SERVER_SIDE_MODELS.includes(name)) {
        PAGE_MODELS_STATE.splice(PAGE_MODELS_STATE.findIndex((model) => model.name === name), 1)
      }
    }

    setModelsContext(models)
    setModelsStateContext(PAGE_MODELS_STATE)
  }

  const debouncedSettingsSave = useDebounce(saveSettings, 3000);

  const setEditorContext = (newEditorContext, immediate=false) => {
    SETTINGS.pages[page].editor = {...SETTINGS.pages[page].editor, ...newEditorContext};

    const _editor = {...SETTINGS.pages[page].editor, internalState: null };

    _setEditorContext(_editor);
    if (immediate) {
      saveSettings()
    } else {
      debouncedSettingsSave()
    }
  }

  const setParametersContext = (newParameters) => {
    const parameters = { ...DEFAULT_PARAMETERS_STATE, ...newParameters}
    SETTINGS.pages[page].parameters = parameters;

    debouncedSettingsSave()
    _setParametersContext(parameters);
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
    updateModelsData().catch(console.error)
  }, [])

  return (
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
  )
}

export const LazyNavigate: React.FC<{ def: string }> = ({ def }) => {
  const route = getPathToRedirect()
  if (route) {
    localStorage.removeItem("path_before_signin")
  }
  return <Navigate to={route || def} replace />
}

export const LoggedInRequired: React.FC = () => {
  const loggedIn = IsLoggedIn()
  const location = useLocation()

  // If user is not logged in store visited page link and redirect user to login page
  if (
    !loggedIn &&
    location.pathname.length > 1 &&
    !location.pathname.includes(SIGN_IN)
  ) {
    localStorage.setItem(
      'path_before_signin',
      location.pathname + location.search ?? ''
    )
  }
  return <Navigate to={SIGN_IN} replace />
}

const AuthLogin = () => {
  useEffect(() => {
    beginLoginFlow()
  }, [])
  return null
}

function ProviderWithRoutes() {
    return (
      <Routes>
        <Route
          path="/"
          element={ IsLoggedIn() ?
            <APIContextWrapper>
              <PlaygroundContextWrapper key = "playground" page = "playground">
                <Playground/>
                <Toaster />
              </PlaygroundContextWrapper>
            </APIContextWrapper>
            : <LoggedInRequired/>
          }
        />

        <Route
          path="/compare"
          element={IsLoggedIn() ?
            <APIContextWrapper>
              <PlaygroundContextWrapper key = "compare" page = "compare">
                <Compare/>
                <Toaster />
              </PlaygroundContextWrapper>
            </APIContextWrapper>
            : <LoggedInRequired/>
          }
        />

        <Route
          path="/settings"
          element={IsLoggedIn() ?
            <APIContextWrapper>
              <Settings />
              <Toaster />
            </APIContextWrapper>
            :<LoggedInRequired/>
          }
        />

        <Route
          path="/signin"
          element={
            IsLoggedIn() ?
            <LazyNavigate def="/" />
            : <AuthLogin />
          }
        />

        <Route
          path="/auth/callback"
          element={
            IsLoggedIn() ?
            <LazyNavigate def="/" />
            : <LoginCallback />
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