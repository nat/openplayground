import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react"
import {
  Editor,
  EditorState,
  convertToRaw,
  convertFromRaw,
  convertFromRaw,
  CompositeDecorator,
  SelectionState,
  Modifier,
  ContentState,
  RichUtils,
  getDefaultKeyBinding,
} from "draft-js"
import { Button } from "../components/ui/button"
import NavBar from "../components/navbar"
import {
  Loader2,
  BarChart2,
  Copy,
  Settings2,
  XCircle,
  AlertTriangle,
  Trash2,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogAction,
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
import { uuid } from 'uuidv4';
import { CSSTransition, TransitionGroup } from 'react-transition-group';
// CONSTANTS
const ENDPOINT_URL = process.env.NODE_ENV === "production" || !process.env.ENDPOINT_URL ? "" : process.env.ENDPOINT_URL

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
    transition: 'background-color 0.2s ease-in-out',
    backgroundColor: "#b9eebc",
    padding: "2px 0",
  },
  textgeneration: {
    transition: 'background-color 0.2s ease-in-out',
    backgroundColor: "#f6b2b3",
    padding: "2px 0",
  },
  cohere: {
    transition: 'background-color 0.2s ease-in-out',
    backgroundColor: "#a198e6",
    padding: "2px 0",
  },
  huggingface: {
    transition: 'background-color 0.2s ease-in-out',
    backgroundColor: "#D7BCE8",
    padding: "2px 0",
  },
  default: {
    transition: 'background-color 0.2s ease-in-out',
    padding: "2px 0"
  },
}

