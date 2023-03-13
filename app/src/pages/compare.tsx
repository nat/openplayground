const VERSION = "0.0.36"

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
import { Popover } from 'react-tiny-popover'
import NavBar from "../components/navbar"
import {SSE} from "sse.js"
import {
  Loader2,
  BarChart2,
  Copy,
  Settings2,
  AlertTriangle,
  Trash2,
  Filter
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
import chroma from "chroma-js"
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
import { InputArea } from "../components/inputarea"

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
  forefront: {
    backgroundColor: "#BCCAE8",
    padding: "2px 0",
  },
  anthropic: {
    backgroundColor: "#cc785c80",
    padding: "2px 0",
  },
  aleph_alpha: {
    backgroundColor: "#e3ff00",
    padding: "2px 0",
  },
  question_mark: {
    backgroundColor: "#d32fce80",
    padding: "2px 0",
  },
  default: {
    backgroundColor: "transparent",
    transition: 'background-color 0.2s ease-in-out',
    padding: "2px 0"
  },
}

// model specific text highlighting
function getDecoratedStyle(provider: string, showHighlights: boolean) {
  if (showHighlights === false) return styles.default

  switch (provider) {
    case "openai":
      return styles.openai
    case "textgeneration":
      return styles.textgeneration
    case "cohere":
      return styles.cohere
    case "huggingface":
      return styles.huggingface
    case "forefront":
      return styles.forefront
    case "anthropic":
      return styles.anthropic
    case "aleph-alpha":
      return styles.aleph_alpha
    case "???":
      return styles.question_mark

    default:
      return styles.default
  }
}
const normalize_parameter = (parameter: number) => {
  if (parameter > 1) return parameter
  else return parameter.toFixed(1)
}

const ModelCardStats = (props: any) => {
  const {errorMessage, is_running, totalCharacters} = props
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const intervalRef = useRef(null);
  const [time, setTime] = useState(0);
  
  useEffect(() => {
    if (is_running && isTimerRunning === false) {
      startTimer()
    } else if (!is_running && isTimerRunning === true) {
      stopTimer()
    }
  }, [is_running])


  const startTimer = () => {
    setIsTimerRunning(true)
    setTime(0)
    intervalRef.current = setInterval(() => {
      setTime((prevTime) => prevTime + 1)
    }, 1000)
  }

  const stopTimer = () => {
    clearInterval(intervalRef.current)
    setIsTimerRunning(false)
  }

  function insertLineBreaks(str) {
    if (str === undefined || str === null) return [];

    const words = str.split(" ");
    const result = [];
    let accumulator = "";

    for (let i = 0; i < words.length; i++) {
      //console.log("words[i]", words[i], accumulator)
      accumulator += `${words[i]} `;
      
      if ((i + 1) % 4 === 0 || i === words.length - 1) {
        result.push(accumulator);
        accumulator = "";
      }
    }
    return result;
  }

  const paragraphs = insertLineBreaks(errorMessage).map((words, index) => (
    <span style = {{display: 'block', textAlign: 'center'}} key={index}>{words}</span>
  ));

  const token_per_second =
    totalCharacters > 0 ? Math.floor(totalCharacters / Math.max(time, 1)) : 0

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60)
      .toString()
      .padStart(2, "0")
    const seconds = (time % 60).toString().padStart(2, "0")
    return `${minutes}:${seconds}`
  }

  return (
    <div className="flex font-medium">
      <span>{formatTime(time)}</span>
      <span className="flex-1"></span>
      <span>
        <Tooltip delayDuration={300} skipDelayDuration={150} open={errorMessage ? true : false}>
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
  )
}

const ModelEditor = React.memo((props: any) => {
  const {
    model, showHighlights, showProbabilities,
    editorState
  } = props

  return (
    <Editor
      readOnly={true}
      customStyleMap={styleMap}
      editorState={editorState}
      onChange={() => {}}
    />
  )
})

