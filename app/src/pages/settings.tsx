import React, { useContext, useEffect, useState } from "react"
import NavBar from "../components/navbar"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { EyeIcon, EyeOffIcon, Loader2, X } from "lucide-react"
import { Label } from "../components/ui/label"
import { ScrollArea } from "../components/ui/scroll-area"
import { Separator } from "../components/ui/separator"
import { Checkbox } from "../components/ui/checkbox"
import { APIContext, ModelContext } from "../app"
import { useBreakpoint } from "../hooks/useBreakpoint"
import { KeyBindingUtil } from "draft-js"
import { useToast } from "../hooks/ui/use-toast"
import { json } from "react-router-dom"

const ENDPOINT_URL =
  process.env.NODE_ENV === "production" || !process.env.ENDPOINT_URL
    ? ""
    : process.env.ENDPOINT_URL

// huggingface model fetch
// https://huggingface.co/api/models?pipeline_tag=text2text-generation
// https://huggingface.co/api/quicksearch?q=[MODEL]&type=model

/*
MODEL NAME PREFIXES:
huggingface --> textgeneration:
openai --> openai:
co:here --> cohere:
*/

// this is only available for huggingface textgeneration: prefixed models (textgeneration tag)
function queueModelDownload(
  model: string,
  modelProvider: string,
  availableModels: any,
  setAvailableModels: any,
  toast: any
) {
  // model here is direct path, no prefix, local storage is considered as a data store to persist models across sessions
  console.log("Downloading model", model)
  fetch(ENDPOINT_URL.concat("/api/download-model"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: model,
    })
  }).then(async (res) => {
    const data = await res.json()
    console.log("Download response", data)
    const model_key = "textgeneration:" + model
    let new_model = {}
    new_model[model_key] = model
    setAvailableModels((availableModels: any) => ({
      ...availableModels,
      ...new_model,
    }))
    // update local storage, model is now available for inference
    localStorage.setItem(
      `model_${model}`,
      JSON.stringify({
        model_provider: modelProvider,
        available: true,
      })
    )
    if (data.status === "success") {
      // we actually downloaded model
      toast({
        title: "Model Downloaded!",
        description: `${model} is now available for inference`,
      })
    }
  })
}

function useStoredModels() {
  const [storedModels, setStoredModels] = React.useState<string[]>([]) // models stored in local storage for user
  const { availableModels, setAvailableModels } = useContext(ModelContext)
  const { toast } = useToast()

  // Render "select models" sidebar with models in local storage
  React.useEffect(() => {
    // get models from localstorage
    let keys = Object.keys(localStorage)
      .filter((key_name) => {
        if (key_name.startsWith("model_")) {
          return true
        }
        return false
      })
      .map(function (item, i) {
        return item.replace("model_", "")
      })
    setStoredModels(keys)
    console.log("KEYS", keys)
  }, [])

  const saveModelSelection = (modelProvider: string, modelArr: string[]) => {
    modelArr.forEach((model) => {
      let store_val = JSON.stringify({
        model_provider: modelProvider,
        available: modelProvider === "textgeneration" ? false : true,
      })
      // model_ prefixed so easier to sort through localstorage
      localStorage.setItem(`model_${model}`, store_val)
    })
    // queue model download
    if (modelProvider === "textgeneration") {
      modelArr.forEach((model) => {
        queueModelDownload(
          model,
          modelProvider,
          availableModels,
          setAvailableModels,
          toast
        )
      })
    }
    setStoredModels([...storedModels, ...modelArr])
  }

  return { storedModels, setStoredModels, saveModelSelection }
}

function getModelProviderForStoredModel(model: string) {
  const model_key = "model_" + model
  const model_info = JSON.parse(localStorage.getItem(model_key) || "{}")
  return model_info.model_provider
}

function getIfModelDownloading(model: string) {
  const model_key = "model_" + model
  const model_info = JSON.parse(localStorage.getItem(model_key) || "{}")
  return model_info.available
}

function useHuggingFaceModelSearch() {
  const [huggingFaceSearchResults, setModelResults] = React.useState<string[]>(
    []
  )

  const searchModels = async (event: any) => {
    event.preventDefault()
    const searchQuery = event.target.elements["model-query"].value

    // Search for models and parse
    const results = await fetch(
      `https://huggingface.co/api/quicksearch?q=${searchQuery}&type=model`
    ).then((res) => res.json())
    console.log("results",  results.models.map((model: any) => model.id))
    setModelResults(results.models.map((model: any) => model.id))
  }

  return { searchModels, huggingFaceSearchResults }
}
 
