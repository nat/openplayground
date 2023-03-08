import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react"
import {
  Editor,
  EditorState,
  CompositeDecorator,
  SelectionState,
  Modifier,
  ContentState,
  RichUtils,
  getDefaultKeyBinding,
  convertToRaw,
  convertFromRaw,
} from "draft-js"
import { Button } from "../components/ui/button"
import NavBar from "../components/navbar"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import { X, DeleteIcon, HistoryIcon, InfoIcon, Loader2, Settings2, Trash2 } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog"
import { useMetaKeyPress } from "../lib/metakeypress"
import { useKeyPress } from "../lib/keypress"
import "draft-js/dist/Draft.css"
import ParamaterSlider from "../components/ParameterSlider"
import { Sheet, SheetContent, SheetTrigger } from "../components/ui/right-sheet"
import { APIContext, ModelContext } from "../app"
import MultiSelect from "../components/MultiSelect"
import { Checkbox } from "../components/ui/checkbox"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { useBreakpoint } from "../hooks/useBreakpoint"
import { useCtrlMetaKeyPress } from "../lib/ctrlmetakeypress"
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import chroma from "chroma-js"
import { Popover } from 'react-tiny-popover'
import { json } from "react-router-dom"

// CONSTANTS
const ENDPOINT_URL = process.env.NODE_ENV === "production" || !process.env.ENDPOINT_URL ? "" : process.env.ENDPOINT_URL
const modelProviders = ["openai", "cohere", "huggingface", "textgeneration"]
const providerToPrettyName = {
  "openai": "OpenAI",
  "huggingface": "HF Remote",
  "cohere": "co:here",
  "textgeneration": "HF Local",
}

const styleMap = {
  HIGHLIGHT: {
    backgroundColor: "#faed27",
  },
  NORMAL: {
    backgroundColor: "transparent",
  },
  BOLD: {
    fontWeight: "bold",
  },
}

const styles = {
  openai: {
    backgroundColor: "#b9eebc",
    padding: "2px 0",
  },
  textgeneration: {
    backgroundColor: "#f6b2b3",
    padding: "2px 0",
  },
  cohere: {
    backgroundColor: "#a198e6",
    padding: "2px 0",
  },
  huggingface: {
    backgroundColor: "#D7BCE8",
    padding: "2px 0",
  },
  default: {},
}

// model specific text highlighting
function getDecoratedStyle(model_name: any) {
  const prefix = model_name.split(":")[0]
  switch (prefix) {
    case "openai":
      return styles.openai
    case "textgeneration":
      return styles.textgeneration
    case "cohere":
      return styles.cohere
    case "huggingface":
      return styles.huggingface
    default:
      return styles.default
  }
}

