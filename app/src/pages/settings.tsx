import React, { useContext, useEffect, useState } from "react"
import NavBar from "../components/navbar"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { EyeIcon, EyeOffIcon, Loader2, X } from "lucide-react"
import { ScrollArea } from "../components/ui/scroll-area"
import { Checkbox } from "../components/ui/checkbox"
import { APIContext } from "../app"
import { useBreakpoint } from "../hooks/use-breakpoint"
import { useToast } from "../hooks/ui/use-toast"

interface Provider {
  name: string;
  remoteInference: boolean;
  requiresApiKey: boolean;
  apiKey: string;
  models: Model[];
  searchUrl: string | null;
}

interface Model {
  name: string;
  enabled: boolean;
  provider: string;
}

interface ProviderProps {
  provider: string;
  providerModels: Model[];
  providerSearchURL: string;
  providerSearchResults: any[];
  providerRequiresAPIKey: boolean;
  providerRemoteInference: boolean;
  apiKey: string;
  searchProviderModels: (provider: string, query: string) => void;
  setAPIKey: (key: string) => void;
  toggleModel: (provider: string, model: string) => void;
}

const ProviderSearchModels = ({
  provider,
  providerModels,
  providerRequiresAPIKey,
  apiKey,
  providerSearchURL,
  providerSearchResults,
  searchProviderModels,
  toggleModel
}: ProviderProps) => {
  if (!providerSearchURL) return null

  const handleModelSelect = (model: string, checked: boolean) => {
    toggleModel(provider, model)
  }

  const searchModel = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const searchQuery = e.target.elements["model-query"].value
      
    searchProviderModels(provider, searchQuery)
  }

  const searchResults = () => providerSearchResults.map((modelName: any) => (
    <div
      key={modelName}
      className="rounded-md border border-slate-200 px-4 py-3 my-2 font-mono text-sm dark:border-slate-700"
    >
      {modelName}
      <Checkbox
        key={modelName}
        className="float-right"
        onCheckedChange={(event) =>
          handleModelSelect(modelName, event)
        }
        checked={providerModels.find(({name}) => name === modelName)?.enabled || false}
      />
    </div>
  ))

  return (
    <>
      <h3 className="scroll-m-20 text-xl font-extrabold tracking-tight mt-2">
        Model Search
      </h3>
      <p>
        Search for a model or part of a model to get matches from {provider} Hub
      </p>

      <form onSubmit={searchModel}>
        <div className="flex w-full max-w-sm items-center space-x-2 mt-2">
          <Input
            disabled = {providerRequiresAPIKey && (apiKey === "" || apiKey === null)}
            type="text"
            id="model-query"
             placeholder="Search Query"
            className="flex text-left placeholder:text-left h-10 w-full rounded-md border border-slate-300 bg-transparent py-2 px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-50 dark:focus:ring-slate-400 dark:focus:ring-offset-slate-900"
          />
          <Button
            type="submit"
            disabled = {providerRequiresAPIKey && (apiKey === "" || apiKey === null)}
          >
            Search
          </Button>
        </div>
      </form>

      <div>
        <div className="min-h-[320px] w-full border rounded-md mt-2">
          <div className="p-2">  
            {searchResults()}
          </div>
        </div>
      </div>
    </>
  )
}

const ProviderCredentials = ({provider, providerRequiresAPIKey, apiKey, setAPIKey}: ProviderProps) => {
  if (!providerRequiresAPIKey) return null;

  const [revealAPIKey, setRevealAPIKey] = useState<boolean>(false)
  const [apiKeyCopy, setAPIKeyCopy] = React.useState<string>(apiKey)

  useEffect(() => {
    setAPIKeyCopy(apiKey)
  }, [apiKey])

  
  const apiKeyDescription = () => {
    if (apiKey !== null && apiKey !== "") return null;

    return (
      <>
        <p className="text-red-500">
          <b>No API key is saved for {provider}</b>
        </p>
            
        <p>
          Your API key allows us make generation requests for you in the playground
        </p>
      </>
    )
  }

  const handleAPIKeySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setAPIKey(apiKeyCopy)
  }

  return (
    <div>
      <h3 className="scroll-m-20 text-xl font-extrabold tracking-tight mt-2">
        API Key
      </h3>
      {apiKeyDescription()}
      <form onSubmit={handleAPIKeySubmit}>
        <div className="flex w-full max-w-lg items-center space-x-2 mt-2">
          <Input
            type={revealAPIKey ? "text" : "password"}
            placeholder={`Enter your ${provider} API Key`}
            value={apiKeyCopy || ""}
            onChange={(e) => setAPIKeyCopy(e.target.value)}
            className="flex text-left placeholder:text-left h-8 w-full rounded-md border border-slate-300 bg-transparent py-2 px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-50 dark:focus:ring-slate-400 dark:focus:ring-offset-slate-900"
          />
           
          <div
            key={provider}
            onClick={() => setRevealAPIKey(e => !e)}
            className="cursor-pointer">
            {
              revealAPIKey ? <EyeIcon className="h-5 w-5 align-middle" /> : <EyeOffIcon className="h-5 w-5 align-middle" />
            }
          </div>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </div>
  )
}