export default function Settings() {
  const [selectedModels, setSelectedModels] = React.useState<string[]>([]) // string of models
  const [apiKey, setAPIKey] = React.useState<string>("") // string of api key
  const { storedModels, setStoredModels, saveModelSelection } =
    useStoredModels()
  const { searchModels: searchHuggingFaceModels, huggingFaceSearchResults } =
    useHuggingFaceModelSearch()
  const [modelProvider, setModelProvider] = React.useState<string>("openai")
  const [allAvailableProviders, setAllAvailableProviders] = React.useState<any>()
  const [availableModelMap, setAvailableModelMap] = React.useState<any>({})

  const { availableModels, setAvailableModels } = useContext(ModelContext)
  const { isLg } = useBreakpoint("lg")
  const { modelsInformation, setModelsInformation } = useContext(APIContext)
  const [downloadedModels, setDownloadedModels] = useState([])
  const [dataLoading, setDataLoading] = useState<boolean>(true)
  const [revealAPIKey, setRevealAPIKey] = useState<boolean>(false)
  const { toast } = useToast()


  useEffect(() => {
    // just to see if this works
    setDataLoading(true)
    // let model_keys = {}
    const preloadCacheData = async () => {
        const model_res = await fetch(ENDPOINT_URL.concat("/api/get-models-in-cache"))
        const cached_data = await model_res.json()
        let models = cached_data.models
        let cached_models: string[] = []
        console.log(models)
        models.forEach((model: string) => {
          cached_models.push(model)
        });
        // set if models downloaded
        setDownloadedModels(cached_models)
        console.log("settings render done")
        console.log("api key available", modelsInformation)
    }
    preloadCacheData()

    let modelMap = {}
    let modelProviders = []

    const preloadAllModelsData = async (modelMap, modelProviders) => {
      const res = await fetch(ENDPOINT_URL.concat("/api/all_models"))
      const json_params = await res.json()
      console.log("in settings all models", json_params)
  
      for (const [key, value] of Object.entries(json_params)) {
        if (!(modelProviders.includes(value.provider))) {
          modelProviders.push(value.provider)
        }
        if (!(value.provider in modelMap)) {
          modelMap[value.provider] = []
        } 
        modelMap[value.provider].push(value.name)
      }

      console.log(modelMap)
      console.log(modelProviders)
    }
    preloadAllModelsData(modelMap, modelProviders)

    const preloadProvidersData = async (modelMap, modelProviders) => {
      const res = await fetch(ENDPOINT_URL.concat("/api/providers"))
      const json_params = await res.json()
      console.log("in settings for providers", json_params)

      for (const [key, value] of Object.entries(json_params)) {
        if (!(modelProviders.includes(key)) && key !== "default") {
          modelProviders.push(key)
        }
        if (key == "textgeneration" || key == "huggingface") {
          modelMap[key] = huggingFaceSearchResults
        }
      }

      console.log(modelMap)
      console.log(modelProviders)

      setAvailableModelMap(modelMap)
      setAllAvailableProviders(modelProviders)
      setDataLoading(false)
    }

    preloadProvidersData(modelMap, modelProviders)

  }, [])

  useEffect(() => {
    setAPIKey(modelsInformation[`api_${modelProvider}`])
  }, [modelProvider])

  // on X or unchecked, remove model from local storage
  // DO WE NEED TO REMOVE IT IN THE AVAILABLE MODELS LIST TOO?
  const removeModel = (model: string) => {
    console.log(model, storedModels)
    let model_key = `model_${model}`
    let model_value = JSON.parse(localStorage.getItem(model_key) || "{}")
    let modelProvider = model_value.model_provider
    // can probably abstract this into a utils function
    if (modelProvider === "textgeneration") {
      modelProvider = "textgeneration"
    } else if (modelProvider === "huggingface") {
      modelProvider = "huggingface"
    } else if (modelProvider === "cohere") {
      modelProvider = "cohere"
    } else if (modelProvider === "OpenAI") {
      modelProvider = "openai"
    }
    // we now have key to remove from available models
    const copyAvailableModels = { ...availableModels }
    delete copyAvailableModels[modelProvider + ":" + model]
    setAvailableModels(copyAvailableModels)
    setStoredModels(storedModels.filter((m) => m !== model)) // remove from stored models (your selected models dropdown)
    localStorage.removeItem(model_key) // removed prefixed model_ from localstorage
  }

  // TODO: deprecated function
  const handleModelSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    console.log(selectedModels)
    saveModelSelection(modelProvider, selectedModels)
    setSelectedModels([]) // clear selected models
  }
  
  const handleAPIKeySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await fetch(`${ENDPOINT_URL}/api/store-api-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        },
      body: JSON.stringify({
        api_key: apiKey,
        model_provider: modelProvider,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          console.log(data)
        })
      // update api key saved state
      let model_keys = {...modelsInformation}
      model_keys[modelProvider] = true
      model_keys[`api_${modelProvider}`] = apiKey
      setModelsInformation(model_keys)
      toast({
        title: "API Key Saved",
        description: `${modelProvider} API key is saved and ready for generations!`,
      })
  }

  const handleModelSelect = (model: string, checked: boolean) => {
    console.log(model, checked)
    // if checked add to selectedModels
    if (checked) {
      console.log("checked")
      // we can just do the download queue here?
      saveModelSelection(modelProvider, [model]) // add on checked
      setSelectedModels([...selectedModels, model])
      console.log("selected models", selectedModels)
    } else {
      // if unchecked remove from selectedModels
      console.log("unchecked")
      removeModel(model) // remove on unchecked
      setSelectedModels(selectedModels.filter((m) => m !== model))
    }
  }


  return (
    <div className="flex flex-col h-full">
      <NavBar tab="settings" />
      <div className="flex flex-col font-display flex-grow">
        <div className="lg:flex-grow grid gap-6 grid-cols-6 mx-1 lg:mx-5 flex flex-row">
          <div className="flex col-span-6 lg:flex-col lg:col-span-1 mt-2">
            <h1 className="scroll-m-20 text-3xl mb-5 font-extrabold tracking-tight hidden lg:inline-block">
              Providers
            </h1>
            {!dataLoading && allAvailableProviders && allAvailableProviders.map((tag: any) => (
              <React.Fragment key={tag}>
                <Button
                  key={tag}
                  variant={modelProvider == tag ? "subtle" : "ghost"}
                  size={isLg ? "default" : "sm"}
                  className="text-center lg:text-base lg:text-left lg:w-full lg:text-left"
                  onClick={(e) => setModelProvider(tag)}
                >
                  {tag}
                </Button>
              </React.Fragment>
            ))}
          </div>
          {/* RENDER MODEL BASED PAGE HERE */}
          <div className="col-span-6 lg:col-span-3 flex flex-row mx-2 lg:mx-0">
            <div className="mt-2 mb-6">
              <h1 className="scroll-m-20 text-3xl font-extrabold tracking-tight">
                {modelProvider} Setup
              </h1>
              {/* treat model selection like a form */}
              <div className="mt-5">
                {modelProvider != "textgeneration" ? (
                  <>
                  {!dataLoading && Object.keys(modelsInformation).length != 0 ? 
                    <>
                      <h3 className="scroll-m-20 text-xl font-extrabold tracking-tight mt-5">
                        API Key
                      </h3>
                      {modelsInformation && modelsInformation[modelProvider] && modelsInformation[`api_${modelProvider}`] ?  
                      null
                      :
                      <p className="text-red-500"><b>No API key is saved for {modelProvider}</b></p>
                      }
                      <p>
                        Your API key allows us make generation requests for you in
                        the playground
                      </p>
                      {/* API KEY SAVE */}
                      <form onSubmit={handleAPIKeySubmit}>
                        <div className="flex w-full max-w-lg items-center space-x-2 mt-2">
                          {modelProvider && 
                            <Input
                              type={revealAPIKey ? "text" : "password"}
                              placeholder={`Enter your ${modelProvider} API Key`}
                              value={apiKey}
                              onChange={(e) => setAPIKey(e.target.value)}
                              className="flex text-left placeholder:text-left h-8 w-full rounded-md border border-slate-300 bg-transparent py-2 px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-50 dark:focus:ring-slate-400 dark:focus:ring-offset-slate-900"
                            />
                          }
                            {revealAPIKey ?
                            <div key={modelProvider} onClick={() => setRevealAPIKey(e => !e)} className="cursor-pointer"><EyeIcon className="h-5 w-5 align-middle" /></div>
                            :
                            <div key={modelProvider} onClick={() => setRevealAPIKey(e => !e)} className="cursor-pointer"><EyeOffIcon className="h-5 w-5 align-middle" /></div>
                            }
                            {/* <EyeIcon className="h-5 w-5" /> */}
                          <Button type="submit">Save</Button>
                        </div>
                      </form>
                    </>                  
                  :
                    <Loader2 className="h-6 w-6 animate-spin" />
                  }
                  </>
                ) : (
                  <></>
                )}
                {modelProvider === "textgeneration" && (
                  <p>
                    Once a model is selected, it will download in the
                    background. When ready for inference it will show in the
                    playground dropdown.{" "}
                    <b>
                      {" "}
                      Local inference only supports text2text and text
                      generation models{" "}
                    </b>
                  </p>
                )}
                {modelProvider === "textgeneration" && (
                  <>
                  <h3 className="scroll-m-20 text-xl font-extrabold tracking-tight mt-5">
                    Downloaded Models
                  </h3>
                  {dataLoading ? 
                    <Loader2 className="h-6 w-6 animate-spin" />
                  :
                  <>
                    <p>
                      These models already exist in your HuggingFace cache and are ready for inference immediately.
                    </p>
                    <div className="min-h-[320px] w-full border rounded-md mt-2">
                    <ScrollArea className="h-72 w-full">
                      <div className="p-2">
                        {downloadedModels.map((model: any) => (
                          <div
                            key={model}
                            className="rounded-md border border-slate-200 px-4 py-3 my-2 font-mono text-sm dark:border-slate-700"
                          >
                            {model}
                            <Checkbox
                              key={model}
                              className="float-right"
                              onCheckedChange={(event) =>
                                handleModelSelect(model, event)
                              }
                              checked={storedModels.includes(model) && modelProvider === getModelProviderForStoredModel(model)}
                            />
                          </div>
                        ))}
                      </div>
                      </ScrollArea>
                    </div>
                  </>
                  }
                  </>
                )}
                {/* MODEL SELECTION */}
                <h3 className="scroll-m-20 text-xl font-extrabold tracking-tight mt-5">
                  Model Selection
                </h3>
                {modelProvider === "huggingface" ||
                modelProvider === "textgeneration" ? (
                  <p>
                    Search for a model or part of a model to get matches from
                    HuggingFace Hub
                  </p>
                ) : (
                  <p>
                    Please select from the following models to show in the
                    dropdown in playground
                  </p>
                )}
                {(modelProvider === "textgeneration" ||
                  modelProvider === "huggingface") && (
                  <>
                    <form onSubmit={searchHuggingFaceModels}>
                      <div className="flex w-full max-w-sm items-center space-x-2 mt-2">
                        <Input
                          type="text"
                          id="model-query"
                          placeholder="Search Query"
                          className="flex text-left placeholder:text-left h-10 w-full rounded-md border border-slate-300 bg-transparent py-2 px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-50 dark:focus:ring-slate-400 dark:focus:ring-offset-slate-900"
                        />
                        <Button type="submit">Search</Button>
                      </div>
                    </form>
                    <form onSubmit={handleModelSubmit}>
                      <div className="min-h-[320px] w-full border rounded-md mt-2">
                        <div className="p-2">  
                            {!dataLoading && huggingFaceSearchResults && huggingFaceSearchResults.map((model: any) => (
                              <div
                                key={model}
                                className="rounded-md border border-slate-200 px-4 py-3 my-2 font-mono text-sm dark:border-slate-700"
                              >
                                {model}
                                <Checkbox
                                  key={model}
                                  className="float-right"
                                  onCheckedChange={(event) =>
                                    handleModelSelect(model, event)
                                  }
                                  checked={storedModels.includes(model) && modelProvider === getModelProviderForStoredModel(model)}
                                />
                              </div>
                            ))}
                        </div>
                      </div>
                    </form>
                  </>
                )}
                {/* MODEL SELECTION AND SUBMISSION */}
                {(modelProvider === "textgeneration" || modelProvider === "huggingface") ? 
                  <></>
                : (
                <form onSubmit={handleModelSubmit}>
                  <div className="min-h-[320px] w-full border rounded-md mt-2">
                    <div className="p-2">
                      {!dataLoading && availableModelMap && availableModelMap[modelProvider].map((model: any) => (
                        <div
                          key={model}
                          className="rounded-md border border-slate-200 px-4 py-3 my-2 font-mono text-sm dark:border-slate-700"
                        >
                          {model}
                          <Checkbox
                            key={model}
                            className="float-right"
                            onCheckedChange={(event) =>
                              handleModelSelect(model, event)
                            }
                            checked={storedModels.includes(model) && modelProvider === getModelProviderForStoredModel(model)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* <Button className="float-right mt-2" type="submit" value="submit">Save Model</Button> */}
                </form>
                )}
              </div>
            </div>
          </div>
          {/* SELECTED MODELS */}
          <div className="col-span-6 lg:col-span-2 flex flex-row mx-2 lg:mx-0 ">
            <div className="lg:mb-6 lg:mt-2">
              <h1 className="scroll-m-20 text-3xl font-extrabold tracking-tight">
                Your Selected Models
              </h1>
              {/* treat model selection like a form */}
              <div className="mt-1">
                <p>These models will be available in the menu dropdown</p>
              </div>
              {storedModels.map((model: any) => (
                <div
                  key={`selected_${model}`}
                  className="rounded-md border border-slate-200 px-4 py-3 my-2 font-mono text-sm dark:border-slate-700"
                > 
                  {model}
                  <br/>
                  <span style={{"fontSize": "12px"}}>Provider: <i>{getModelProviderForStoredModel(model)}</i></span>
                  <button
                    key={`selected_${model}`}
                    className="float-right center"
                    onClick={() => removeModel(model)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <br/>
                  <span style={{"fontSize": "12px"}}>Status: <i>{getIfModelDownloading(model) ? "Ready for Inference" : "Downloading"}</i></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