const ModelCard = forwardRef((props, ref) => {
  const _ref = useRef();
  //const onScreen = useOnScreen(_ref);

  const token_index = useRef(0)
  const {model, handleSelectModel, showHighlights, showProbabilities, completion} = props
  const [modelState, setModelState] = React.useState<string>("IDLE")
  const [errorMessage, setErrorMessage] = useState(null);
  const [totalCharacters, setTotalCharacters] = useState(0);
  const [output, setOutput] = React.useState<string[]>([])
  const [status, setStatus] = React.useState<string[]>([])

  //console.log("onScreen", onScreen, model.tag)
  if (completion.length > token_index.current) {
    //console.log(model.name, "completion", completion, token_index.current, completion.length)
    let completion_slice = completion.slice(token_index.current, completion.length)
    token_index.current = completion.length;
    setOutput(completion_slice)
  }

  const Decorated = (props: any) => {
    const children = props.children
    const entity = props.contentState.getEntity(props.entityKey)
    const entityData = entity.getData()
    const style = getDecoratedStyle(model.provider, showHighlightsRef.current)
    const probabilitiesMap = entityData.top_n_prob // comes in as json string
    const tokensMap = probabilitiesMap ? probabilitiesMap['tokens'] : []
    const [popoverOpen, setPopoverOpen] = React.useState<boolean>(false)
    if (entityData.output === props.decoratedText) {
      let content = (
        <span style={style} data-offset-key={children[0].key} className="hover:!brightness-90">
          {children}
        </span>
      )
      // model.provider === "cohere"  ||
      //console.log(`Model Provider: '${model.provider}' and Model Name: '${model.name}'`)

      if (
        (
          (model.provider === "openai" && model.name !== "openai:gpt-3.5-turbo") ||
          model.provider === "forefront"
        ) && (
          tokensMap[props.decoratedText] != undefined && tokensMap[props.decoratedText].length > 0
        )
        ) {
        let percentage = Math.min(tokensMap[props.decoratedText][1] / probabilitiesMap['simple_prob_sum'], 1.0)
        let f = chroma.scale(["#ff8886", "ffff00", "#96f29b"]) // red - yellow - green spectrum
        let highlight_color = f(percentage)

        let custom_style = showProbabilitiesRef.current ? {
          backgroundColor: highlight_color,
          padding: "2px 0",
        } : getDecoratedStyle(model.provider, showHighlightsRef.current)

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
              <div className="text-base">Total: {probabilitiesMap['log_prob_sum']} logprob on 1 tokens</div>
              <div className="text-xs">({probabilitiesMap['simple_prob_sum']}% probability covered in top {Object.keys(probabilitiesMap['tokens']).length} logits)</div>
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

  const showProbabilitiesRef = useRef(showProbabilities)
  const showHighlightsRef = useRef(showHighlights)
  useEffect(() => {
    setEditorState(
      EditorState.forceSelection(editorState, editorState.getSelection())
    )
  }, [showProbabilities, showHighlights])
  
  useEffect(() => {
    showProbabilitiesRef.current = showProbabilities
    showHighlightsRef.current = showHighlights
  })

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

  useEffect(() => {
    let current_editor_state = editorState;
    let aggregate_new_chars = 0;
    try {
      for(const output_entry of output) {
        //check if outpit is an array
        aggregate_new_chars += output_entry.message.split("").length
        const currentContent = current_editor_state.getCurrentContent()

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
          { model: output_entry.model_name, output: output_entry.message, prob: output_entry.prob, top_n_prob: output_entry.top_n_distribution }
        )
        // Call getLastCreatedEntityKey to get the key of the newly created DraftEntity record.
        const entityKey = currentContent.getLastCreatedEntityKey()
        //insert text at the selection created above
        const textWithInsert = Modifier.insertText(
          currentContent,
          selection,
          output_entry.message,
          null,
          entityKey
        )
        const editorWithInsert = EditorState.push(
          editorState,
          textWithInsert,
          "insert-characters"
        )
        current_editor_state = editorWithInsert
      }
    } catch (e) {
    }
    setTotalCharacters(totalCharacters + aggregate_new_chars)
    setEditorState(current_editor_state)
  }, [output])

  useEffect(() => {
    if (status.message === "[INITIALIZING]") {
      setModelState("INITIALIZED")
      setTotalCharacters(0)
      setErrorMessage(null)
      return
    }
    if (status.message && status.message.indexOf("[ERROR] ") === 0 && (modelState !== "COMPLETED" && modelState !== "IDLE")) {
      setModelState("ERROR")
      setErrorMessage(status.message.replace("[ERROR] ", ""))
      return
    }
    if (status.message === "[COMPLETED]") {
      setModelState("COMPLETED")
      return
    }
  }, [status])

  const handleNotification = (output: any) => {
    setOutput(output)
  }

  const handleNotificationStatus = (status: any) => {
    setStatus(status)
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
    handleNotificationStatus
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

  return (
    <div ref ={_ref} className={`flex flex-col items-center text-gray-600 text-lg font-bold h-96`}
      style = {model.state.selected? {
        transition: 'all 0.3s ease',
        backgroundColor: '#f5f5f5',
        borderRadius: 4,
        padding: 6
      } : {
        transition: 'all 0.3s ease',
        backgroundColor: '#ffffff',
        borderRadius: 0,
        padding: 0
      } }>
      <div className="flex justify  max-w-[100%]">
        <h2
          onClick={(event) => { handleSelectModel(model, event.ctrlKey) }}
          className={
            `select-none cursor-pointer text-ellipsis overflow-hidden max-w-full whitespace-nowrap overflow-hidden ${model.state.selected ? 'font-medium' : 'font-normal'}`
          }>
            {model.name}
        </h2>
      </div>
      <div className="relative editor-container h-full w-full text-base flex mt-2" style = {{clipPath: 'inset(-1px)'}}>
        <div
          className={`font-medium relative p-3 overflow-hidden flex-1 flex flex-col loading_border ${border_class}`}
        >
          <ModelEditor {...props} editorState ={editorState} />
          <ModelCardStats
            errorMessage={errorMessage}
            totalCharacters={totalCharacters}
            is_running = {modelState !== "ERROR" && modelState !== "COMPLETED" && modelState !== "IDLE"}
          />
       </div>
      </div>
    </div>
  )
})

export default function Compare() {
  const [modelSearchValue, setModelSearchValue] = React.useState<string>("");
  const is_mac_os = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const sseRef = useRef<any>(null);
  // PROBABLY USEUSE EFFECT TO CREATE A "HISTORY"
  // NEED TO ADD STOP SEQUENCES
  const [model, setModel] = React.useState<string>("")
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

  const [modelsCompletionState, setModelsCompletionState] = React.useState({});

  const [modelsWithParameters, setModelsWithParameters] = React.useState<any>([])
  const modelEditorRefs = useRef({})

  // TEXT AREA CONTROL
  const [prompt, setPrompt] = React.useState<string>("")
  const [output, setOutput] = React.useState<string[]>([]) // use this potentially for model output and green text?
  const [prePrompt, setPrePrompt] = React.useState<string>("")
  const scrollRef = useRef(null) // create a ref to the scroll parent element
  // LOADING STATE
  const [generating, setGenerating] = React.useState<boolean>(false)
  const generatingRef =  useRef(generating);
  // ABORT CONTROLLER FOR FETCH
  const abortController = useRef(null);
  const [highlightModels, setHighlightModels] = React.useState<boolean>(true);
  const { isLg } = useBreakpoint("lg")

  const [allSelected, setAllSelected] = React.useState<boolean>(true);
  const [showAllParameters, setShowAllParameters] =
    React.useState<boolean>(false);
  const [openDialog, setOpenDialog] = React.useState<boolean>(false)
  const [dialogTitle, setDialogTitle] = React.useState<string>("")
  const [dialogMessage, setDialogMessage] = React.useState<string>("")

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
      createEditor()
    ))
  )
  // PRESET LOADING and MODEL LOADING ON PAGE LOAD
  useEffect(() => {
    const fetchDefaultParameters = async () => {
      const response = await fetch(
        ENDPOINT_URL.concat("/api/all_models"),
        {
          method: "GET",
          headers: { 
          } 
        }
      )
      
      const json_params = await response.json();
      const models = [];
      const default_enabled_models = [
        'command-xlarge-nightly',
        'gpt-3.5-turbo',
      ];

      Object.keys(json_params).forEach(function (key) {
        //curent_model_metalog(json_params[key].name, default_enabled_models.indexOf(json_params[key].name) !== -1)
        const model = {
          name: key,
          tag: key,
          parameters: json_params[key].parameters,
          provider: json_params[key].provider,
          state: {
            enabled: default_enabled_models.indexOf(json_params[key].name) !== -1,
            selected: false,
          }
        }

        models.push(model)
      })

      let settings = JSON.parse(localStorage.getItem("openplayground_compare_settings") || "{}")

      if (settings && !settings.version || settings.version !== VERSION) {
        console.warn("Wiping local storage settings")
        settings = {}
        localStorage.setItem("openplayground_compare_settings", JSON.stringify(settings))
      } else {
        console.warn("Not clearing because..", settings, !settings.version, settings.version !== VERSION, settings.version , VERSION)
      }

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
          
          console.log("Loading models from local storage....")
          for (const model of models) {
            if (saved_model.name === model.name) {
              model.tag = saved_model.tag
              model.state = saved_model.state
              if (saved_model.parameters) {
                for (const [parameter_name, parameter_details] of Object.entries(saved_model.parameters)) {
                  if (model.parameters[parameter_name]) {
                    model.parameters[parameter_name].value = parameter_details.value
                  }
                }
              }
            }
          }
        }

      console.log("Setting models with parameters...", models)
      setModelsWithParameters(models)

     
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
        setShowProbabilities(settings.showProbabilities)
      }
    }

    fetchDefaultParameters().catch(console.error)
  }, [])

  const firstUpdate = useRef(true);

  useEffect(() => {
    //console.warn("firing....")
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
        highlightModels: highlightModels,
        showProbabilities: showProbabilities,
        version: VERSION
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
    highlightModels,
    showProbabilities
  ])

  // EDITOR UPDATER
  useEffect(() => {
    // add to words array
    //console.log("OUTPUT:", output)
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
    // check to see if we can even do the generation
    if (prompt.length > 5000) {
      setDialogTitle("Prompt is too large!")
      let dialogMessage = "Please reduce the size of your prompt for the generation to be submitted successfully. Your current size is " + prompt.length + " characters, however, we currently allow a maximum of 5000 characters." 
      setDialogMessage(dialogMessage)
      setOpenDialog(true)
      return
    }
    regenerate = false //Something is wrong here
    setGenerating(true)
    if (regenerate) {
      setPrePrompt(passedInPrompt)
    } else {
      setPrePrompt(prompt)
    }
    window.addEventListener('beforeunload', beforeUnloadHandler);
    const completions_buffer = {};

    const sse = new SSE(
      ENDPOINT_URL.concat('/api/listen'),
      {
        headers: {},
        payload: JSON.stringify({
          prompt: regenerate ? passedInPrompt : prompt,
          models: modelsWithParameters.map((model) => {
            if(model.state.enabled) {
              completions_buffer[model.tag] = [];

              return {
                name: model.name, tag: model.tag, provider: model.provider, parameters: Object.keys(model.parameters).reduce(
                (acc, key) => {
                  acc[key] = model.parameters[key].value
                  return acc
                },
                {})
              }
            }
          }).filter(Boolean)
        })
      }
    )
    
    sseRef.current = sse;

    function beforeUnloadHandler() {
      sse.close()
    }
    sse.onopen = async () => {
      //console.warn("Connection has been opened");
      const bulk_write = () => {
        setTimeout(() => {
          let new_tokens = false;

          for (let model_tag in completions_buffer) {
            if (completions_buffer[model_tag].length > 0) {
              new_tokens = true;
              modelsCompletionState[model_tag] = [
                ...(modelsCompletionState[model_tag] || []),
                ...completions_buffer[model_tag].splice(0, completions_buffer[model_tag].length)
              ];
            }
          }
          //flushSync(() => {
            if (new_tokens) setModelsCompletionState({...modelsCompletionState});
           // console.log(generatingRef.current, "modelsCompletionState", modelsCompletionState)
          //});
         
          if (generatingRef.current) bulk_write();
        }, 20)
      };
      bulk_write();
    }
    sse.addEventListener("infer", (event) => {
      let resp = JSON.parse(event.data)
      //console.log("STREAMING " + resp["model_tag"] + " " + resp["message"])
      completions_buffer[resp["model_tag"]].push(resp)
    });

    sse.addEventListener("status", (event) => {
      let resp = JSON.parse(event.data)
      //console.log("STATUS STREAMING " + resp["message"], resp)
      notifyEditorStatus(resp["model_tag"], resp)
    });

    const close_sse = () => {
      setGenerating(false)
      window.removeEventListener('beforeunload', beforeUnloadHandler);
    }

    sse.addEventListener("error", (event) => {
      //console.log("event", event)
      const message = JSON.parse(event.data)
      if (message.status === "Too many pending requests") {
        setDialogTitle("Previous completion still running")
        setDialogMessage("Please wait a few seconds before trying again.")
        setOpenDialog(true)
      }
      close_sse();
    });

    sse.addEventListener("abort", (event) => {
      console.log("abort", event)
      close_sse();
    });

    sse.addEventListener("readystatechange", (event) => {
      if (event.readyState === 2) close_sse();
    });

    sse.stream();

    await fetch(ENDPOINT_URL.concat("/api/stream"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: regenerate ? passedInPrompt : prompt,
        models: modelsWithParameters.map((model) => {
          if(model.state.enabled) {
            completions_buffer[model.tag] = [];

            return {
              name: model.name, tag: model.tag, provider: model.provider, parameters: Object.keys(model.parameters).reduce(
              (acc, key) => {
                acc[key] = model.parameters[key].value
                return acc
              },
              {})
            }
          }
        }).filter(Boolean)
      })
    })
  }

  // ensure ref is up to date
  useEffect(() => {
    generatingRef.current = generating
  })

  // rerender editor when probability checkbox is updated
  useEffect(() => {
    setEditorState(
      EditorState.forceSelection(editorState, editorState.getSelection())
    )
  }, [showProbabilities])

  // Dispatch the fetch request to appropriate endpoint and connection type
  const handleSubmit = async (regenerate = false, passedInPrompt = "") => {
    handleUndoLast();
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
  const abortFetch = () => {
    if (sseRef.current) {
      notifyEditorStatus("*", {message: "[ERROR] Cancelled by user"})
      sseRef.current.close()
    }
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

  //console.log('---> modelsWithParameters', modelsWithParameters)
  const number_of_models_selected = modelsWithParameters.filter(
    (model) => model.state.selected
  ).length
  const number_of_models_enabled = modelsWithParameters.filter(
    (model) =>model.state.enabled
  ).length

  const models_shared_keys = modelsWithParameters
    .filter((model) => model.state.enabled && (number_of_models_selected >= 1 ?  model.state.selected : true))
    .map((model) => model.parameters)
    .flatMap((parameter) => Object.entries(parameter).map(([key, parameter]) => ({ key, range: parameter["range"] })))
    .reduce((acc, { key, range }) => {
      acc[key] = acc[key] || { range: [] }
      acc[key].range = [...new Set([...acc[key].range, ...range])]
      return acc
    }, {})
  

  const models_shared_keys_copy = JSON.parse(JSON.stringify(models_shared_keys))

  const notifyEditor = (model_tag, message) => {
    if (modelEditorRefs.current[model_tag])
      modelEditorRefs.current[model_tag].handleNotification(message)
  }

  const notifyEditorStatus = (model_tag, message) => {
    if (model_tag === "*") {
      for(const model_tag in modelEditorRefs.current) {
        if (modelEditorRefs.current[model_tag])
          modelEditorRefs.current[model_tag].handleNotificationStatus(message)
      }

      return 
    }
  
    if (modelEditorRefs.current[model_tag])
      modelEditorRefs.current[model_tag].handleNotificationStatus(message)
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

    setModelsWithParameters(
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

  //max-w-[1920px] 
  const textArea = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className="flex flex-col grow basis-auto lg:max-w-[calc(100%-266px)] max-w-[100%]"
    >
      <div className="min-h-[25%] max-h-[75%] flex border border-slate-400">
        <div
          className={`relative overflow-hidden flex-1 flex flex-col p-2`}
        >
          <div
            ref={scrollRef}
            onClick={focusEditor}
            className="overflow-y-auto editor-container h-[100%] w-full text-base"
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
                  editorState.getCurrentContent().getPlainText()
                )
              }}
            />
          </div>
          <div className="absolute bottom-[.5em] right-[1em] z-[2]">
            {generating && (
              <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
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
              </Button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="center"
                className="bg-slate-600 text-white hidden md:block"
              >
                Cancel &nbsp;
                <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Escape
                </kbd>
                &nbsp;
              </TooltipContent>
            </Tooltip>)
            }
            {!generating && (
              <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <Button
                  disabled={prompt === "" || number_of_models_enabled === 0}
                  variant="default"
                  className="bg-emerald-500 hover:bg-emerald-700 inline-flex items-center ml-1 text-sm font-medium text-center"
                  type="submit"
                  value="submit"
                >
                  Submit
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="center"
                className="bg-slate-600 text-white hidden md:block"
              >
                Submit &nbsp;
                <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                {is_mac_os ? '⌘' : 'Control'}
                </kbd>
                &nbsp;
                <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Enter
                </kbd>
              </TooltipContent>
            </Tooltip>
            )}
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
                  ? 'grid-cols-1 gap-3 sm:grid-cols-1 md:grid-cols-2'
                  : number_of_models_enabled === 3
                  ? 'grid-cols-1 gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
                  : number_of_models_enabled === 4 
                  ? 'grid-cols-1 gap-3 gap-3 sm:grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1 gap-2 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-4 5xl:grid-cols-5 6xl:grid-cols-6 8xl:grid-cols-8'
              }
            `}
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
                      completion = {modelsCompletionState[model.tag] || []}
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

  const handleTempertureChange = (value: number) => {
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    setModelsWithParameters(
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
    //console.warn("CHECK THIS", name, parameter_range)
    if (number_of_models_enabled === 0) return true
    //console.log("should_disable_slider", parameter_range, name)
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
    <div className="flex flex-col max-h-[100%] pt-4 sm:pt-4 md:pt-[0px] lg:pt-[0px]">
      <div className="flex mb-2">
        <span className="cursor-default flex-1 flow-root inline-block align-middle">
          <p className="text-sm font-medium float-left align-text-top">
            Parameters
          </p>
        </span>
        <input type="hidden" />
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
          disabled={should_disable_slider(models_shared_keys["top_p"])}
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
                  setModelsWithParameters(modelsWithParameters.map((m) => {
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
              setModelsWithParameters(
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

      <div className="my-2 flex flex-row border-slate-300 border p-2 rounded">
        <div className = "flex items-center">
          <Filter size ={18}/>
        </div>

        <div className = "ml-2 flex-1 mr-2">
          <input
            className="outline-0"
            style = {{width: "100%"}}
            value = {modelSearchValue}
            onChange={(event) => {
              setModelSearchValue(event.target.value)
            }}
            placeholder="Model Name"
          />
        </div>
      </div>
      <div>
        <ul>
          {
            modelsWithParameters
              .filter((model: any) => (modelSearchValue !== '' ? model.name.toLowerCase().indexOf(modelSearchValue.toLowerCase()) !== -1 : true))
              .map((model: any) => (
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
                  Provider: <i>{model.provider}</i>
                </span>
                <br />
              </div>

              <Copy
                size={10}
                className="absolute top-2 right-2"
                onClick={() => {
                  const index_of_model = modelsWithParameters.findIndex((m: any) => m.name === model.name)
                  const name_fragments = model.name.split(":")
                  setModelsWithParameters([
                    ...modelsWithParameters.slice(0, index_of_model + 1),
                    {
                      name: model.name,
                      parameters: model.parameters,
                      provider: model.provider,
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
                  setModelsWithParameters(
                    modelsWithParameters.map((m: any) => {
                      if (m.tag === model.tag) {
                        return {
                          ...m,
                          state: {
                            ...m.state,
                            enabled: val,
                            selected: false,
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
                    setModelsWithParameters(modelsWithParameters.filter((m: any) => m.tag !== model.tag))
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
          <Settings2 className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[80vw]">
        {parameterSidebar}
      </SheetContent>
    </Sheet>
  )

  return (
    <div className="flex flex-col h-full">
      <NavBar tab="compare">
        {/* mobile line break  */}
        <div className="align-middle mt-1">
          <div className="flex basis-full mb-2 lg:mb-0 space-x-2">
            {mobileOpenParametersButton}
          </div>
        </div>
      </NavBar>
      <AlertDialog open={openDialog} onOpenChange={setOpenDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              <p className="text-base text-slate-700 dark:text-slate-400">{dialogMessage}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Ok</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex flex-grow flex-col font-display min-h-0 min-w-0">
        {/* TEXTAREA COMPONENT */}
        <div className="flex flex-row space-x-4 flex-grow mx-2 md:ml-5 lg:ml-5 min-h-0 min-w-0">
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