const ProviderModelSelection = ({
  provider,
  apiKey,
  providerRequiresAPIKey,
  providerModels, toggleModel
}: ProviderProps) => {
  const handleModelSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
  }
  
  const handleModelSelect = (model: string, checked: boolean) => {
    toggleModel(provider, model)
  }

  return (
    <>
      <h3 className="scroll-m-20 text-xl font-extrabold tracking-tight mt-2">
        Model Selection
      </h3>
      <p>
        Please select from the following models to show in the
        dropdown in playground
      </p>
      <form onSubmit={handleModelSubmit}>
        <div className="min-h-[320px] w-full border rounded-md mt-2">
          <div className="p-2">
            {providerModels.map((model: any) => (
            <div
              key={model.name}
              className="rounded-md border border-slate-200 px-4 py-3 my-2 font-mono text-sm dark:border-slate-700"
            >
              {model.name}
              <Checkbox
                key={model}
                className="float-right"
                disabled={providerRequiresAPIKey && (apiKey === "" || apiKey === null)}
                onCheckedChange={(event) =>
                  handleModelSelect(model.name, event)
                }
                checked={model.enabled}
              />
            </div>
            ))}
          </div>
        </div>
      </form>
    </>
  )
}

const ProviderView = (props: ProviderProps) => {
  const {provider} = props

  return (
    <div className="overflow-hidden flex col-span-6 lg:col-span-3 flex flex-row mx-2 lg:mx-0">
      <div>
        <h1 className="scroll-m-20 text-3xl font-extrabold tracking-tight">
          {provider} Setup
        </h1>
        <div className="max-h-[100%] flex-1 overflow-auto mt-2">
          <ProviderCredentials {...props}/>
          <ProviderModelSelection {...props}/>
          <ProviderSearchModels {...props}/>
        </div>
      </div>
    </div>
  )
}

interface AllSelectedModelsProps {
  enabledModels: Model[];
  toggleModel: ProviderProps["toggleModel"];
}