export default function Playground() {
  // PROBABLY USEUSE EFFECT TO CREATE A "HISTORY"
  // NEED TO ADD STOP SEQUENCES
  const [model, setModel] = React.useState<string>("")
  const { availableModels, setAvailableModels } = useContext(ModelContext)
  // MODEL PARAMETERS
  const [openHistorySheet, setOpenHistorySheet] = React.useState<boolean>(false)
  const [openParameterSheet, setSaveOpenParameterSheet] =
    React.useState<boolean>(false)
  const [temperature, setTemperature] = React.useState<number>(0.5)
  const [maximumLength, setMaximumLength] = React.useState<number>(200)
  const [topP, setTopP] = React.useState<number>(0.75) // hugging face wants defualt of 1.0 and cohere is 0.75
  const [topK, setTopK] = React.useState<number>(50)
  const [repetitionPenalty, setRepetitionPenalty] = React.useState<number>(1.0)
  const [numBeams, setNumBeams] = React.useState<number>(1)
  const [numReturnSequences, setNumReturnSequences] = React.useState<number>(1)
  const [frequencyPenalty, setFrequencyPenalty] = React.useState<number>(0.0)
  const [presencePenalty, setPresencePenalty] = React.useState<number>(0.0)
  const [stopSequences, setStopSequences] = React.useState<string[]>([])
  const [showProbabilities, setShowProbabilities] =
    React.useState<boolean>(false)
  const showProbabilitiesRef = useRef(showProbabilities)
  // TEXT AREA CONTROL
  const [prompt, setPrompt] = React.useState<string>("")
  const [output, setOutput] = React.useState<string[]>([]) // use this potentially for model output and green text?
  const [prePrompt, setPrePrompt] = React.useState<string>("")
  const [preEditorState, setPreEditorState] = React.useState<string>("") // JSON formatted string!
  const scrollRef = useRef(null) // create a ref to the scroll parent element
  // LOADING STATE
  const [generating, setGenerating] = React.useState<boolean>(false)
  const [modelLoading, setModelLoading] = React.useState<boolean>(false)
  // HISTORY CONTROL
  const [sessionHistory, setSessionHistory] = React.useState<string>("current")
  const [history, setHistory] = React.useState<string[]>([])
  const [showHistory, setShowHistory] = React.useState<boolean>(false)
  const [historyRawEditorState, setHistoryRawEditorState] = React.useState<string>("")
  const [deleteHistoryDialog, setDeleteHistoryDialog] = React.useState<boolean>(false)
  // PRESET CONTROL - TODO DEPRECATE THIS
  const [preset, setPreset] = React.useState<string | undefined>("")
  const [saveOpen, setSaveOpen] = React.useState<boolean>(false)
  const [presetName, setPresetName] = React.useState<string>("")
  const [presetList, setPresetList] = React.useState<string[]>([])
  // ABORT CONTROLLER FOR FETCH
  const abortController = useRef(null)
  // DIALOG CONTROL
  const { apiKeyAvailable, setApiKeyAvailable } = useContext(APIContext)
  // ERROR DIALOG STATES
  const [openDialog, setOpenDialog] = React.useState<boolean>(false)
  const [dialogTitle, setDialogTitle] = React.useState<string>("")
  const [dialogMessage, setDialogMessage] = React.useState<string>("")
  // LOADING CONTROL
  const [preRenderLoading, setPreRenderLoading] = React.useState<boolean>(true)
  
  const { isLg } = useBreakpoint("lg")

  // TEXT EDITOR FUNCTIONS
  // TEXT EDITOR DECORATOR HELPER
  const Decorated = (props: any) => {
    const children = props.children
    const contentState = props.contentState
    const entity = props.contentState.getEntity(props.entityKey)
    const entityData = entity.getData()
    const style = getDecoratedStyle(entityData.model)
    const probabilitiesMap = JSON.parse(entityData.prob) // comes in as json string
    const tokensMap = probabilitiesMap['tokens']
    const [popoverOpen, setPopoverOpen] = React.useState<boolean>(false)
    if (entityData.output === props.decoratedText) {
      let content = (
        <span style={style} key={children[0].key} data-offset-key={children[0].key}>
          {children}
        </span>
      )
  
      if ((entityData.model.startsWith("openai:") || entityData.model.startsWith("cohere:") || entityData.model.startsWith("textgeneration:")) && tokensMap[props.decoratedText] != undefined) {
        console.log(tokensMap[props.decoratedText])
        let percentage = 0
        if (probabilitiesMap['total']['simple_prob_sum'] == null) {
          percentage = tokensMap[props.decoratedText][1]/100
        } else {
          percentage = Math.min(tokensMap[props.decoratedText][1] / probabilitiesMap['total']['simple_prob_sum'], 1.0)
        }
        let f = chroma.scale(["#ff8886", "ffff00", "#96f29b"]) // red - yellow - green spectrum
        let highlight_color = f(percentage)
        console.log(percentage)

        let custom_style = showProbabilitiesRef.current ? {
          backgroundColor: highlight_color,
          padding: "2px 0",
        } : getDecoratedStyle(entityData.model)

        let popoverContent = 
        (
          <div className="shadow-xl shadow-inner rounded-sm bg-white mb-2" data-container="body">
            <ul key={children[0].key} className="grid pt-4">
              {
                Object.entries(tokensMap).map((item, index) => {
                  return (
                    <li key={item + "-" + index + "-" + children[0].key} className={item[0] === entityData.output ? "bg-highlight-tokens w-full font-base text-white pl-4" : "pl-4 text-bg-slate-800"}>
                      {item[0]} = {tokensMap[item[0]][1]}%
                    </li>
                  )
                })
              }
            </ul>
            <div className="m-4 pb-4">
              <div className="text-base">Total: {probabilitiesMap['total']['log_prob_sum']} logprob on 1 tokens</div>
              <div className="text-xs">({probabilitiesMap['total']['simple_prob_sum']}% probability covered in top {Object.keys(probabilitiesMap['tokens']).length} logits)</div>
            </div>
          </div>
        )
        content = (
          <Popover 
            isOpen={popoverOpen} 
            onClickOutside={() => setPopoverOpen(false)}
            positions={['bottom', 'top', 'left', 'right']}
            content={popoverContent}
            containerStyle={{zIndex: "1000"}}
          >
            <span style={custom_style} className={popoverOpen ? "font-bold" : ""} key={children[0].key} data-offset-key={children[0].key} onClick={() => {showProbabilitiesRef.current ? setPopoverOpen(!popoverOpen) : null}}>
              {children}
            </span>
          </Popover>
        )
      }

      return content
    } else {
      return <span data-offset-key={children[0].key}>{children}</span>
    }
  }

  // TEXT EDITOR ENTITY BASED STRATEGY
  function findEntityRangesByType(entityType: any) {
    return (contentBlock: any, callback: any, contentState: any) => {
      contentBlock.findEntityRanges((character: any) => {
        const entityKey = character.getEntity()
        if (entityKey === null) {
          return false
        }
        return contentState.getEntity(entityKey).getType() === entityType
      }, callback)
    }
  }

  const getEditorState = useCallback((): EditorState => {
    return editorStateRef.current
  }, [])

  const createDecorator = () => {
    return new CompositeDecorator([
      {
        strategy: findEntityRangesByType("HIGHLIGHTED_WORD"),
        component: Decorated,
        props: {
          getEditorState,
        },
      },
    ])
  }

  // EDITOR STATE
  const createEditor = () => {
    // fwiw, i do not like this, very hacky fix to not being able to set this in state - but it works
    let text = ""
    let editorStateRaw = null
    let settings = JSON.parse(localStorage.getItem("openplayground_settings") || "{}")
    if (Object.keys(settings).length !== 0) {
      editorStateRaw = settings.editor_state
      editorStateRaw = convertFromRaw(editorStateRaw)
      text += settings.prompt
    }
    // failsafe, if for some reason the editor state does not load, we can just load the text itself no formatting
    let contentStateText = ContentState.createFromText(text)
    return  editorStateRaw || contentStateText
  }

  const [editorState, setEditorState] = React.useState(
    EditorState.moveFocusToEnd(EditorState.createWithContent(
      createEditor(),
      createDecorator()
    ))
  )

  const editorStateRef = useRef<EditorState>(editorState)

  // PRESET LOADING and MODEL LOADING ON PAGE LOAD
  useEffect(() => {
    setPreRenderLoading(true)
    // load generations from local storage
    let generations_keys = Object.keys(localStorage)
      .filter((key_name) => {
        if (key_name.startsWith("generation_")) {
          return true
        }
        return false
      })
      .map(function (item, i) {
        return item
      })
    setHistory([...generations_keys])
    // load setting from local storage
    let settings = JSON.parse(localStorage.getItem("openplayground_settings") || "{}")
    if (Object.keys(settings).length !== 0) {
      console.log("Loading settings from local storage....")
      console.log(settings)
      setModel(settings.model_name)
      setTemperature(settings.temperature)
      setMaximumLength(settings.maximum_length)
      setTopP(settings.top_p)
      setTopK(settings.top_k)
      setRepetitionPenalty(settings.repetition_penalty)
      setNumBeams(settings.num_beams)
      setNumReturnSequences(settings.num_return_sequences)
      setPrompt(settings.prompt)
      setStopSequences(settings.stop_sequences)
      setPrePrompt("") // don't give option for undo last it can result is some tricky conditions
      setShowHistory(settings.history_open)
      setSessionHistory(settings.session_history)
    }
    // Get models to load in to dropdown
    let model_keys = Object.keys(localStorage)
      .filter((key_name) => {
        if (key_name.startsWith("model_")) {
          return true
        }
        return false
      })
      .map(function (item, i) {
        return item.replace("model_", "")
      })

    var model_dict = {}
    model_keys.map((modelName) => {
      let model_value = JSON.parse(
        localStorage.getItem("model_" + modelName) || "{}"
      )
      let modelProvider = model_value.model_provider
      if (modelProvider === "HuggingFace Local") {
        modelProvider = "textgeneration"
      } else if (modelProvider === "HuggingFace Hosted") {
        modelProvider = "huggingface"
      } else if (modelProvider === "co:here") {
        modelProvider = "cohere"
      } else if (modelProvider === "OpenAI") {
        modelProvider = "openai"
      }
      // check to make sure its downloaded and not already in available models state
      let model_key = `${modelProvider}:${modelName}`
      if (
        availableModels[model_key] === undefined &&
        model_value.available === true
      ) {
        // add to dict on two conditions
        // not already there (set from downloaded state from before and prevent re-adding)
        // and is available for inference
        model_dict[model_key] = modelName
      }
    })
    // dictionary in form of, example: textgeneration:t5-base --> t5-base
    console.log("model_dict on load", model_dict)
    setAvailableModels((availableModels: any) => ({
      ...availableModels,
      ...model_dict,
    }))

    // Perform localStorage action, some sort of validation to only get the keys that are presets
    // this is for presets
    if (presetList.length == 0) {
      let keys = Object.keys(localStorage).filter((key_name) => {
        if (key_name.startsWith("preset_")) {
          return true
        }
        return false
      })
      keys.forEach(function (item, i) {
        keys[i] = item.replace("preset_", "")
      })
      console.log("KEYS", keys)
      setPresetList([...presetList, ...keys])
    }
    setPreRenderLoading(false)
  }, [])

  // HANDLE STREAMING CHARACTERS
  const handleStream = (e: MessageEvent) => {
    let resp = JSON.parse(e.data)
    console.log("STREAMING" + resp["message"])
    if (resp["message"] === "You have successfully connected.") {
      return
    }
    let prob = "-1"
    if (resp.hasOwnProperty("prob")) {
      prob = resp["prob"]
    }
    setOutput([resp["message"], prob]) // so useeffect can be called and update editor state
    // setPrompt(prompt => prompt + resp["message"])
  }

  // EDITOR UPDATER
  useEffect(() => {
    // add to words array
    console.log("STREAMED TOKEN:", output)
    const currentContent = editorState.getCurrentContent()
    // create new selection state where focus is at the end
    const blockMap = currentContent.getBlockMap()
    const key = blockMap.last().getKey()
    const length = blockMap.last().getLength()
    const selection = new SelectionState({
      anchorKey: key,
      anchorOffset: length,
      focusKey: key,
      focusOffset: length,
    })
    // Returns ContentState record updated to include the newly created DraftEntity record in it's EntityMap.
    let newContentState = currentContent.createEntity(
      "HIGHLIGHTED_WORD",
      "MUTABLE",
      { model: model, output: output[0], prob: output[1] }
    )
    // Call getLastCreatedEntityKey to get the key of the newly created DraftEntity record.
    const entityKey = currentContent.getLastCreatedEntityKey()
    //insert text at the selection created above
    const textWithInsert = Modifier.insertText(
      currentContent,
      selection,
      output[0],
      null,
      entityKey
    )
    const editorWithInsert = EditorState.push(
      editorState,
      textWithInsert,
      "insert-characters"
    )
    //also focuses cursor at the end of the editor
    const newEditorState = EditorState.moveSelectionToEnd(editorWithInsert)
    const finalEditorState = EditorState.forceSelection(
      newEditorState,
      newEditorState.getSelection()
    )
    setEditorState(finalEditorState)
    editorStateRef.current = finalEditorState
    // this is hacky to scroll to bottom
    if (scrollRef.current) {
      const scrollEl = scrollRef.current
      scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight
    }
  }, [output])

  // Open up a stream and then hit stream inference endpoint
  const handleStreamingSubmit = async (
    regenerate = false,
    passedInPrompt = ""
  ) => {
    // we can open the stream here as well and then terminate it
    // set up model
    abortController.current = new AbortController()
    if (model.startsWith("textgeneration:")) {
      setModelLoading(true)
      const model_set = await fetch(ENDPOINT_URL.concat("/api/setup-model"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_name: model,
        })
      })
      if (!model_set.ok) {
        console.log(`Error: model not setup!`)
        // Stop loading
        setModelLoading(false)
        return
      } else {
        console.log("Model setup!")
      }
      setModelLoading(false)
    }
    setGenerating(true)
    // just for undo last, we want to preserve the formatting as well as the textual content of editor
    if (!regenerate) setPreEditorState(JSON.stringify(convertToRaw(editorState.getCurrentContent())))
    if (sessionHistory != "current") removeStaleSessions() // remove stale sessions
    const sse = new EventSource(ENDPOINT_URL.concat("/api/listen"))
    sse.onmessage = (e) => {
      handleStream(e)
    } // update the prompt state
    // set proper endpoint for streaming
    let fetchEndpoint = "/api/playground"
    console.log("calling fetch")
    console.log(passedInPrompt)
    // begin model loading and inference
    const res = await fetch(ENDPOINT_URL.concat(fetchEndpoint), {
      signal: abortController.current.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_name: model,
        temperature: temperature,
        maximum_length: maximumLength,
        top_p: topP,
        top_k: topK,
        presence_penalty: presencePenalty,
        frequency_penalty: frequencyPenalty,
        repetition_penalty: repetitionPenalty,
        numBeams: numBeams,
        numReturnSequences: numReturnSequences,
        prompt: regenerate ? passedInPrompt : prompt,
        stop: stopSequences.length > 0 ? stopSequences : null,
      })
    }).catch((e) => {
      if (e.name === "AbortError") {
        console.log("Aborted connection, closing stream")
      }
    })
    // close everything and handle for response error
    sse.close()
    if (res) {
      const data = await res.json()
      if (!res.ok) {
        // Error! Let's let user know
        console.log(`Error: ${data}`)
        setDialogMessage(data["status"])
        setDialogTitle("Something went wrong!")
        setOpenDialog(true)
      } else {
        // Success! We can save this into our generation history
        console.log("Returned: " + data)
        saveGeneration()
        if (regenerate) {
          // not sure if this is fine but we will see
          // setPreEditorState(JSON.stringify(convertToRaw(editorState.getCurrentContent())))
          setPrePrompt(passedInPrompt)
        } else {
          setPrePrompt(prompt)
        }
      }
    }
    setGenerating(false)
  }

  // ensure ref is up to date
  useEffect(() => {
    showProbabilitiesRef.current = showProbabilities
  })

  // rerender editor when probability checkbox is updated
  useEffect(() => {
    setEditorState(
      EditorState.forceSelection(editorState, editorState.getSelection())
    )
  }, [showProbabilities])

  // Dispatch the fetch request to appropriate endpoint and connection type
  const handleSubmit = async (regenerate = false, passedInPrompt = "") => {
    // TODO: change this to be cleaner
    if (model?.startsWith("cohere:") || model?.startsWith("openai:") || model?.startsWith("huggingface:")) {
      // check if api key is stored, if not throw error
      if (model?.startsWith("cohere:") && (apiKeyAvailable["co:here"] === false)) {
        setDialogTitle("API Key Required!")
        setDialogMessage("Please enter your co:here API key in the settings tab.")
        setOpenDialog(true)
        return
      } else if (model?.startsWith("openai:") && (apiKeyAvailable["OpenAI"] === false)) {
        setDialogTitle("API Key Required!")
        setDialogMessage("Please enter your OpenAI API key in the settings tab.")
        setOpenDialog(true)
        return
      } else if (model?.startsWith("huggingface:") && apiKeyAvailable["HuggingFace Hosted"] === false) {
        setDialogTitle("API Key Required!")
        setDialogMessage("Please enter your HuggingFace API key in the settings tab.")
        setOpenDialog(true)
        return
      }
    }
    handleStreamingSubmit(regenerate, passedInPrompt)
  }

  // constantly save state to presist across refreshes
  // listen for any state chage, we save on that change
  useEffect(() => {
    console.log("firing....")
    let editorStateRaw = convertToRaw(editorState.getCurrentContent())
    const settings = JSON.stringify({
      model_name: model,
      temperature: temperature,
      maximum_length: maximumLength,
      top_p: topP,
      top_k: topK,
      repetition_penalty: repetitionPenalty,
      num_beams: numBeams,
      num_return_sequences: numReturnSequences,
      prompt: prompt,
      editor_state: editorStateRaw,
      stop_sequences: stopSequences,
      preprompt: prePrompt,
      history_open: showHistory,
      session_history: sessionHistory,
    })
    localStorage.setItem("openplayground_settings", settings)
  }, [
    model,
    temperature,
    maximumLength,
    topP,
    topK,
    repetitionPenalty,
    numBeams,
    numReturnSequences,
    prompt,
    stopSequences,
    prePrompt,
    sessionHistory
  ])

  const saveGeneration = async () => {
    // save the current generation to the history
    let editorStateRaw = convertToRaw(editorStateRef.current.getCurrentContent())
    const timestamp = Date.now() // for guaranteed unique key
    const key = model + timestamp
    const date = new Date()
    const settings = JSON.stringify({
      timestamp: date.toLocaleTimeString(),
      date: date.toLocaleDateString('en-US'),
      model_name: model,
      temperature: temperature,
      maximum_length: maximumLength,
      top_p: topP,
      top_k: topK,
      repetition_penalty: repetitionPenalty,
      num_beams: numBeams,
      num_return_sequences: numReturnSequences,
      prompt: prompt,
      stop_sequences: stopSequences,
      editor_state: editorStateRaw,
    })
    let formed_key = "generation_" + key
    localStorage.setItem(formed_key, settings) // save to local storage
    setHistory([...history, formed_key]) // update history state
  }

  const saveGenerationCurrent = async (currentSessionKey: string) => {
    // only save if not already saved
    if (localStorage.getItem("session_" + currentSessionKey) === null) {
      console.log("saving current session")
      // save the current generation to the history
      let editorStateRaw = convertToRaw(editorState.getCurrentContent())
      console.log(editorState.getCurrentContent().getPlainText())
      const timestamp = Date.now() // for guaranteed unique key
      const date = new Date()
      const settings = JSON.stringify({
        timestamp: date.toLocaleTimeString(),
        date: date.toLocaleDateString(),
        model_name: model,
        temperature: temperature,
        maximum_length: maximumLength,
        top_p: topP,
        top_k: topK,
        repetition_penalty: repetitionPenalty,
        num_beams: numBeams,
        num_return_sequences: numReturnSequences,
        prompt: prompt,
        stop_sequences: stopSequences,
        editor_state: editorStateRaw,
      })
      let formed_key = "session_" + currentSessionKey
      localStorage.setItem(formed_key, settings) // save to local storage
    }
  }

  const handleGenerationSelect = (key: string) => {
    const settings = JSON.parse(localStorage.getItem(key) || "{}")
    console.log(settings)
    console.log(settings.prompt)
    // load it into current state
    setModel(settings.model_name)
    setTemperature(settings.temperature)
    setMaximumLength(settings.maximum_length)
    setTopP(settings.top_p)
    setTopK(settings.top_k)
    setRepetitionPenalty(settings.repetition_penalty)
    setNumBeams(settings.num_beams)
    setNumReturnSequences(settings.num_return_sequences)
    setPrompt(settings.prompt)
    setStopSequences(settings.stop_sequences)
    setEditorState(
      EditorState.moveFocusToEnd(EditorState.createWithContent(
        convertFromRaw(settings.editor_state),
        createDecorator()
      ))
    )
    setPrePrompt("")
    if (key === "session_current") {
      console.log("removing current session storage")
      localStorage.removeItem("session_current")
    }
  }

  const removeStaleSessions = () => {
    // remove any stale sessions
    localStorage.removeItem("session_current")
    setSessionHistory("current")
  }

  const handleGenerationDelete = (key: string) => {
    setHistory(history.filter((m) => m !== key)) // remove from stored models (your selected models dropdown)
    localStorage.removeItem(key)
  }

  const handleDeleteAllHistory = () => {
    history.forEach((key) => {
      localStorage.removeItem(key)
    })
    setHistory([])
    setShowHistory(false)
  }

  // generation helpers
  const getValueFromGeneration = (key: string, parameter: string) => {
    const settings = JSON.parse(localStorage.getItem(key) || "{}")
    return settings[parameter]
  }

  // handle undo last, update editor state
  const handleUndoLast = () => {
    // state stays same here between prompt and editor
    // need this to be built into the editor state instead of preprompt state
    
    setEditorState(
      EditorState.moveFocusToEnd(EditorState.createWithContent(
        convertFromRaw(JSON.parse(preEditorState)),
        createDecorator()
      ))
    )
    setPrompt(prePrompt)
    setPrePrompt("")
  }

  // HELPER FUNCTIONS
  // const editorRef = React.useRef(null)

  // function focusEditor() {
  //   editorStateRef.current.focus()
  // }

  // abort the fetch if the user clicks the cancel button
  const abortFetch = () => {
    abortController.current &&
    abortController.current.abort("User requested abort")
  }

  // KEYBOARD SHORTCUT HANDLERS

  // Meta Key + Enter - Submit form
  const onEnterKeyPress = (event: any) => {
    handleSubmit()
  }
  useMetaKeyPress(["Enter"], onEnterKeyPress)

  // Esc - Abort request
  const onEscKeyPress = (event: any) => {
    abortFetch()
  }
  useKeyPress(["Escape"], onEscKeyPress)

  const undoLastKeyPress = (event: any) => {
    console.log("fired undo last")
    if (prePrompt === "") {
      return
    } else {
      handleUndoLast()
    }
  }
  useCtrlMetaKeyPress(["u"], undoLastKeyPress)

  const regenerateKeyPress = (event: any) => {
    console.log("fired regenerate")
    event.preventDefault()
    if (prePrompt === "") {
      return
    } else {
      handleUndoLast()
      handleSubmit(true, prePrompt)
    }
  }
  useCtrlMetaKeyPress(["Enter"], regenerateKeyPress)

  const showHistoryPress = (event: any) => {
    console.log("fired show history")
    event.preventDefault()
    if (showHistory) {
      setShowHistory(false)
    } else if (history.length > 0) {
      setShowHistory(e => !e)
    }
  }
  useCtrlMetaKeyPress(["h"], showHistoryPress)

  // EDITOR KEY COMMAND HANDLER
  const handleKeyCommand = (command: any, editorState: any) => {
    if (command === "bold") {
      setEditorState(RichUtils.toggleInlineStyle(editorState, "BOLD"))
      return "handled"
    }
    if (command === "ignore_enter") {
      return "handled"
    }
    return "not-handled"
  }

  // Define a custom keyBindingFn function that maps the Ctrl+B keyboard shortcut to a 'bold' command
  const keyBindingFn = (event: any) => {
    if (event.code === "Enter" && event.metaKey) {
      return "ignore_enter"
    }

    if (event.metaKey && event.keyCode === 66) {
      // Meta Key+B
      return "bold"
    } else if (event.ctrlKey && event.keyCode === 66) {
      return "bold"
    }
    return getDefaultKeyBinding(event)
  }

  const [bookmarksChecked, setBookmarksChecked] = React.useState(true);
  const [urlsChecked, setUrlsChecked] = React.useState(false);
  const [person, setPerson] = React.useState('pedro');

  const textArea = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className="flex flex-col grow basis-auto lg:max-w-[calc(100%-266px)]"
    >
      <div
        id="editor"
        ref={scrollRef}
        className="overflow-y-auto editor-container h-full w-full py-3 px-3 text-base rounded-md border border-slate-300"
      >
        {preRenderLoading ? 
        null
        :
        <Editor
          keyBindingFn={keyBindingFn}
          handleKeyCommand={handleKeyCommand}
          customStyleMap={styleMap}
          editorState={editorState}
          onChange={(editorState: any) => {
            setEditorState(editorState)
            setPrompt(editorState.getCurrentContent().getPlainText("\u0001"))
          }}
        />
        }
      </div>
      {/* <Textarea className='h-full w-full' placeholder="Write tagline for a ice cream shop." value={prompt} onChange={(e) => setPrompt(e.target.value)} required/> */}
      <div className="flex space-x-2 mb-8">
        {modelLoading && (
          <TooltipProvider>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <Button
                  className="inline-flex items-center px-5 py-2.5 mt-4 text-sm font-medium text-center"
                  disabled
                >
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading Model
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" align="center" className="bg-slate-600 text-white">
                We're currently loading your model locally, hang tight!
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {generating && (
          <TooltipProvider>
          <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
          <Button
            type="button"
            variant="subtle"
            className="inline-flex items-center px-5 py-2.5 mt-4 text-sm font-medium text-center"
            onClick={(e) => {
              e.stopPropagation()
              abortFetch()
            }}
          >
            {" "}
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Cancel Generation
          </Button>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" className="bg-slate-600 text-white hidden hidden md:block">
            Cancel Generation &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Esc
            </kbd>
          </TooltipContent>
          </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider>
        {!modelLoading && !generating && (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                className="bg-emerald-500 hover:bg-emerald-700 inline-flex items-center mt-4 text-sm font-medium text-center"
                type="submit"
                value="submit"
              >
                Submit
              </Button>
            </TooltipTrigger>
              <TooltipContent side="top" align="center" className="bg-slate-600 text-white hidden md:block">
                Submit &nbsp;
                <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <span className="text-sm">⌘</span>
                </kbd>
                &nbsp;
                <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Enter
                </kbd>
              </TooltipContent>
            </Tooltip>
        )}
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
          <Button
            type="button"
            variant="subtle"
            className="inline-flex items-center mt-4 text-sm font-medium text-center"
            onClick={handleUndoLast}
            disabled={prePrompt === ""}
          >
            Undo Last
          </Button>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" className="bg-slate-600 text-white hidden md:block">
            Undo Last &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Control
            </kbd>
            &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <span className="text-sm">⌘</span>
            </kbd>
            &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              U
            </kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
          <Button
            type="button"
            variant="subtle"
            className="inline-flex items-center mt-4 mx-[0] text-sm font-medium text-center"
            onClick={(e) => {
              e.stopPropagation()
              handleUndoLast()
              handleSubmit(true, prePrompt)
            }}
            disabled={prePrompt === ""}
          >
            Regenerate Output
          </Button>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" className="bg-slate-600 text-white hidden md:block">
            Regenerate With Same Prompt &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Control
            </kbd>
            &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <span className="text-sm">⌘</span>
            </kbd>
            &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Enter
            </kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
              <Button
              type="button"
              variant="subtle"
              className="inline-flex items-center py-2.5 mt-4 text-sm font-medium text-center hidden lg:inline-flex"
              onClick={(e) => {
                e.stopPropagation()
                setShowHistory(e => !e)
              }}
              disabled={history.length == 0}
            >
              <HistoryIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" className="bg-slate-600 text-white">
            Show History &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Control
            </kbd>
            &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <span className="text-sm">⌘</span>
            </kbd>
            &nbsp;
            <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              H
            </kbd>
          </TooltipContent>
        </Tooltip>
        </TooltipProvider>
      </div>
    </form>
  )

  const modelsEmpty =
    availableModels == null || Object.entries(availableModels).length == 0
  const historySidebar = (
      <div className="flex flex-col h-full">
        <div className="text-lg tracking-tight font-semibold text-slate-900 flex" style = {{justifyContent: 'flex-end'}}>
        <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
              variant="subtle"
              className="inline-flex text-sm font-medium outline-0"
              onClick={(e) => {
                setShowHistory(e => !e)
              }}
              disabled={history.length == 0}
            >
              ...
          </Button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="outline-0 cursor-default min-w-[150px] bg-white rounded-md shadow-[0px_10px_38px_-10px_rgba(22,_23,_24,_0.35),_0px_10px_20px_-15px_rgba(22,_23,_24,_0.2)] will-change-[opacity,transform] data-[side=top]:animate-slideDownAndFade data-[side=right]:animate-slideLeftAndFade data-[side=bottom]:animate-slideUpAndFade data-[side=left]:animate-slideRightAndFade z-10"
          sideOffset={5}
        >
          <DropdownMenu.Item className="outline-0 hover:bg-slate-200 text-sm p-2 text-center">
            Download as JSON
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="h-[1px] bg-slate-200" />
          <DropdownMenu.Item
            className="outline-0 hover:bg-slate-200 text-sm p-2 text-center"
            onClick={() => {
              setDeleteHistoryDialog(true)
            }}>
            Clear History
          </DropdownMenu.Item>
          <DropdownMenu.Arrow className="fill-white" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
         

      <div>
        <X
          size={20}
          className="cursor-pointer inline m-2 align-middle hidden lg:inline align-middle mb-1"
          onClick={(e) => {
            setShowHistory(e => !e)
          }}
        />
      </div>
            
          </div>
        <div>
        </div>
        {/* HISTORY ITEM COMPONENT */}
        <div className="overflow-y-auto max-h-[63.75vh]">
          {/* Sort history by date first and then populate */}
          {history && history.length > 0 && (
            history.reduce((accumulator: any, value: any) => {
              let val = getValueFromGeneration(value, "date")
              if (!accumulator.includes(val)) {
                accumulator.push(val)
              }
              accumulator.sort(function(a, b) {
                return new Date(b) - new Date(a);
              });
              return accumulator
            }, []).map((unique_date: any, main_index) => {
              return (
                <> 
                  <div className="text-xs tracking-tight mb-2 mt-2 font-semibold uppercase text-slate-900"> 
                    {new Date(unique_date).toLocaleDateString(['en-GB','en-us'], {weekday:"long", year:"numeric", month:"short", day:"numeric"})} 
                  </div>
                  {history.filter ((value: any) => {
                    return getValueFromGeneration(value, "date") === unique_date
                  }).sort(function(a, b) {
                    let a_date = getValueFromGeneration(a, "date") + " " +  getValueFromGeneration(a, "timestamp")
                    let b_date = getValueFromGeneration(b, "date") + " " + getValueFromGeneration(b, "timestamp")
                    // Turn your strings into dates, and then subtract them
                    // to get a value that is either negative, positive, or zero.
                    return new Date(b_date) - new Date(a_date);
                  }).map((item: any, index) => {
                    return (
                      <>
                        <div
                          key={item}
                          onClick={() => {saveGenerationCurrent("current"); handleGenerationSelect(item); setSessionHistory(item)}}
                          className={
                            `[&>div:nth-child(2)]:hover:w-[7px]
                            [&>div:nth-child(2)]:hover:h-[7px]
                            [&>div:nth-child(2)]:hover:left-[77px]
                            [&>div:nth-child(2)]:hover:border-slate-800
                            [&>div:nth-child(2)]:hover:border-2
                            rounded-sm rounded-sm relative flex flex-row p-4 font-bold text-sm cursor-pointer click:bg-slate-300 dark:hover:bg-slate-200  ${(sessionHistory === item) ? 'bg-slate-200' : 'hover:bg-slate-100'}`
                          }>
                            <div className = {`bg-slate-300 w-[1px] absolute left-[80px] ${(main_index === 0 && index ===0 ) ? 'h-[75%] top-[25%]' : 'h-[100%] top-[0]'}`}/>
                            <div className = {
                              `ease-in duration-100 border rounded-full bg-white absolute top-[22px] ${sessionHistory === item ? 'border-slate-800 w-[7px] h-[7px] border-2 left-[77px]' : 'border-slate-500 w-[5px] h-[5px] left-[78px] '}
                            `}/>
                            <div className="text-xs pl-4 pr-12">
                              {
                                (main_index === 0 && index === 0) ? (
                                    <span>Now</span>
                                  ) : getValueFromGeneration(item, "timestamp").split(":").slice(0, 2).join(":")
                                }
                            </div>
                            <div className="text-xs overflow-hidden ">
                              <p className="truncate tracking-wide">
                              {
                                (main_index === 0 && index === 0) ? (
                                 
                                    "Current"
                                 
                                  ) : getValueFromGeneration(item, "prompt")
                                }
                              </p>
                              <div className="mt font-medium" style = {{whiteSpace: "nowrap",  overflow: 'hidden'}}>
                                {getValueFromGeneration(item, "model_name")}
                              </div>
                            </div>
                        </div>
                      </>
                    )
                  })
                  }
                </>
              )
            })
          )}
        </div>
      </div>
  )

  const parameterSidebar = (
    // <div className="invisible grid grid-rows-8 basis-1/6 overflow-auto lg:visible">
    <div className="">
      <div className="mb-2">
        <span className="flow-root inline-block align-middle">
          <p className="text-sm font-medium float-left align-text-top">Model</p>
        </span>
        {modelsEmpty && (
          <span className="flow-root inline-block align-middle mb-2">
            <p className="text-sm font-medium float-left align-text-top text-gray-500">
              Add models via the settings page
            </p>
          </span>
        )}
        <Select
          value={model != "" ? model : undefined}
          onValueChange={setModel}
          required={model === ""}
        >
          <SelectTrigger
            className="w-full"
            onKeyDown={(e) => {
              if (e.code === "Enter" && e.metaKey) {
                e.preventDefault()
              }
            }}
          >
            <SelectValue placeholder="Select a Model" />
          </SelectTrigger>
          <SelectContent
            onKeyDown={(e) => {
              if (e.code === "Enter" && e.metaKey) {
                e.preventDefault()
              }
            }}
          >
            {modelProviders.map((provider) => (
              <SelectGroup key={provider}>
                {Object.entries(availableModels).filter(([key]) => key.startsWith(provider)).map(
                  ([model_key, model_name], index) => {
                    if (availableModels[model_key]) {
                      return (
                        <>
                        <SelectLabel hidden={index != 0}>{providerToPrettyName[provider]}</SelectLabel>
                        <SelectItem
                          key={model_key}
                          value={model_key}
                          onKeyDown={(e) => {
                            if (e.code === "Enter" && e.metaKey) {
                              e.preventDefault()
                            }
                          }}
                        >
                          {model_name}
                        </SelectItem>
                        </>
                      )
                    }
                    }
                  )
                }
              </SelectGroup>
            ))}
            {/* <SelectGroup>
              <SelectLabel>Available Models</SelectLabel>
              {Object.entries(availableModels).map(
                ([model_key, model_name]) => (
                  <SelectItem
                    key={model_key}
                    value={model_key}
                    onKeyDown={(e) => {
                      if (e.code === "Enter" && e.metaKey) {
                        e.preventDefault()
                      }
                    }}
                  >
                    {model_name}
                  </SelectItem>
                )
              )}
            </SelectGroup> */}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-y-3">
        {/* MAX LENGTH */}
        <ParamaterSlider
          title="Maximum Length"
          type="number"
          defaultValue={maximumLength}
          min={50}
          max={1024}
          step={1}
          setParentState={setMaximumLength}
          normalizeInputData={(value) => parseInt(value)}
          tooltipContent={<p>
            Maximum number of tokens to generate. <br /> Responses are not
            guaranted to fill up <br /> to the maximum desired length. <br />{" "}
            <b>Defaults to 200.</b>
          </p>} disabled={false} onChangeValue={undefined}        />
        
                {/* TEMPERATURE */}
                {model?.startsWith("cohere:") ? (
          <ParamaterSlider
            title="Temperature"
            defaultValue={temperature}
            min={0}
            max={5}
            step={0.01}
            type="number"
            normalizeInputData={(value) => parseFloat(value)}
            tooltipContent={<p>
              A non-negative float that tunes the degree <br /> of randomness
              in generation. Lower temperatures <br /> mean less random
              generations. <b> Defaults to 0.5, min of 0.0 and max to 5.0</b>
            </p>}
            setParentState={setTemperature} disabled={false} onChangeValue={undefined}          />
        ) : (
          <ParamaterSlider
              title="Temperature"
              defaultValue={temperature}
              min={0}
              max={1}
              step={0.01}
              type="number"
              normalizeInputData={(value) => parseFloat(value)}
              tooltipContent={<p>
                A non-negative float that tunes the degree <br /> of randomness
                in generation. Lower temperatures <br /> mean less random
                generations. <b> Defaults to 0.5</b>
              </p>}
              setParentState={setTemperature} disabled={false} onChangeValue={undefined}          />
        )}
        {/* TOP P */}
        {model?.startsWith("cohere:") ? (
          <ParamaterSlider
            title="Top P"
            type="number"
            defaultValue={topP}
            min={0}
            max={1}
            step={0.01}
            normalizeInputData={(value) => parseFloat(value)}
            setParentState={setTopP}
            tooltipContent={<p>
              If set to float less than 1, only the smallest <br /> set of
              most probable tokens with probabilities <br /> that add up to
              top_p or higher are kept for generation. <br />{" "}
              <b>Defaults to 0.75</b>
            </p>} disabled={false} onChangeValue={undefined}          />
        ) : (
          <ParamaterSlider
              title="Top P"
              type="number"
              defaultValue={topP}
              min={0}
              max={2}
              step={0.01}
              normalizeInputData={(value) => parseFloat(value)}
              setParentState={setTopP}
              tooltipContent={<p>
                If set to float less than 1, only the smallest <br /> set of
                most probable tokens with probabilities <br /> that add up to
                top_p or higher are kept for generation. <br />{" "}
                <b>Defaults to 1.0</b>
              </p>} disabled={false} onChangeValue={undefined}          />
        )}
        {/* TOP K */}
        <ParamaterSlider
          title="Top K"
          type="number"
          defaultValue={topK}
          min={0}
          max={500}
          step={1}
          normalizeInputData={(value) => parseInt(value)}
          setParentState={setTopK}
          tooltipContent={<p>
            Can be used to reduce repetitiveness of generated tokens. The
            higher <br /> the value, the stronger a penalty is applied to
            previously present tokens, <br /> proportional to how many times
            they have already appeared <br /> in the prompt or prior
            generation. <b>Defaults to 0.0, max value of 1.0</b>
          </p>} disabled={false} onChangeValue={undefined}        />
        {/* FREQUENCY PENALTY */}
        {model?.startsWith("cohere:") ? (
          <ParamaterSlider
            title="Frequency Penalty"
            type="number"
            defaultValue={frequencyPenalty}
            min={0}
            max={1}
            step={0.01}
            normalizeInputData={(value) => parseFloat(value)}
            setParentState={setFrequencyPenalty}
            tooltipContent={<p>
              Can be used to reduce repetitiveness of generated tokens. The
              higher <br /> the value, the stronger a penalty is applied to
              previously present tokens, <br /> proportional to how many times
              they have already appeared <br /> in the prompt or prior
              generation. <b>Defaults to 0.0, max value of 1.0</b>
            </p>} disabled={false} onChangeValue={undefined}          />
        ) : null}
        {/* PRESENCE PENALTY */}
        {model?.startsWith("cohere:") ? (
          <ParamaterSlider
            title="Presence Penalty"
            type="number"
            defaultValue={presencePenalty}
            min={0}
            max={1}
            step={0.01}
            normalizeInputData={(value) => parseFloat(value)}
            setParentState={setPresencePenalty}
            tooltipContent={<p>
              Can be used to reduce repetitiveness of generated tokens.
              Similar to <br /> frequency_penalty, except that this penalty is
              applied equally <br /> to all tokens that have already appeared,
              regardless of their <br /> exact frequencies.{" "}
              <b>Defaults to 0.0, max value of 1.0</b>
            </p>} disabled={false} onChangeValue={undefined}          />
        ) : null}
        {/* Repetition penalty */}
        {model?.startsWith("cohere:") == false ? (
          <ParamaterSlider
            title="Repetition Penalty"
            type="number"
            defaultValue={repetitionPenalty}
            min={0}
            max={2}
            step={0.01}
            normalizeInputData={(value) => parseFloat(value)}
            setParentState={setRepetitionPenalty}
            tooltipContent={<p>
              Akin to presence penalty. The repetition penalty is meant <br />{" "}
              to avoid sentences that repeat themselves without <br />{" "}
              anything really interesting.{" "}
              <b>Defaults to 1.0, means no penalty.</b>
            </p>} disabled={false} onChangeValue={undefined}          />
        ) : null}
        {/* Num Beams */}
        {/* {model?.startsWith("cohere:") == false ? (
          <ParamaterSlider
            title="Number of Beams"
            type="number"
            defaultValue={numBeams}
            min={1}
            max={10}
            step={1}
            normalizeInputData={(value) => parseInt(value)}
            setParentState={setNumBeams}
            tooltipContent={
              <p>
                Number of beams for beam search. <br />{" "}
                <b>1 means no beam search.</b>
              </p>
            }
          />
        ) : null} */}
        {!model?.startsWith("huggingface:") && (
          <MultiSelect
            setParentState={setStopSequences}
            defaultOptions={stopSequences}
            tooltipContent={<p>
              Up to four sequences where the API will stop <br /> generating
              further tokens. The returned text <br />
              will not contain the stop sequence.
            </p>} 
          />
        )}
        {(model?.startsWith("openai:") || model?.startsWith("cohere:") || model?.startsWith("textgeneration:")) && (
          <Tooltip delayDuration={300} skipDelayDuration={150}>
            <TooltipTrigger asChild>
              <div className="flex justify-between align-middle inline-block align-middle mb-1">
                <p className="text-sm font-medium float-left align-text-top">
                  Show Probabilities
                </p>
                <Checkbox
                  name="show-probabilities"
                  className="float-right self-center"
                  checked={showProbabilities}
                  onCheckedChange={(val: boolean) => setShowProbabilities(val)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side={isLg ? "left" : "bottom"}>
              <p>
                When enabled hover over generated words <br /> to see how likely
                a token was to be generated.
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )

  const mobileOpenParametersButton = (
    <Sheet open={openParameterSheet} onOpenChange={setSaveOpenParameterSheet}>
      <SheetTrigger asChild>
        <Button variant="subtle" className="lg:hidden">
          <Settings2 className="h-6 w-6"/>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[80vw]">{parameterSidebar}</SheetContent>
    </Sheet>
  )

  const mobileOpenHistoryButton = (
    <Sheet open={openHistorySheet} onOpenChange={setOpenHistorySheet}>
      <SheetTrigger asChild>
        <Button variant="subtle" className="lg:hidden">
          <HistoryIcon className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[80vw]">{historySidebar}</SheetContent>
    </Sheet>
  )

  return (
    <div className="flex flex-col h-full">
      <NavBar tab="playground">
        {/* mobile line break  */}
        <div className="basis-full h-0 lg:hidden bg-green-700"></div>
        <div className="mt-4 lg:mt-0 lg:ml-auto flex basis-full lg:basis-auto flex-wrap lg:flex-nowrap">
          <div className="flex basis-full mb-2 lg:mb-0 space-x-2">             
            {mobileOpenParametersButton}
            {mobileOpenHistoryButton}
          </div>
        </div>
      </NavBar>
      <AlertDialog open={deleteHistoryDialog} onOpenChange={setDeleteHistoryDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete all of your history?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be <b>reversed.</b> Please make sure you have saved any important generations before proceeding.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-red-500 text-white hover:bg-red-600 dark:hover:bg-red-600" asChild>
            <Button variant="destructive" onClick={handleDeleteAllHistory}>
              Delete History
            </Button>
          </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* error dialog */}
      <AlertDialog open={openDialog} onOpenChange={setOpenDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              <p className="text-lg text-slate-700 dark:text-slate-400">{dialogMessage}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex flex-grow flex-col font-display min-h-0 min-w-0 ml-5">
        {/* TEXTAREA COMPONENT */}
        <div className="flex flex-row space-x-4 flex-grow mr-5 min-h-0 min-w-0">
            {showHistory ? 
              <div className="hidden grow-0 shrink-0 basis-auto lg:w-[250px] lg:block max-h-[90vh]">
                {historySidebar}
              </div> 
            :
            null}
          {textArea}
          {/* {historySidebar} */}
          <div className="hidden p-1 grow-0 shrink-0 basis-auto lg:w-[250px] overflow-auto lg:block max-h-[90vh]">
            {preRenderLoading ? 
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              :
              parameterSidebar
            }
          </div>
        {/* SIDE BAR CHANGING VALUES */}
        </div>
      </div>
    </div>
  )
}
