
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
  convertFromRaw,
  convertToRaw,
  CompositeDecorator,
  SelectionState,
  Modifier,
  ContentState,
  RichUtils,
  getDefaultKeyBinding,
} from "draft-js"
import { Button } from "../components/ui/button"
import { Popover } from "react-tiny-popover"
import NavBar from "../components/navbar"
import {
  Loader2,
  Settings2,
  AlertTriangle,
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
import {useMetaKeyPress} from "../lib/meta-keypress"
import {useKeyPress} from "../lib/keypress"
import "draft-js/dist/Draft.css"
import {Sheet, SheetContent, SheetTrigger} from "../components/ui/right-sheet"
import {CSSTransition, TransitionGroup} from "react-transition-group"
import {APIContext, EditorContext, ParametersContext, ModelsContext, ModelsStateContext} from "../app"
import {styleMap, getDecoratedStyle} from "../lib/editor-styles"
import ParameterSidePanel from "../components/parameters-side-panel"
import {handleSelectModel} from "../lib/utils"

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
      accumulator += `${words[i]} `;
      
      if ((i + 1) % 4 === 0 || i === words.length - 1) {
        result.push(accumulator);
        accumulator = "";
      }
    }
    return result;
  }

  const paragraphs = insertLineBreaks(errorMessage).map((words, index) => (
    <span className = "block text-center" key={index}>{words}</span>
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
            <div style = {{display: (errorMessage ) ? "block" : "none"}}>
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
    editorState,
    setEditorState
  } = props

  return (
    <Editor
      customStyleMap={styleMap}
      editorState={editorState}
      onChange={(editorState) => {
        setEditorState(editorState)
      }}
    />
  )
})