const AllSelectedModels = ({enabledModels, toggleModel}: AllSelectedModelsProps) => {  
  const selectedModelsCard = () => {
    return enabledModels.map((model: any) => (
      <div
        key={`selected_${model.name}_${model.provider}`}
        className="rounded-md border border-slate-200 px-4 py-3 my-2 font-mono text-sm dark:border-slate-700"
      > 
        {model.name}
        <br/>
        <span style={{"fontSize": "12px"}}>
          Provider:
          <i>{model.provider}</i>
        </span>
        <button
          key={`selected_${model}`}
          className="float-right center"
          onClick={() => toggleModel(model.provider, model.name)}
        >
          <X className="h-4 w-4" />
        </button>
        <br/>
        <span
          style={{"fontSize": "12px"}}>Status:
          <i>{model.status}</i>
        </span>
      </div>
    ))
  }
  return (
    <div className="col-span-6 lg:col-span-2 flex flex-row mx-2 lg:mx-0 ">
      <div>
        <h1 className="scroll-m-20 text-3xl font-extrabold tracking-tight">
          Your Selected Models
        </h1>

        <div className="mt-1">
          <p>These models will be available in the menu dropdown</p>
        </div>
        <div className="max-h-[100%] overflow-hidden">
          <div>
            {selectedModelsCard()}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const apiContext = useContext(APIContext)

  const [providers, setProviders] = React.useState<{[key: string]: Provider}>({});

  const [provider, setProvider] = React.useState<Provider | {}>({})
  const [providerName, setProviderName] = React.useState<string>("openai")
  const [providerSearchURL, setProviderSearchURL] = React.useState<any>(null)
  const [providerAPIKey, setProviderAPIKey] = React.useState<string>("")
  const [providerRequiresAPIKey, setProviderRequiresAPIKey] = React.useState<boolean>(true)
  const [providerRemoteInference, setProviderRemoteInference] = React.useState<boolean>(true)
  const [providerModels, setProviderModels] = React.useState<any[]>([])
  const [providerSearchResults, setProviderSearchResults] = React.useState<any[]>([])

  const [enabledModels, setEnabledModels] = React.useState<Model[]>([])

  const {toast} = useToast()
  const {isLg} = useBreakpoint("lg")

  useEffect(() => {
    const preloadData = async () => {
      const providersWithModels: { [key: string]: Provider } = await apiContext.Provider.getAllWithModels()

      const _enabledModels = Object.entries(providersWithModels)
        .map(([_, provider]: [string, Provider]) => provider.models.filter(({enabled}: {enabled: boolean}) => enabled))
        .flat()

      setProviders(providersWithModels)
      setEnabledModels(_enabledModels)
    };    
    
    const notificationCallback = ({event, data, meta}) => {
      switch (event) {
        case "modelAdded":
          toast({
            title: "New Model is available!",
            description: `${data.provider}'s model ${data.model} has been added to the playground!`,
          })

          preloadData().catch(console.error)
        break;

        case "modelRemoved":
          toast({
            title: "Model removed!",
            description: `${data.provider}'s model ${data.model} has been removed from the playground!`,
          })

          preloadData().catch(console.error)
        break;

        default:
          console.log("Unknown event????", event, data);
        break;
      }
    }
    
    apiContext.Notifications.subscribe(notificationCallback)
    preloadData().catch(console.error)
    return () => {
      apiContext.Notifications.unsubscribe(notificationCallback);
    };
  }, []);

  useEffect(() => {
    if (Object.keys(providers).length === 0) return;

    const currentProvider: Provider = providers[providerName]; 

    setProvider(currentProvider)
    setProviderAPIKey(currentProvider.apiKey)
    setProviderModels(currentProvider.models)
    setProviderRequiresAPIKey(currentProvider.requiresApiKey)
    setProviderRemoteInference(currentProvider.remoteInference)
    setProviderSearchURL(currentProvider.searchUrl)
    setProviderSearchResults((provider.name === currentProvider.name) ? providerSearchResults : [])
  }, [providerName, providers])

  const setAPIKey = async (apiKey: string ) => { 
    try {
      await apiContext.Provider.setAPIKey(providerName, apiKey);

      toast({
        title: "API Key Saved",
        description: `${providerName} API key is saved and ready for generations!`,
      })
      
      setProviders({
        ...providers,
        [providerName]: {
          ...providers[providerName],
          apiKey
        }
      })   
    } catch (error) {
      toast({
        title: "API Key Error",
        description: `There was an error saving your ${provider} API key. ${error}}`,
      })
    }
  }

  const toggleModel = async (providerName: string, modelName: string) => {
    try {
      const {enabled, model} = await apiContext.Model.toggle(providerName, modelName);
     
      const providerModel = providers[providerName].models.find((m) => m.name === modelName)
      if (providerModel) {
        providerModel.enabled = enabled
      } else {
        providerModels.push(model)
      }

      setProviders({
        ...providers,
        [providerName]: {
          ...providers[providerName],
          models: providerModels
        }
      })
      
      let _newEnabledModels = enabledModels

      if (enabled) {
        if (!_newEnabledModels.find((m) => m.name === modelName)) {
          _newEnabledModels.push(model)
        }
      } else {
        _newEnabledModels = _newEnabledModels.filter((m) => m.name !== modelName)
      }

      setEnabledModels(_newEnabledModels)
    } catch (error) {
      toast({
        title: "Model Error",
        description: `There was an error enabling your ${modelName} model. ${error}}`,
      })
    }
  }

  const searchProviderModels = async (providerName: string, searchTerm: string) => {
    try {
      const models = await apiContext.Model.search(providerName, searchTerm);

      setProviderSearchResults(models.map((model: any) => model.name))
    } catch (error) {
      toast({
        title: "Model Error",
        description: `There was an error searching for models. ${error}}`,
      })
    }
  }

  const providersButtons = () => 
    Object.entries(providers).map(([name, _]) => 
      <React.Fragment key={name}>
        <button
          className={`block w-full text-left px-2 py-1 border-l-2 ${
            providerName === name ? "border-blue-500" : "border-transparent"
          }`}
          onClick={(e) => setProviderName(name)}
        >
          <span className={providerName === name ? "font-bold": "font-normal"}>{name}</span>
        </button>
      </React.Fragment>
    )

  return (
    <div className="flex flex-col h-full">
      <NavBar tab="settings" />
      <div className="flex flex-1 flex-col font-display flex-grow overflow-hidden">
        <div className="max-h-[100%] lg:flex-grow grid gap-6 grid-cols-6 mx-1 lg:mx-5 flex flex-row">
          <div className="flex col-span-6 lg:flex-col lg:col-span-1">
            <h1 className="scroll-m-20 text-3xl mb-5 font-extrabold tracking-tight hidden lg:inline-block">
              Providers
            </h1>
            {providersButtons()}
          </div>

          <ProviderView
            apiKey={providerAPIKey}
            provider={providerName}
            providerRequiresAPIKey={providerRequiresAPIKey}
            providerRemoteInference={providerRemoteInference}
            providerModels={providerModels}
            providerSearchURL={providerSearchURL}
            providerSearchResults={providerSearchResults}

            searchProviderModels={searchProviderModels}
            setAPIKey = {setAPIKey}
            toggleModel = {toggleModel}
          />

          <AllSelectedModels
            enabledModels={enabledModels}
            toggleModel={toggleModel}
          />
        </div>
      </div>
    </div>
  )
}