// model specific text highlighting
function getDecoratedStyle(model_name: string, showHighlights: boolean) {
  console.log("showHighlights", showHighlights)
  if (showHighlights === false) return styles.default

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
const normalize_parameter = (parameter: number) => {
  if (parameter > 1) return parameter
  else return parameter.toFixed(1)
}

const ModelCard = forwardRef((props, ref) => {
  const {model, handleSelectModel, showHighlights, showProbabilities} = props

  console.warn("showProbabilities", showProbabilities)
  const [time, setTime] = useState(0)
  const [_, setIsRunning] = useState(false)
  const intervalRef = useRef(null)
  const [totalCharacters, setTotalCharacters] = useState(0)
  const [errorMessage, setErrorMessage] = useState(null);
  const showProbabilitiesRef = useRef(showProbabilities)
  const showHighlightsRef = useRef(showHighlights)

  const startTimer = () => {
    setIsRunning(true)
    setTime(0)
    intervalRef.current = setInterval(() => {
      setTime((prevTime) => prevTime + 1)
    }, 1000)
  }

  const stopTimer = () => {
    clearInterval(intervalRef.current)
    setIsRunning(false)
  }

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60)
      .toString()
      .padStart(2, "0")
    const seconds = (time % 60).toString().padStart(2, "0")
    return `${minutes}:${seconds}`
  }

  const Decorated = (props: any) => {
    const children = props.children
    const entity = props.contentState.getEntity(props.entityKey)
    const entityData = entity.getData()
    const style = getDecoratedStyle(entityData.model, showHighlightsRef.current)
    if (entityData.output === props.decoratedText) {
      let content = (
        <span style={style} data-offset-key={children[0].key} className="hover:!brightness-90">
          {children}
        </span>
      )
      if (entityData.model.startsWith("openai:")) {
        content = (
          <TooltipProvider>
            <Tooltip delayDuration={300} skipDelayDuration={150}>
              <TooltipTrigger asChild>{content}</TooltipTrigger>
              <TooltipContent hidden={!showProbabilitiesRef.current } side="bottom">
                <p>Probability = {entityData.prob}%</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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

  const [editorState, setEditorState] = React.useState(
    EditorState.createEmpty(createDecorator())
  )
  const editorStateRef = useRef<EditorState>(editorState)
  const [output, setOutput] = React.useState<string[]>([])
  const [modelState, setModelState] = React.useState<string>("IDLE")
  
  useEffect(() => {
    setEditorState(
      EditorState.forceSelection(editorState, editorState.getSelection())
    )
  }, [showProbabilities, showHighlights])

  useEffect(() => {
    showProbabilitiesRef.current = showProbabilities
    showHighlightsRef.current = showHighlights
  })

  useEffect(() => {
    if (output.message === "[INITIALIZING]") {
      setModelState("INITIALIZED")
      setTotalCharacters(0)
      startTimer()
      setErrorMessage(null)
      return
    }
    if (output.message && output.message.indexOf("[ERROR] ") === 0) {
      setModelState("ERROR")
      stopTimer()
      setErrorMessage(output.message.replace("[ERROR] ", ""))
      return
    }
    if (output.message === "[COMPLETED]") {
      setModelState("COMPLETED")
      stopTimer()
      return
    }

    if (modelState === "INITIALIZED") {
      setModelState("RUNNING")
    }
    //check if outpit is an array
    if (!Array.isArray(output)) setTotalCharacters(totalCharacters + output.message.split("").length)

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
      { model: output.model_name, output: output.message, prob: output.prob }
    )
    // Call getLastCreatedEntityKey to get the key of the newly created DraftEntity record.
    const entityKey = currentContent.getLastCreatedEntityKey()
    //insert text at the selection created above
    const textWithInsert = Modifier.insertText(
      currentContent,
      selection,
      output.message,
      null,
      entityKey
    )
    const editorWithInsert = EditorState.push(
      editorState,
      textWithInsert,
      "insert-characters"
    )
    setEditorState(editorWithInsert)
  }, [output])

  const handleNotification = (output: any) => {
    setOutput(output)
  }

  const handleUndo = (output: any) => {
    setEditorState(
      EditorState.createWithContent(
        ContentState.createFromText(""),
        createDecorator()
      )
    )
  }

  useImperativeHandle(ref, () => ({
    handleNotification,
    handleUndo,
  }))

  let border_class = ""

  if (modelState === "INITIALIZED")
    border_class = "border_inference_pending border_inference_animate"
  else if (modelState === "RUNNING") {
    border_class = "border_inference_animate"
  } else if (modelState === "COMPLETED") {
    border_class = "border_inference_complete"
  } else if (modelState === "ERROR") {
    border_class = "border_inference_error"
  }

  function insertLineBreaks(str) {
    if (str === undefined || str === null) return [];

    const words = str.split(" ");
    const result = [];
    for (let i = 0; i < words.length; i++) {
      result.push(`${words[i]} `);
      if ((i + 1) % 4 === 0) {
        result.push(<br />);
      }
    }
    return result;
  }

  const paragraphs = insertLineBreaks(errorMessage).map((words, index) => (
    <span key={index}>{words}</span>
  ));

  const token_per_second =
    totalCharacters > 0 ? Math.floor(totalCharacters / Math.max(time, 1)) : 0

  return (
    <div className={`flex flex-col items-center text-gray-600 text-lg font-bold h-96`}
      style = {model.state.selected? {
        backgroundColor: '#f5f5f5',
        borderRadius: 4,
        padding: 2
      } : {} }>
      <div className="flex justify  max-w-[100%]">
        <h2
          onClick={(event) => { handleSelectModel(model, event.ctrlKey) }}
          className={
            `select-none cursor-pointer text-ellipsis overflow-hidden max-w-full whitespace-nowrap overflow-hidden ${model.state.selected ? 'font-medium' : 'font-normal'}`
          }>
            {model.name}
        </h2>
      </div>
      <div className="relative editor-container h-full w-full text-base flex mt-2">
        <div
          className={`font-medium relative p-3 overflow-hidden flex-1 flex flex-col loading_border ${border_class}`}
        >
        <Editor
          readOnly={true}
          customStyleMap={styleMap}
          editorState={editorState}
          onChange={() => {}}
        />
        <div className="flex font-medium">
          <span>{formatTime(time)}</span>
          <span className="flex-1"></span>
          <span>
            <Tooltip delayDuration={300} skipDelayDuration={150}>
              <TooltipTrigger asChild>
                <div style = {{display: (errorMessage ) ? 'block' : 'none'}}>
                  <AlertTriangle color = "#f56760"/>
                </div>
              </TooltipTrigger>
              <TooltipContent side={"top"}>
                <>{paragraphs}</>
              </TooltipContent>
            </Tooltip>
            
            {token_per_second === 0 || errorMessage ? "" : `${token_per_second} chars/s`}{" "}
          </span>
          <span className="flex-1"></span>
          <span>{totalCharacters} chars</span>
        </div>
      </div>
      </div>
    </div>
  )
})

export default function Compare() {
  // PROBABLY USEUSE EFFECT TO CREATE A "HISTORY"
  // NEED TO ADD STOP SEQUENCES
  const [model, setModel] = React.useState<string>("")
  const { availableModels, setAvailableModels } = useContext(ModelContext)
  // MODEL PARAMETERS
  const [openParameterSheet, setSaveOpenParameterSheet] =
    React.useState<boolean>(false)
  const [temperature, setTemperature] = React.useState<number>(1)
  const [maximumLength, setMaximumLength] = React.useState<number>(200)
  const [topP, setTopP] = React.useState<number>(1.0) // hugging face wants defualt of 1.0 and cohere is 0.75
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

  const [modelsWithParameters, setModelWithParameters] = React.useState<any>([])
  const modelEditorRefs = useRef({})

  // TEXT AREA CONTROL
  const [prompt, setPrompt] = React.useState<string>("")
  const [output, setOutput] = React.useState<string[]>([]) // use this potentially for model output and green text?
  const [prePrompt, setPrePrompt] = React.useState<string>("")
  const scrollRef = useRef(null) // create a ref to the scroll parent element
  // LOADING STATE
  const [generating, setGenerating] = React.useState<boolean>(false)
  const [modelLoading, setModelLoading] = React.useState<boolean>(false)
  // ABORT CONTROLLER FOR FETCH
  const abortController = useRef(null)
  // DIALOG CONTROL
  const { apiKeyAvailable, setApiKeyAvailable } = useContext(APIContext)
  const [openDialog, setOpenDialog] = React.useState<boolean>(false)
  const [highlightModels, setHighlightModels] = React.useState<boolean>(true);
  const { isLg } = useBreakpoint("lg")

  const [allSelected, setAllSelected] = React.useState<boolean>(true);

  const [showAllParameters, setShowAllParameters] =
    React.useState<boolean>(false)

  // TEXT EDITOR FUNCTIONS
  // TEXT EDITOR DECORATOR HELPER
  const Decorated = (props: any) => {
    const children = props.children
    const contentState = props.contentState
    const entity = props.contentState.getEntity(props.entityKey)
    const entityData = entity.getData()
    const style = getDecoratedStyle(entityData.model)
    if (entityData.output === props.decoratedText) {
      let content = (
        <span style={style} data-offset-key={children[0].key}>
          {children}
        </span>
      )

      if (entityData.model.startsWith("openai:")) {
        content = (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>{content}</TooltipTrigger>
              <TooltipContent
                hidden={!showProbabilitiesRef.current}
                side="bottom"
              >
                <p>Probability = {entityData.prob}%</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
    let settings = JSON.parse(localStorage.getItem("openplayground_compare_settings") || "{}")
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

    const fetchDefaultParameters = async () => {
      console.log("fetching default parameters", model_dict)
      const response = await fetch(
        ENDPOINT_URL.concat("/api/models_defaults"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            models: Object.keys({
              ...availableModels,
              ...model_dict,
            }),
          }),
        }
      )

      const json_params = await response.json()
      const models = [];

      Object.keys(json_params).forEach(function (key) {
        const model = {
          name: key,
          tag: key,
          parameters: json_params[key],
          state: {
            enabled: true,
            selected: false,
          }
        }

        models.push(model)
      })

      console.warn("[][][][][]")
      let settings = JSON.parse(localStorage.getItem("openplayground_compare_settings") || "{}")
      if (settings.models)
        for (const saved_model of settings.models) {
          if (saved_model.is_clone) { //is_clone
            //name without last fragment
         
            for (const [index, model] of models.entries()) {
              if (saved_model.name === model.name) {
                models.splice(index + 1, 0, saved_model)
                break;
              }
            }
            continue
          }

          for (const model of models) {
            if (saved_model.name === model.name) {
              model.tag = saved_model.tag
              model.state = saved_model.state
              model.parameters = saved_model.parameters
            }
          }
        }
      
      setModelWithParameters(models)

     
      if (Object.keys(settings).length !== 0) {
        console.log("Loading settings from local storage....")
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
        setPrePrompt(settings.preprompt)
        setAllSelected(settings.allSelected)
        setShowAllParameters(settings.showAllParameters)
        setHighlightModels(settings.highlightModels)
      }
    }

    fetchDefaultParameters().catch(console.error)
  }, [])

  const firstUpdate = useRef(true);

  console.warn("settings.allSelected", allSelected)
  useEffect(() => {
    console.warn("firing....")
    if (firstUpdate.current === false || localStorage.getItem("openplayground_compare_settings") === null) {
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
      models: modelsWithParameters,
      allSelected: allSelected,
      showAllParameters: showAllParameters,
      highlightModels: highlightModels
      })
      localStorage.setItem("openplayground_compare_settings", settings)
    }

    firstUpdate.current = false;
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
    modelsWithParameters,
    allSelected,
    showAllParameters,
    highlightModels
  ])

  // HANDLE STREAMING CHARACTERS
  const handleStream = (e: MessageEvent) => {
    let resp = JSON.parse(e.data)
    if (resp["message"] === "You have successfully connected.") {
      return
    }

    let model_tag = ""
    if (resp.hasOwnProperty("model_tag")) {
      model_tag = resp["model_tag"]
    }

    notifyEditor(model_tag, resp)
  }

  // EDITOR UPDATER
  useEffect(() => {
    // add to words array
    console.log("OUTPUT:", output)
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
    regenerate = false //Something is wrong here
    setGenerating(true)
    if (regenerate) {
      setPrePrompt(passedInPrompt)
    } else {
      setPrePrompt(prompt)
    }
    window.addEventListener('beforeunload', beforeUnloadHandler);
    const sse = new EventSource(ENDPOINT_URL.concat("/api/listen"))

    function beforeUnloadHandler() {
      sse.close()
    }
    sse.onopen = async () => {
      // begin model loading and inference
      abortController.current = new AbortController()
      const res = await fetch(ENDPOINT_URL.concat("/api/compare"), {
        signal: abortController.current.signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uuid: uuid(),
          prompt: regenerate ? passedInPrompt : prompt,
          models: modelsWithParameters.map((model) => {
            //is_clone ? model.name.split(":")[] 
            if(model.state.enabled) {
              return {
                name: model.name, tag: model.tag, parameters: Object.keys(model.parameters).reduce(
                (acc, key) => {
                  acc[key] = model.parameters[key].value
                  return acc
                },
                {})
              }
            }
          }).filter(Boolean)
        }),
      })
        .catch((e) => {
          if (e.name === "AbortError") {
            console.log("ABORTED")
          }
        })
        .finally(() => {
          // close everything
          sse.close()
          setGenerating(false)
          window.removeEventListener('beforeunload', beforeUnloadHandler);
        })
    }

    sse.onmessage = (e) => {
      handleStream(e)
    } // update the prompt state
    // set proper endpoint for streaming


    console.log("calling fetch")
    console.log(passedInPrompt)
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
    for (const model in modelsWithParameters) {
      if (modelsWithParameters[model].enabled) {
        if (
          model?.startsWith("cohere:") ||
          model?.startsWith("openai:") ||
          model?.startsWith("huggingface:")
        ) {
          if (
            model?.startsWith("cohere:") &&
            apiKeyAvailable["co:here"] === false
          ) {
            setOpenDialog(true)
            return
          } else if (
            model?.startsWith("openai:") &&
            apiKeyAvailable["OpenAI"] === false
          ) {
            setOpenDialog(true)
            return
          } else if (
            model?.startsWith("huggingface:") &&
            apiKeyAvailable["HuggingFace Hosted"] === false
          ) {
            setOpenDialog(true)
            return
          }
        }
      }
    }

    return handleStreamingSubmit(regenerate, passedInPrompt)
  }

  // handle undo last, update editor state
  const handleUndoLast = () => {
    for (const editor_model_tag of Object.keys(modelEditorRefs.current)) {
      if (modelEditorRefs.current[editor_model_tag])
        modelEditorRefs.current[editor_model_tag].handleUndo()
    }
  }

  // HELPER FUNCTIONS
  const editorRef = React.useRef(null)

  function focusEditor() {
    editorRef.current.focus()
  }

  // abort the fetch if the user clicks the cancel button
  const abortFetch = () =>
    abortController.current &&
    abortController.current.abort("User requested abort")

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
    }
    handleUndoLast()
  }
  useMetaKeyPress(["O"], undoLastKeyPress)

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

  console.log('---> modelsWithParameters', modelsWithParameters)
  const number_of_models_selected = modelsWithParameters.filter(
    (model) => model.state.selected
  ).length
  const number_of_models_enabled = modelsWithParameters.filter(
    (model) =>model.state.enabled
  ).length

  const models_shared_keys = modelsWithParameters
    .filter((model) => model.state.enabled && (number_of_models_selected >= 1 ?  model.state.selected : true))
    .map((model) => model.parameters)
    .flatMap((parameter) => {
      console.log("parameter", parameter)
      return Object.entries(parameter)
        .filter(
          ([key, _]) =>
            key !== "enabled" && key !== "selected" && key !== "model_name"
        )
        .map(([key, parameter]) => ({ key, range: parameter["range"] }))
        })
    .reduce((acc, { key, range }) => {
      acc[key] = acc[key] || { range: [] }
      acc[key].range = [...new Set([...acc[key].range, ...range])]

      return acc
    }, {})
  
    console.log("models_shared_keys", models_shared_keys)

  const models_shared_keys_copy = JSON.parse(JSON.stringify(models_shared_keys))

  const notifyEditor = (model_tag, message) => {
    if (modelEditorRefs.current[model_tag])
      modelEditorRefs.current[model_tag].handleNotification(message)
  }

  const generate_table_line_graph = (parameter) => {
    if (!parameter) return (<div style={{ flex: 1 }}>
      <span className="cursor-default text-xs">N/A</span>
    </div>)

    return (
      <div style = {{flex: 1}}>
        <div
          className = "mx-4"
          style={{
            position: 'relative',
            display: "flex",
            alignItems: "center",
          }}
        >
            <div
              className="rounded-md bg-slate-200"
              style={{ width: "100%", height: 3 }}
            ></div>
            <div
              className="rounded-md bg-slate-600"
              style={{
                transition: 'all 0.3s ease-in 0s',
                position: "absolute",
                width: `${100 *
                  (parameter.value / parameter.range[1])}%`
                  ,
                height: 3,
                top: 0,
              }}
            ></div>
        </div>
        <span
          className= "cursor-default"
          style={{
            position: "absolute",
            top: -1,
            right: 16,
            fontSize: 12,
          }}
        >
          {normalize_parameter(
            parameter.value 
          )}
        </span>
      </div>
    )
  }

  const handleSelectModel = (model, ctrl_pressed: boolean) => {
    const selected = (!ctrl_pressed && number_of_models_selected > 1) ? true : !model.state.selected

    if (selected && !ctrl_pressed) {
      const parameters = model.parameters
      if ("temperature" in parameters)
        setTemperature(parameters.temperature.value)
      if ("maximum_length" in parameters)
        setMaximumLength(parameters.maximum_length.value)
      if ("top_p" in parameters)
        setTopP(parameters.top_p.value)
      if ("top_k" in parameters)
        setTopK(parameters.top_k.value)
      if ("repetition_penalty" in parameters)
        setRepetitionPenalty(
          parameters.repetition_penalty.value
        )
      if ("num_beams" in parameters)
        setNumBeams(parameters.num_beams.value)
      if ("num_return_sequences" in parameters)
        setNumReturnSequences(parameters.num_return_sequences.value)
      if ("frequency_penalty" in parameters)
        setFrequencyPenalty(parameters.frequency_penalty.value)
      if ("presence_penalty" in parameters)
        setPresencePenalty(parameters.presence_penalty.value)
      if ("stop_sequences" in parameters)
        setStopSequences(parameters.stop_sequences.value || [])
    }

    setModelWithParameters(
      modelsWithParameters.map((m) => {
        if (!ctrl_pressed && m.tag !== model.tag) {
          m.state.selected = false
        } else if (m.tag === model.tag) {
          m.state.selected = selected
        }
        return m
      })
    )
  }
  const [isCollapsed, setIsCollapsed] = useState(true);
  console.warn("Models with params", modelsWithParameters)
  //max-w-[1920px] 
  const textArea = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className="flex flex-col grow basis-auto lg:max-w-[calc(100%-266px)] max-w-[100%]"
    >
      <div className="h-[25%] flex">
        <div
          className={`relative p-3 overflow-hidden flex-1 flex flex-col loading_border`}
        >
          <div
            ref={scrollRef}
            onClick={focusEditor}
            className="overflow-y-auto editor-container h-[100%] w-full p-3 text-base"
          >
            <Editor
              placeholder={
                number_of_models_enabled >= 1
                  ? "Type your prompt here..."
                  : "No models have been enabled..."
              }
              readOnly={number_of_models_enabled === 0}
              ref={editorRef}
              keyBindingFn={keyBindingFn}
              handleKeyCommand={handleKeyCommand}
              customStyleMap={styleMap}
              editorState={editorState}
              onChange={(editorState: any) => {
                setEditorState(editorState)
                setPrompt(
                  editorState.getCurrentContent().getPlainText("\u0001")
                )
              }}
            />
          </div>
          <div className="flex justify-end">
            {generating && (
              <Button
                variant="default"
                className="inline-flex items-center ml-1 text-sm font-medium text-center"
                onClick={(e) => {
                  e.stopPropagation()
                  abortFetch()
                  modelsWithParameters.forEach((model) => {
                    if(model.state.enabled) {
                      notifyEditor(model.tag, {
                        "model_name": model.name, "model_tag": model.tag,
                        "message": "[ERROR] Generation aborted"
                      })
                    }
                  })
                }}
                >
                  {" "}
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancel
              </Button>)
            }
            {!modelLoading && !generating && (
              <Button
                disabled={prompt === "" || number_of_models_enabled === 0}
                variant="default"
                className="bg-emerald-500 hover:bg-emerald-700 inline-flex items-center ml-1 text-sm font-medium text-center"
                type="submit"
                value="submit"
              >
                Submit
              </Button>
            )}

            <Button
              type="button"
              variant="subtle"
              className="inline-flex items-center ml-2 text-sm font-medium text-center"
              onClick={handleUndoLast}
              disabled={prePrompt === ""}
            >
              Undo Last
            </Button>
            <Button
              type="button"
              variant="subtle"
              className="inline-flex items-center ml-2 text-sm font-medium text-center"
              onClick={(e) => {
                e.stopPropagation()
                handleUndoLast()
                handleSubmit(true, prePrompt)
              }}
              disabled={prePrompt === ""}
            >
              Regenerate Output
            </Button>
          </div>
        </div>
      </div>
       
          {!showAllParameters || number_of_models_enabled === 0 ? null :  <div className="mt-4" style={{ justifyContent: 'center', display: 'flex' }}>
        <div className="rounded-sm border border-slate-200" style={{ maxHeight: 350, maxWidth: 1400, overflow: 'auto' }}>
          <div className="flex flex-col m-2" style={{ minWidth: 900 }}>
            <div className="flex flex-row">
              <div className="text-center font-normal" style={{ minWidth: 150, maxWidth: 150, position: 'sticky', left: 0, zIndex: 1, background: '#fff' }}>
                Model
              </div>
              <div className="text-center font-normal cursor-default" style={{ minWidth: 150, flex: 1 }}>
                ML
              </div>
              <div className="text-center font-normal cursor-default" style={{ minWidth: 150, flex: 1 }}>
                T
              </div>
              <div className="text-center font-normal cursor-default" style={{ minWidth: 150, flex: 1 }}>
                TP
              </div>
              <div className="text-center font-normal cursor-default" style={{ minWidth: 150, flex: 1 }}>
                TK
              </div>
              <div className="text-center font-normal cursor-default" style={{ minWidth: 150, flex: 1 }}>
                FP
              </div>
              <div className="text-center font-normal cursor-default" style={{ minWidth: 150, flex: 1 }}>
                PP
              </div>
              <div className="text-center font-normal cursor-default" style={{ minWidth: 150, flex: 1 }}>
                RP
              </div>
            </div>
          {
            modelsWithParameters
            .filter((model) => model.state.enabled)
            .map((model) => {
              return (
                <div
                  key={model.tag} className={`cursor-pointer flex flex-row hover:bg-slate-100 ${model.state.selected ? 'bg-slate-100' : 'bg-white'}`}
                  onClick={(event) => {
                    handleSelectModel(model, event.ctrlKey)
                    }} >
                  <div className={`py-1  bg-inherit text-center font-light ${model.state.selected ? 'font-medium' : ''}`}
                    style={{ minWidth: 150, maxWidth: 150, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", position: 'sticky', left: 0, zIndex: 2 }}>
                    <span>{model.name.split(":")[1]}</span>
                  </div>
                  <div className="bg-inherit text-center font-light" style={{ position: "relative", minWidth: 150, flex: 1, display: 'flex', alignItems: 'center'  }}>
                    {generate_table_line_graph(model.parameters.maximum_length)}
                  </div>
                  <div className="bg-inherit text-center font-light" style={{ position: "relative", minWidth: 150, flex: 1, display: 'flex', alignItems: 'center'  }}>
                    {generate_table_line_graph(model.parameters.temperature)}
                  </div>
                  <div className="bg-inherit text-center font-light" style={{ position: "relative", minWidth: 150, flex: 1, display: 'flex', alignItems: 'center' }}>
                    {generate_table_line_graph(model.parameters.top_p)}
                  </div>
                  <div className="bg-inherit text-center font-light" style={{ position: "relative", minWidth: 150, flex: 1, display: 'flex', alignItems: 'center'  }}>
                    {generate_table_line_graph(model.parameters.top_k)}
                  </div>
                  <div className="bg-inherit text-center font-light" style={{ position: "relative", minWidth: 150, flex: 1, display: 'flex', alignItems: 'center'  }}>
                    {generate_table_line_graph(model.parameters.frequency_penalty)}
                  </div>
                  <div className="bg-inherit text-center font-light" style={{ position: "relative", minWidth: 150, flex: 1, display: 'flex', alignItems: 'center'  }}>
                    {generate_table_line_graph(model.parameters.presence_penalty)}
                  </div>
                  <div className="bg-inherit text-center font-light" style={{ position: "relative", minWidth: 150, flex: 1, display: 'flex', alignItems: 'center'  }}>
                    {generate_table_line_graph(model.parameters.repetition_penalty)}
                  </div>
                </div>
              )
            })}
          </div>
      </div></div>}
          <TransitionGroup
            className={`grid h-full mt-3 pr-1 overflow-auto 
            ${
              number_of_models_enabled === 1 
                  ? 'grid-cols-1 gap-1 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-2'
                  : number_of_models_enabled === 2 
                  ? 'grid-cols-1 gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-3 5xl:grid-cols-4 6xl:grid-cols-5 8xl:grid-cols-6'
                  : 'grid-cols-1 gap-2 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-4 5xl:grid-cols-5 6xl:grid-cols-6 8xl:grid-cols-8'
              }
            }`}
            > {
              modelsWithParameters
              .filter((model) => model.state.enabled)
              .map((model) => {
                return (
                  <CSSTransition
                    timeout={500}
                    classNames="fade"
                    unmountOnExit
                    key ={model.tag}>
                    <ModelCard
                        handleSelectModel={handleSelectModel}
                        key={model.tag}
                        model={model}
                        showProbabilities={showProbabilities}
                        showHighlights={highlightModels}
                        ref={(ref) => (modelEditorRefs.current[model.tag] = ref) }
                      />
                  </CSSTransition>
                )
              })
            }
          </TransitionGroup>

    </form>
  )

  function getModelProviderForStoredModel(model: string) {
    const model_key = "model_" + model.split(":")[1]
    const model_info = JSON.parse(localStorage.getItem(model_key) || "{}")
    return model_info.model_provider
  }

  const handleTempertureChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.temperature &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.temperature.value = value

        return model
      })
    )
  }

  const handleTopPChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.top_p &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.top_p.value = value

        return model
      })
    )
  }

  const handleTopKChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.top_k &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.top_k.value = value

        return model
      })
    )
  }

  const handleNumReturnChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.num_return_sequences &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.num_return_sequences.value = value

        return model
      })
    )
  }

  const handleNumBeamsChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.num_beams &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.num_beams.value = value

        return model
      })
    )
  }

  const handleMaxLengthChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.maximum_length &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.maximum_length.value = value

        return model
      })
    )
  }

  const handleFrequencyPenaltyChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.frequency_penalty &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.frequency_penalty.value = value

        return model
      })
    )
  }

  const handlePresencePenaltyChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.presence_penalty &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.presence_penalty.value = value

        return model
      })
    )
  }

  const handleRepetitionPenaltyChange = (value: number) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.repetition_penalty &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.repetition_penalty.value = value

        return model
      })
    )
  }

  const handleStopSequencesChange = (value: string[]) => {
    setModelWithParameters(
      modelsWithParameters.map((model) => {
        if (
          model.parameters.stop_sequences &&
          (number_of_models_selected === 0 || model.state.selected)
        )
          model.parameters.stop_sequences.value = value

        return model
      })
    )
  }


  const should_disable_slider = (parameter_range, name) => {
    //console.log("should_disable_slider", parameter_range, name)
    if (number_of_models_enabled === 0) return true
    if (parameter_range && parameter_range.range.length > 2) return true
    return false
  }

  const alert_message = (parameter_range) => {
    if (number_of_models_enabled === 0)
      return (
        <p>
          <b>Disabled:</b> no models have been enabled.
        </p>
      )
    if (parameter_range && parameter_range.range.length > 2)
      return (
        <p>
          <b>Disabled:</b> the range of values for this parameter
          <br /> <b>is not</b> uniform across all models.
          <br />
          <b>Tip:</b> to edit similar models, tap the models on
          <br /> the list or select them by clicking their name
          <br /> above their respective editor.
        </p>
      )
  }
  

  const parameterSidebar = (
    <div className="flex flex-col max-h-[100%] sm:pt-3 md:pt-[0px] lg:pt-[0px]">
      <div className="flex mb-2">
        <span className="cursor-default flex-1 flow-root inline-block align-middle">
          <p className="text-sm font-medium float-left align-text-top">
            Parameters
          </p>
        </span>
        <Tooltip delayDuration={300} skipDelayDuration={150}>
          <TooltipTrigger asChild>
            <div
              onClick={() => {
                setShowAllParameters(!showAllParameters)
              }}
              className={`mx-1 cursor-pointer flex justify-center items-center w-[24px] h-[24px] rounded-full border-[1px] border-slate-200 select-none ${
                showAllParameters
                  ? "text-white bg-slate-700"
                  : "hover:text-white hover:bg-slate-700 text-slate-600 bg-white"
              }`}
            >
              <BarChart2 size={18} />
            </div>
          </TooltipTrigger>
          <TooltipContent side={"bottom"}>
            <p>Show Parameters for all models</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-y-3">
        {/* Maximum Length {("maximum_length" in models_shared_keys) ? (*/}

        <ParamaterSlider
          title="Maximum Length"
          type="number"
          defaultValue={maximumLength}
          disabled={should_disable_slider()}
          onChangeValue={handleMaxLengthChange}
          min={
            should_disable_slider(models_shared_keys_copy["maximum_length"])
              ? 50
              : models_shared_keys_copy["maximum_length"].range.shift()
          }
          max={
            should_disable_slider(models_shared_keys_copy["maximum_length"])
              ? 1024
              : models_shared_keys_copy["maximum_length"].range.pop()
          }
          step={1}
          setParentState={setMaximumLength}
          normalizeInputData={(value) => parseInt(value)}
          tooltipContent={
            <>
              <p>
                Maximum number of tokens to generate. <br /> Responses are not
                guaranted to fill up <br /> to the maximum desired length.{" "}
                <br /> <b>Defaults to 200.</b>
              </p>

              {alert_message()}
            </>
          }
        />

          {/* Temperature */}

          <ParamaterSlider
          title="Temperature"
          defaultValue={temperature}
          disabled={should_disable_slider(models_shared_keys["temperature"])}
          onChangeValue={handleTempertureChange}
          min={
            should_disable_slider(models_shared_keys_copy["temperature"])
              ? 0
              : models_shared_keys_copy["temperature"].range.shift()
          }
          max={
            should_disable_slider(models_shared_keys_copy["temperature"])
              ? 1
              : models_shared_keys_copy["temperature"].range.pop()
          }
          step={0.01}
          type="number"
          normalizeInputData={(value) => parseFloat(value)}
          tooltipContent={
            <>
              <p>
                A non-negative float that tunes the degree <br /> of randomness
                in generation. Lower <br />
                temperatures mean less random generations.
                <br />
                <b> Defaults to 0.5</b>
              </p>
              {alert_message(models_shared_keys["temperature"])}
            </>
          }
          setParentState={setTemperature}
        />


        {/* TOP P */}

        <ParamaterSlider
          title="Top P"
          type="number"
          defaultValue={topP}
          disabled={should_disable_slider()}
          onChangeValue={handleTopPChange}
          min={
            should_disable_slider(models_shared_keys_copy["top_p"])
              ? 0
              : models_shared_keys_copy["top_p"].range.shift()
          }
          max={
            should_disable_slider(models_shared_keys_copy["top_p"])
              ? 1
              : models_shared_keys_copy["top_p"].range.pop()
          }
          step={0.01}
          normalizeInputData={(value) => parseFloat(value)}
          setParentState={setTopP}
          tooltipContent={
            <>
              <p>
                If set to float less than 1, only the smallest <br /> set of
                most probable tokens with probabilities <br /> that add up to
                top_p or higher are kept for
                <br /> generation. <br />
                <b>Defaults to 1.0</b>
              </p>
              {alert_message()}
            </>
          }
        />

        {/* TOP K */}
        {"top_k" in models_shared_keys ? (
          <ParamaterSlider
            title="Top K"
            type="number"
            defaultValue={topK}
            disabled={should_disable_slider(models_shared_keys["top_k"], "top_k")}
            onChangeValue={handleTopKChange}
            min={
              should_disable_slider(models_shared_keys_copy["top_k"])
                ? 0
                : models_shared_keys_copy["top_k"].range.shift()
            }
            max={
              should_disable_slider(models_shared_keys_copy["top_k"])
                ? 500
                : models_shared_keys_copy["top_k"].range.pop()
            }
            step={1}
            normalizeInputData={(value) => parseInt(value)}
            setParentState={setTopK}
            tooltipContent={
              <>
                <p>
                  Can be used to reduce repetitiveness of <br />
                  generated tokens. The higher the value,
                  <br /> the stronger a penalty is applied to
                  <br />
                  previously present tokens, proportional
                  <br /> to how many times they have already
                  <br /> appeared in the prompt or prior generation. <br />
                  <b>Defaults to 0.0, max value of 1.0</b>
                </p>
                {alert_message(models_shared_keys["top_k"])}
              </>
            }
          />
        ) : null}

        {/* Frequency Penalty */}

        <ParamaterSlider
          title="Frequency Penalty"
          type="number"
          defaultValue={frequencyPenalty}
          disabled={should_disable_slider(
            models_shared_keys["frequency_penalty"]
          )}
          onChangeValue={handleFrequencyPenaltyChange}
          min={
            should_disable_slider(models_shared_keys_copy["frequency_penalty"])
              ? 0
              : models_shared_keys_copy["frequency_penalty"].range.shift()
          }
          max={
            should_disable_slider(models_shared_keys_copy["frequency_penalty"])
              ? 1
              : models_shared_keys_copy["frequency_penalty"].range.pop()
          }
          step={0.01}
          normalizeInputData={(value) => parseFloat(value)}
          setParentState={setFrequencyPenalty}
          tooltipContent={
            <>
              <p>
                Can be used to reduce repetitiveness of <br />
                generated tokens. The higher the value,
                <br /> the stronger a penalty is applied to
                <br />
                previously present tokens, proportional
                <br /> to how many times they have already
                <br /> appeared in the prompt or prior generation.
                <br /> <b>Defaults to 0.0, max value of 1.0</b>
              </p>
              {alert_message()}
            </>
          }
        />

        {/* Presence Penalty */}

        <ParamaterSlider
          title="Presence Penalty"
          type="number"
          defaultValue={presencePenalty}
          disabled={should_disable_slider(
            models_shared_keys["presence_penalty"]
          )}
          onChangeValue={handlePresencePenaltyChange}
          min={
            should_disable_slider(models_shared_keys_copy["presence_penalty"])
              ? 0
              : models_shared_keys_copy["presence_penalty"].range.shift()
          }
          max={
            should_disable_slider(models_shared_keys_copy["presence_penalty"])
              ? 1
              : models_shared_keys_copy["presence_penalty"].range.pop()
          }
          step={0.01}
          normalizeInputData={(value) => parseFloat(value)}
          setParentState={setPresencePenalty}
          tooltipContent={
            <>
              <p>
                Can be used to reduce repetitiveness of <br />
                generated tokens. Similar to frequency_penalty,
                <br /> except that this penalty is applied equally <br /> to all
                tokens that have already appeared,
                <br />
                regardless of their <br /> exact frequencies. <br />
                <b>Defaults to 0.0, max value of 1.0</b>
              </p>
              {alert_message()}
            </>
          }
        />

        {"repetition_penalty" in models_shared_keys ? (
          <ParamaterSlider
            title="Repetition Penalty"
            type="number"
            defaultValue={repetitionPenalty}
            disabled={should_disable_slider(
              models_shared_keys["repetition_penalty"]
            )}
            onChangeValue={handleRepetitionPenaltyChange}
            min={
              should_disable_slider(
                models_shared_keys_copy["repetition_penalty"]
              )
                ? 0
                : models_shared_keys_copy["repetition_penalty"].range.shift()
            }
            max={
              should_disable_slider(
                models_shared_keys_copy["repetition_penalty"]
              )
                ? 2
                : models_shared_keys_copy["repetition_penalty"].range.pop()
            }
            step={0.01}
            normalizeInputData={(value) => parseFloat(value)}
            setParentState={setRepetitionPenalty}
            tooltipContent={
              <>
                <p>
                  Akin to presence penalty. The repetition penalty is meant{" "}
                  <br /> to avoid sentences that repeat themselves without{" "}
                  <br /> anything really interesting.{" "}
                  <b>Defaults to 1.0, means no penalty.</b>
                </p>
                {alert_message()}
              </>
            }
          />
        ) : null}

        {/* Stop Sequences */}

        <MultiSelect
          disabled={should_disable_slider()}
          setParentState={setStopSequences}
          onValueChange={handleStopSequencesChange}
          defaultOptions={stopSequences}
          tooltipContent={
            <>
              <p>
                Up to four sequences where the API will stop <br /> generating
                further tokens. The returned text <br />
                will not contain the stop sequence.
              </p>
              {alert_message()}
            </>
          }
        />

        <Tooltip delayDuration={300} skipDelayDuration={150}>
          <TooltipTrigger asChild>
            <div className="cursor-default flex justify-between align-middle inline-block align-middle mb-1">
              <p className="text-sm font-normal float-left align-text-top">
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
              When enabled hover over generated words <br /> to see how likely a
              token was to be generated,<br/> if the model supports it.
            </p>
          </TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={300} skipDelayDuration={150}>
          <TooltipTrigger asChild>
            <div className="cursor-default flex justify-between align-middle inline-block align-middle mb-1">
              <p className="text-sm font-normal float-left align-text-top">
                Highlight Models
              </p>
              <Checkbox
                name="highlight-models"
                className="float-right self-center"
                checked={highlightModels}
                onCheckedChange={(val: boolean) => setHighlightModels(val)}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side={isLg ? "left" : "bottom"}>
            <p>
              Disable model specific text highlights
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
      
      <div className="my-2 flex cursor-default flex mb-1">
        {/*
          <div className={`ease-in duration-200 ${ (number_of_models_selected > 1) ? "opacity-100" : "invisible opacity-0"}`}>
          <Tooltip delayDuration={300} skipDelayDuration={150}>
            <TooltipTrigger asChild>
            <XCircle
                onClick={() => {
                  setModelWithParameters(modelsWithParameters.map((m) => {
                    m.state.selected = false
                    return m
                  }))
                }}
                className={`cursor-pointer`}
                size={18}
              />
            </TooltipTrigger>
            <TooltipContent side={isLg ? "left" : "bottom"}>
              <p>
                Clear current model selection
              </p>
            </TooltipContent>
          </Tooltip>
          </div>
        */}
  
              <p className="flex-1 text-sm font-normal float-left align-text-top">
                Enable All
              </p>

          <Checkbox
            checked={allSelected}
            onCheckedChange={(val: boolean) => {
              console.log("all selected", val)
              setModelWithParameters(
                modelsWithParameters.map((m) => {
                  m.state.enabled = val
                  m.state.selected = false
                  return m
                })
              )

              setAllSelected(val)
            }}
            className="float-right"
          />
   
      </div>
      <div className="overflow-auto flex-1">
        <ul className="overflow-auto">
          {
            modelsWithParameters.map((model: any) => (
            <div
              key={`selected_${model.tag}`}
              className={`relative select-none my-2 flex justify-center items-center rounded-md border border-slate-200 font-mono text-sm dark:border-slate-700 overflow-hidden ${
                model.state.selected
                  ? "bg-slate-200 dark:bg-slate-200"
                  : ""
              } ${
                model.state.enabled
                  ? "cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-200"
                  : ""
              }`}
            >
              <div
                className={`pl-4 py-3 flex-1 overflow-hidden ${
                  !model.state.enabled ? "text-zinc-400" : ""
                }`}
                onClick={(event) => {
                  if (model.state.enabled)
                    handleSelectModel(model, event.ctrlKey)
                }}
              >
                {model.name.split(":")[1]}
                <br />
                <span style={{ fontSize: "12px" }}>
                  Provider: <i>{getModelProviderForStoredModel(model.name)}</i>
                </span>
                <br />
              </div>

              <Copy
                size={10}
                className="absolute top-2 right-2"
                onClick={() => {
                  const index_of_model = modelsWithParameters.findIndex((m: any) => m.name === model.name)
                  const name_fragments = model.name.split(":")
                  setModelWithParameters([
                    ...modelsWithParameters.slice(0, index_of_model + 1),
                    {
                      name: model.name,
                      parameters: model.parameters,
                      state: model.state,
                      is_clone: true,
                      tag: `${name_fragments[0]}:${name_fragments[1]}:${uuid()}`
                    },
                    ...modelsWithParameters.slice(index_of_model + 1),
                  ])
                }}
              />

              <Checkbox
                className="mr-6"
                key={model.tag}
                checked={model.state.enabled}
                onCheckedChange={(val: boolean) => {
                  setModelWithParameters(
                    modelsWithParameters.map((m: any) => {
                      if (m.tag === model.tag) {
                        return {
                          ...m,
                          state: {
                            ...m.state,
                            enabled: val,
                          },
                        }
                      }
                      return m
                    })
                  )
                }}
              />
              {
                model.is_clone ? (
                <Trash2
                  size={10}
                  className="absolute bottom-2 right-2"
                  onClick={() => {
                    setModelWithParameters(modelsWithParameters.filter((m: any) => m.tag !== model.tag))
                  }}
                />) : null
              }
            </div>
          ))}
        </ul>
      </div>
    </div>
  )
  
  const mobileOpenParametersButton = (
    <Sheet open={openParameterSheet} onOpenChange={setSaveOpenParameterSheet}>
      <SheetTrigger asChild>
        <Button variant="subtle" className="lg:hidden">
          <Settings2 className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[60vw] ">{parameterSidebar}</SheetContent>
    </Sheet>
  )

  return (
    <div className="flex flex-col h-full">
      <NavBar tab="compare">
        {/* mobile line break  */}
        <div className="basis-full h-0 lg:hidden bg-green-700"></div>
        <div className="mt-4 lg:mt-0 lg:ml-auto flex basis-full lg:basis-auto flex-wrap lg:flex-nowrap">
          <div className="flex basis-full mb-2 lg:mb-0">             
            {mobileOpenParametersButton}
          </div>
        </div>
      </NavBar>
      <AlertDialog open={openDialog} onOpenChange={setOpenDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You are missing an API key!</AlertDialogTitle>
            <AlertDialogDescription>
              Go to the settings page and submit your API key to use this{" "}
              {model?.startsWith("openai:") && "Open AI "}{" "}
              {model?.startsWith("huggingface:") && "HuggingFace Hub "}{" "}
              {model?.startsWith("cohere:") && "co:here"}
              model
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex flex-grow flex-col font-display min-h-0 min-w-0">
        {/* TEXTAREA COMPONENT */}
        <div className="flex flex-row space-x-4 flex-grow ml-5 mr-5 min-h-0 min-w-0">
          {textArea}
          <div className="hidden p-1 grow-0 shrink-0 basis-auto lg:w-[250px] overflow-auto lg:block">
            {parameterSidebar}
          </div>
          {/* SIDE BAR CHANGING VALUES */}
        </div>
      </div>
    </div>
  )
}