const ModelCard = forwardRef((props, ref) => {
  const token_index = useRef(0)
  const {model, showHighlights, showProbabilities, completion} = props
  const [serverModelState, setServerModelState] = React.useState<string>("IDLE")
  const [errorMessage, setErrorMessage] = useState(null);
  const [totalCharacters, setTotalCharacters] = useState(0);
  const [output, setOutput] = React.useState<string[]>([])
  const [status, setStatus] = React.useState<string[]>([])

  const {modelsStateContext, setModelsStateContext} = useContext(ModelsStateContext)
  const {parametersContext, setParametersContext} = useContext(ParametersContext)

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

  if (completion.length > token_index.current) {
    let completion_slice = completion.slice(token_index.current, completion.length)
    token_index.current = completion.length;
    setOutput(completion_slice)
  }

  const Decorated = (props: any) => {
    const children = props.children
    const entity = props.contentState.getEntity(props.entityKey)
    const entityData = entity.getData()
    const style = getDecoratedStyle(entityData.modelProvider, showHighlightsRef.current)
    const probabilitiesMap = entityData.topNDistribution
    const tokensMap = probabilitiesMap ? probabilitiesMap["tokens"] : []

    const [popoverOpen, setPopoverOpen] = React.useState<boolean>(false)
    if (entityData.message === props.decoratedText) {
      let content = (
        <span style={style} key={children[0].key} data-offset-key={children[0].key}>
          {children}
        </span>
      )
      
      if (probabilitiesMap && (tokensMap[props.decoratedText] != undefined && tokensMap[props.decoratedText].length > 0)) {
        let percentage = Math.min(tokensMap[props.decoratedText][1] / probabilitiesMap.simpleProbSum, 1.0)
        let f = chroma.scale(["#ff8886", "ffff00", "#96f29b"])
        let highlight_color = f(percentage)

        let custom_style = showProbabilitiesRef.current ? {
          backgroundColor: highlight_color,
          padding: "2px 0",
        } : style

        let popoverContent = 
        (
          <div className="shadow-xl shadow-inner rounded-sm bg-white mb-2" data-container="body">
            <ul key={children[0].key} className="grid pt-4">
              {
                Object.entries(tokensMap).map((item, index) => {
                  return (
                    <li key={item + "-" + index + "-" + children[0].key} className={item[0] === entityData.message ? "bg-highlight-tokens w-full font-base text-white pl-4" : "pl-4 text-bg-slate-800"}>
                      {item[0]} = {tokensMap[item[0]][1]}%
                    </li>
                  )
                })
              }
            </ul>
            <div className="m-4 pb-4">
              <div className="text-base">Total: {probabilitiesMap.logProbSum} logprob on 1 tokens</div>
              <div className="text-xs">({probabilitiesMap.simpleProbSum}% probability covered in top {Object.keys(probabilitiesMap.tokens).length} logits)</div>
            </div>
          </div>
        )
        content = (
          <Popover 
            isOpen={popoverOpen} 
            onClickOutside={() => setPopoverOpen(false)}
            positions={["bottom", "top", "left", "right"]}
            content={popoverContent}
            containerStyle={{zIndex: "1000"}}
          >
            <span style={custom_style} className={popoverOpen ? "font-bold" : ""} id={children[0].key} key={children[0].key} data-offset-key={children[0].key} onClick={() => {showProbabilitiesRef.current ? setPopoverOpen(!popoverOpen) : null}}>
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
  
  const getEditorState = useCallback((): EditorState => editorStateRef.current, [])

  const createDecorator = () => new CompositeDecorator([{
    strategy: findEntityRangesByType("HIGHLIGHTED_WORD"),
    component: Decorated,
    props: {
      getEditorState,
    }
  }])

  const [editorState, setEditorState] = React.useState(EditorState.createEmpty(createDecorator()))
  const editorStateRef = useRef<EditorState>(editorState)

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

        aggregate_new_chars += output_entry.message.split("").length
        const currentContent = current_editor_state.getCurrentContent()
        const blockMap = currentContent.getBlockMap()
        const key = blockMap.last().getKey()
        const length = blockMap.last().getLength()
        const selection = new SelectionState({
          anchorKey: key,
          anchorOffset: length,
          focusKey: key,
          focusOffset: length,
        })

        currentContent.createEntity("HIGHLIGHTED_WORD", "MUTABLE", output_entry)

        const entityKey = currentContent.getLastCreatedEntityKey()

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
      setServerModelState("INITIALIZED")
      setTotalCharacters(0)
      setErrorMessage(null)
      return
    }
    if (status.message && status.message.indexOf("[ERROR] ") === 0 && (serverModelState !== "COMPLETED" && serverModelState !== "IDLE")) {
      setServerModelState("ERROR")
      setErrorMessage(status.message.replace("[ERROR] ", ""))
      return
    }
    if (status.message === "[COMPLETED]") {
      setServerModelState("COMPLETED")
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
  switch (serverModelState) {
    case "INITIALIZED":
      border_class = "border_inference_pending border_inference_animate"
      break
    case "RUNNING":
      border_class = "border_inference_animate"
      break
    case "COMPLETED":
      border_class = "border_inference_complete"
      break
    case "ERROR":
      border_class = "border_inference_error"
      break
    default:
      break
  }

  return (
    <div className={`flex flex-col items-center text-gray-600 text-lg font-bold h-96`}
      style = {model.selected? {
        transition: "all 0.3s ease",
        backgroundColor: "#f5f5f5",
        borderRadius: 4,
        padding: 6
      } : {
        transition: "all 0.3s ease",
        backgroundColor: "#ffffff",
        borderRadius: 0,
        padding: 0
      } }>
      <div className="flex justify  max-w-[100%]">
        <h2
          onClick={(event) => {
            handleSelectModel(
              model,
              modelsStateContext,
              setModelsStateContext,
              parametersContext,
              setParametersContext,
              event.ctrlKey || event.metaKey
            )
          }}
          className={
            `select-none cursor-pointer text-ellipsis overflow-hidden max-w-full whitespace-nowrap overflow-hidden ${model.selected ? "font-medium" : "font-normal"}`
          }>
            {model.name}
        </h2>
      </div>
      <div className="relative editor-container h-full w-full text-base flex mt-2" style = {{clipPath: "inset(-1px)"}}>
        <div
          className={`font-medium relative p-3 overflow-hidden flex-1 flex flex-col loading_border ${border_class}`}
        >
          <ModelEditor {...props} editorState ={editorState} setEditorState ={setEditorState} />
          <ModelCardStats
            errorMessage={errorMessage}
            totalCharacters={totalCharacters}
            is_running = {serverModelState !== "ERROR" && serverModelState !== "COMPLETED" && serverModelState !== "IDLE"}
          />
       </div>
      </div>
    </div>
  )
})

function PromptEditor({editorState, setEditorState, ...props}: any) {
  const scrollRef = useRef(null)
  const editorRef = React.useRef(null)

  const {modelsStateContext} = useContext(ModelsStateContext)
  const {parametersContext} = useContext(ParametersContext)

  const number_of_models_enabled = modelsStateContext.filter((modelState) => modelState.enabled).length 

  function focusEditor() {
    editorRef.current.focus()
  }

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

  const keyBindingFn = (event: any) => {
    if (event.code === "Enter" && event.metaKey) {
      return "ignore_enter"
    }

    if (event.metaKey && event.keyCode === 66) {
      return "bold"
    } else if (event.ctrlKey && event.keyCode === 66) {
      return "bold"
    }
    return getDefaultKeyBinding(event)
  }
  
  /*useEffect(() => {
    setEditorContext({
      internalState: convertToRaw(editorState.getCurrentContent())
    })
  }, [
    editorState
  ])*/

  useEffect(() => {
    setEditorState(
      EditorState.forceSelection(editorState, editorState.getSelection())
    )
  }, [parametersContext.showProbabilities])
  
  return (
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
        ref={editorRef}
        keyBindingFn={keyBindingFn}
        handleKeyCommand={handleKeyCommand}
        customStyleMap={styleMap}
        editorState={editorState}
        onChange={(editorState: any) => {
          setEditorState(editorState)
        }}
      />
    </div>
  )
}

function PromptArea({showDialog}) {
  const is_mac_os = navigator.platform.toUpperCase().indexOf("MAC") >= 0
  const cancel_callback = React.useRef<any>(null)
  const [generating, setGenerating] = React.useState<boolean>(false)
  const apiContext = useContext(APIContext)
  const {modelsStateContext} = useContext(ModelsStateContext)
  const {editorContext, setEditorContext} = useContext(EditorContext)
  
  React.useEffect(() => {
    return () => {
      setEditorContext({
        ...editorContext,
        internalState: convertToRaw(editorStateRef.current.getCurrentContent()),
        prompt: editorStateRef.current.getCurrentContent().getPlainText()
      }, true)
    }
  }, []);

  const [editorState, setEditorState] = React.useState(
    EditorState.moveFocusToEnd(EditorState.createWithContent(
      editorContext.internalState !== null ? convertFromRaw(editorContext.internalState): ContentState.createFromText(editorContext.prompt)
    ))
  )

  const editorStateRef = useRef(editorState)

  useEffect(() => {
    editorStateRef.current = editorState
  }, [editorState])

  const generatingRef =  useRef(generating);

  const number_of_models_enabled = modelsStateContext.filter((modelState) => modelState.enabled).length

  const abortCompletion = () => {
    if (cancel_callback.current) {
      cancel_callback.current()
    }
  }

  useKeyPress(["Escape"], (event: any) => {
    abortCompletion()
  })

  useEffect(() => {
    const completion_callback = ({event}) => {
      switch (event) {
        case "close":
          setEditorContext({
            prompt: editorStateRef.current.getCurrentContent().getPlainText()
          })
          setGenerating(false)
        break;

        default:
        break;
      }
    }

    apiContext.Inference.subscribeTextCompletion(completion_callback)

    return () => {
      apiContext.Inference.unsubscribeTextCompletion(completion_callback);
    };
  }, []);

  useMetaKeyPress(["Enter"], (event: any) => {
    handleSubmit()
  })

  const handleStreamingSubmit = async (
    regenerate = false,
    passedInPrompt = "",
  ) => {
    const prompt  = regenerate ? passedInPrompt : editorState.getCurrentContent().getPlainText();
    
    setGenerating(true)
    setEditorContext({
      prePrompt: prompt
    })

    const _cancel_callback = apiContext.Inference.textCompletionRequest({
      prompt: regenerate ? passedInPrompt : prompt,
      models: modelsStateContext.map((modelState) => {
        if(modelState.enabled) {
          return modelState
        }
      }).filter(Boolean)
    })
    cancel_callback.current = _cancel_callback
  }

  useEffect(() => {
    generatingRef.current = generating
  })

  const handleSubmit = async (regenerate = false, passedInPrompt = "") => {
    return handleStreamingSubmit(regenerate, passedInPrompt)
  }

  return (
    <form
      className="flex flex-col grow basis-auto min-h-[25%] max-h-[75%] overflow-auto"
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
    >
    <div className="flex-1 flex border border-slate-400">
      <div className={`relative overflow-hidden flex-1 flex flex-col p-2`}>
        <PromptEditor editorState = {editorState} setEditorState = {setEditorState}/>
        <div className="absolute bottom-[.5em] right-[1em] z-[2]">
          {generating && (
            <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                className="inline-flex items-center ml-1 text-sm font-medium text-center"
                onClick={(e) => {
                  e.stopPropagation()
                  abortCompletion()
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
                disabled={number_of_models_enabled === 0}
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
              {is_mac_os ? "⌘" : "Control"}
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
  </form>
  )
}

const ModelsCompletion = ({showDialog}) => {
  const modelEditorRefs = useRef({})
  const [modelsCompletionState, setModelsCompletionState] = React.useState({});
  const [_, signalRender] = React.useState(0);

  const apiContext = React.useContext(APIContext);
  const {modelsStateContext} = useContext(ModelsStateContext)
  const {parametersContext} = React.useContext(ParametersContext);
  const number_of_models_enabled = modelsStateContext.filter((modelState) => modelState.enabled).length

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

  const handleUndoLast = () => {
    for (const editor_model_tag of Object.keys(modelEditorRefs.current)) {
      if (modelEditorRefs.current[editor_model_tag])
        modelEditorRefs.current[editor_model_tag].handleUndo()
    }
  }

  useMetaKeyPress(["O"], (event: any) => {
    if (editorContext.prePrompt === "") {
      return
    }
    handleUndoLast()
  })

  useEffect(() => {
    const completion_callback = ({event, data}) => {
      switch (event) {
        case "open":
          handleUndoLast()
        break;

        case "status":
          notifyEditorStatus(data.modelTag, data)
        break;

        case "cancel":
          notifyEditorStatus("*", {
            message: "[ERROR] Cancelled by user"
          })
        break;

        case "completion":
          for (let model_tag in data) {
            modelsCompletionState[model_tag] = [
              ...(modelsCompletionState[model_tag] || []),
              ...data[model_tag]
            ]
          }

          setModelsCompletionState(modelsCompletionState)
          signalRender((x) => x + 1)
        break;

        case "error":
          switch(data) {
            case "Too many pending requests":
              showDialog({
                title: "Too many pending requests",
                message: "Please wait a few seconds before trying again.",
              })
            break;

            case "Too many daily completions":
              showDialog({
                title: "Daily limit reached",
                message: "It seems you've reached your daily limit. Please try again tomorrow.",
              })
            break;

            case "Unauthorized":
              showDialog({
                title: "Unauthorized",
                message: "Please log in to use this feature.",
              })
            break;

            default:
              showDialog({
                title: "Error",
                message: data,
              })
            break;
          }
        break;


        default:
          console.log("Unknown event", event, data);
        break;
      }
    }

    apiContext.Inference.subscribeTextCompletion(completion_callback)

    return () => {
      apiContext.Inference.unsubscribeTextCompletion(completion_callback);
    };
  }, []);

  return (
    <TransitionGroup
      className={`grid h-full mt-3 pr-1 overflow-auto 
        ${
          number_of_models_enabled === 1 
          ? "grid-cols-1 gap-1 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-2"
          : number_of_models_enabled === 2 
          ? "grid-cols-1 gap-3 sm:grid-cols-1 md:grid-cols-2"
          : number_of_models_enabled === 3
          ? "grid-cols-1 gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          : number_of_models_enabled === 4 
          ? "grid-cols-1 gap-3 gap-3 sm:grid-cols-1 md:grid-cols-2"
          : "grid-cols-1 gap-2 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-4 5xl:grid-cols-5 6xl:grid-cols-6 8xl:grid-cols-8"
        }
      `}
    > {
      modelsStateContext
        .filter((modelState) => modelState.enabled && modelState.tag)
        .map((modelState) => (
          <CSSTransition
            key ={modelState.tag}
            timeout={500}
            classNames="fade"
            unmountOnExit>
            <ModelCard
              key={modelState.tag}
              ref={(ref) => (modelEditorRefs.current[modelState.tag] = ref) }
              completion = {modelsCompletionState[modelState.tag] || []} 
              model={modelState}
              showProbabilities={parametersContext.showProbabilities}
              showHighlights={parametersContext.highlightModels}
              />
            </CSSTransition>
          )
        )
      }
    </TransitionGroup>
  )
}

const ParametersTable = () => {
  const {parametersContext, setParametersContext} = React.useContext(ParametersContext);
  const {modelsContext} = React.useContext(ModelsContext);
  const {modelsStateContext, setModelsStateContext} = useContext(ModelsStateContext)
  const number_of_models_enabled = modelsStateContext.filter((modelState) => modelState.enabled).length

  const generate_headers = () => (
    ["Model", "ML", "T", "TP", "TK", "FP", "PP", "RP"].map((header, index) => (
      <div className={`text-center font-normal ${index === 0 ? "min-w-[150px] sticky top-[0] left-[0] z-[1] bg-white" : "min-w-[150px] flex-1"}`}>
        {header}
      </div>
    )
  ))
  
  const generate_table_line_graph = (parameterValue, parameterDefaults) => {
    if (!parameterValue) return (
      <div className="flex-1">
        <span className="cursor-default text-xs">N/A</span>
      </div>
    )

    return (
      <div className="flex-1">
        <div className = "mx-4 relative flx items-center">
          <div className="rounded-md bg-slate-200 w-[100%] h-[3px]"/>
          <div
            className="rounded-md bg-slate-600 absolute h-[3px] top-[0px] ease-in duration-300"
            style={{ width: `${100 * (parameterValue / parameterDefaults.range[1])}%`}}
          />
        </div>
        <span className= "cursor-default absolute top-[-1px] right-[16px] text-[12px]">
          {normalize_parameter(parameterValue)}
        </span>
      </div>
    )
  }
  
  const generate_row = (modelState, model) => (
    [
      "name", "maximumLength", "temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "repetitionPenalty"
    ].map((parameter, index) => (
      (parameter === "name") ?
        <div className={`py-1 bg-inherit text-center font-light min-w-[150px] max-w-[150px] left-[0px] z-[2] sticky whitespace-nowrap text-ellipsis overflow-hidden ${modelState.selected ? "font-medium" : ""}`}>
          <span>{modelState.name.split(":")[1]}</span>
        </div>
        :
      <div className="bg-inherit text-center font-light relative min-w-[150px] flex flex-1 items-center">
        {generate_table_line_graph(modelState.parameters[parameter], model.defaultParameters[parameter])}
      </div>
    ))
  )

  const generate_rows = () => {
    return modelsStateContext
      .filter((modelState) => modelState.enabled)
      .map((modelState) => {
        return (<div
          key={modelState.tag}
          className={`cursor-pointer flex flex-row hover:bg-slate-100 ${modelState.selected ? "bg-slate-100" : "bg-white"}`}
          onClick={(event) => {
            handleSelectModel(
              modelState,
              modelsStateContext,
              setModelsStateContext,
              parametersContext,
              setParametersContext,
              event.ctrlKey || event.metaKey
            )
          }}>
          {generate_row(modelState, modelsContext[modelState.name])}
        </div>)
      })
  }
  
  return (
    <div>
      {!parametersContext.showParametersTable || number_of_models_enabled === 0 ? null :
        <div className="flex mt-4 justify-center">
          <div className="rounded-sm border border-slate-200 max-h-[350px] max-w-[1400px] overflow-auto">
            <div className="flex flex-col m-2 min-w-[900px]">
              <div className="flex flex-row sticky top-[0] z-[3] bg-white">
                {generate_headers()}
              </div>
                {generate_rows()}
            </div>
          </div>
        </div>
      }
    </div>
  )
}

const CustomAlertDialogue = ({dialog}) => {
  const [openDialog, setOpenDialog] = React.useState<boolean>(false)
  const [_dialogue, _setDialogue] = React.useState<any>({
    title: "",
    message: ""
  })

  useEffect(() => {
    if (!openDialog && dialog.title !== "" && dialog.message !== "") {
      _setDialogue({
        title: dialog.title,
        message: dialog.message
      })
      setOpenDialog(true)
    }
  }, [dialog])

  return (
    <AlertDialog open={openDialog} onOpenChange={setOpenDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{_dialogue.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-base text-slate-700 dark:text-slate-400">
            {_dialogue.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>Ok</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    )
}

export default function Compare() {
  const [openParameterSheet, setSaveOpenParameterSheet] = React.useState<boolean>(false)
  const parametersSidePanel = (<ParameterSidePanel showModelList = {true} />)

  const [dialog, showDialog] = React.useState({
    title: "",
    message: ""
  })

  return (
    <div className="flex flex-col h-full">
      <NavBar tab="compare">
        <div className="align-middle mt-1">
          <div className="flex basis-full mb-2 lg:mb-0 space-x-2">
            <Sheet open={openParameterSheet} onOpenChange={setSaveOpenParameterSheet}>
              <SheetTrigger asChild>
                <Button variant="subtle" className="lg:hidden">
                  <Settings2 className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent className="w-[80vw] p-4 pt-10 overflow-auto">
                {parametersSidePanel}
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </NavBar>
      <CustomAlertDialogue dialog = {dialog} />
      <div className="flex flex-grow flex-col font-display min-h-0 min-w-0">
        <div className="flex flex-row space-x-4 flex-grow mx-2 md:ml-5 lg:ml-5 min-h-0 min-w-0">
          <div className="flex-1 flex flex-col lg:max-w-[calc(100%-266px)] max-w-[100%]">
            <PromptArea showDialog = {showDialog}/>
            <ParametersTable showDialog = {showDialog}/>
            <ModelsCompletion showDialog = {showDialog}/>
          </div>
        <div className="hidden p-1 grow-0 shrink-0 basis-auto lg:w-[250px] overflow-auto lg:block">
          {parametersSidePanel}
        </div>
      </div>
    </div>
  </div>
  )
}