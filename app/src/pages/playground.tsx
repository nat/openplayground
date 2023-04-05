import React, {
  useCallback, useContext, useEffect, useRef
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
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import {
  X,
  HistoryIcon,
  Loader2,
  Settings2,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip"
import { Popover } from "react-tiny-popover"
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
import { useMetaKeyPress } from "../lib/meta-keypress"
import { useKeyPress } from "../lib/keypress"
import "draft-js/dist/Draft.css"
import { Sheet, SheetContent, SheetTrigger } from "../components/ui/right-sheet"
import chroma from "chroma-js"
import { useToast } from "../hooks/ui/use-toast"
import {styleMap, getDecoratedStyle} from "../lib/editor-styles"
import { APIContext, EditorContext, ModelsStateContext, ParametersContext, HistoryContext} from "../app"
import ParameterSidePanel from "../components/parameters-side-panel"
import { TooltipProvider } from "@radix-ui/react-tooltip"

const HistorySidePanel = () => {
  const {
    historyContext, toggleShowHistory, clearHistory, selectHistoryItem
  } = useContext(HistoryContext)

  const handleDeleteAllHistory = () => {
    clearHistory()
  }

  if (!historyContext.show) return null;

  const downloadHistory = () => {
    const element = document.createElement("a")
    const history_json = historyContext.entries.map((entry: any) => {
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
    document.body.appendChild(element) // Required for this to work in FireFox
    element.click()
  }
  return (
      <div className="flex flex-col h-full relative overflow-auto">
        <div
          className="text-lg tracking-tight font-semibold text-slate-900 flex sticky top-[0] right-[0]"
          style={{ justifyContent: "flex-end" }}
        >
          <div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                type="button"
                variant="subtle"
                className="inline-flex text-sm font-medium outline-0"
                onClick={(e) => {
                  setShowHistory((e) => !e)
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
                <DropdownMenu.Item
                  className="cursor-pointer outline-0 hover:bg-slate-200 text-sm p-2 text-center"
                  onClick={() => {
                    downloadHistory()
                  }}
                  >
                  Download as JSON
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-[1px] bg-slate-200" />
                <DropdownMenu.Item
                  className="cursor-pointer outline-0 hover:bg-slate-200 text-sm p-2 text-center"
                  onClick={() => {
                    handleDeleteAllHistory()
                  }}
                >
                  Clear History
                </DropdownMenu.Item>
                <DropdownMenu.Arrow className="fill-white" />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          <div className="cursor-pointer inline m-2 align-middle lg:inline align-middle mb-1" style = {{height: 20, width: 20}}>
            <X
              size={20}
              onClick={(e) => {
                toggleShowHistory()
              }}
            />
          </div>
        </div>
      
        <div className="overflow-y-auto max-h-[100%] mt-2">
          {historyContext.entries
              .reduce((accumulator: any, value: any) => {
                let val = value.date 
                if (!accumulator.includes(val)) {
                  accumulator.push(val)
                }
                return accumulator.sort((a, b) => (new Date(b) - new Date(a)))
              }, [])
              .map((unique_date: any, main_index) => {
                
                return (
                  <div key = {unique_date}>
                    <div className="text-xs tracking-tight mb-4 mt-2 font-semibold uppercase text-slate-900">
                      {new Date(unique_date).toLocaleDateString(
                        ["en-GB", "en-us"],
                        {
                          weekday: "long",
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }
                      )}
                    </div>
                    {historyContext.entries
                      .filter((value: any) => (value.date === unique_date))
                      .sort((a: any, b: any) => (new Date(b.timestamp) - new Date(a.timestamp)))
                      .map((historyItem: any, index: number) => {
                        const isSelectedHistoryItem = historyContext.current.timestamp === historyItem.timestamp && historyContext.current.editor.prompt === historyItem.editor.prompt;

                        return (
                          <div key={historyItem.timestamp}>
                            <div
                              onClick={() => {
                                selectHistoryItem(historyItem)
                              }}
                              className={`[&>div:nth-child(2)]:hover:w-[7px]
                              [&>div:nth-child(2)]:hover:h-[7px]
                              [&>div:nth-child(2)]:hover:left-[77px]
                              [&>div:nth-child(2)]:hover:border-slate-800
                              [&>div:nth-child(2)]:hover:border-2
                              rounded-sm rounded-sm relative flex flex-row p-4 font-bold text-sm cursor-pointer click:bg-slate-300 dark:hover:bg-slate-200  ${
                                isSelectedHistoryItem
                                  ? "bg-slate-200"
                                  : "hover:bg-slate-100"
                              }`}
                            >
                              <div
                                className={`bg-slate-300 w-[1px] absolute left-[80px] ${
                                  main_index === 0 && index === 0
                                    ? "h-[75%] top-[25%]"
                                    : "h-[100%] top-[0]"
                                }`}
                              />
                              <div
                                className={`ease-in duration-100 border rounded-full bg-white absolute top-[22px] ${
                                  isSelectedHistoryItem
                                    ? "border-slate-800 w-[7px] h-[7px] border-2 left-[77px]"
                                    : "border-slate-500 w-[5px] h-[5px] left-[78px] "
                                }
                              `}
                              />
                              <div className="text-xs pl-4 pr-10">
                                {main_index === 0 && index === 0 ? (
                                  <span style = {{marginRight: 6}}>Now</span>
                                ) : (
                                  new Date(historyItem.timestamp)
                                    .toTimeString()
                                    .split(":")
                                    .slice(0, 2)
                                    .join(":")
                                )}
                              </div>
                              <div className="text-xs overflow-hidden ">
                                <p className="truncate tracking-wide">
                                  {main_index === 0 && index === 0
                                    ? "Current"
                                    : historyItem.editor.prompt}
                                </p>
                                <div
                                  className="mt font-medium"
                                  style={{
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                  }}
                                >
                                  {historyItem.modelsState.find(({selected})=> selected).name}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )
              })}
        </div>
      </div>
 
  )
}

class EditorWrapper extends React.Component {
  componentDidCatch() {
    const {resetEditorState} = this.props
    resetEditorState()
  }

  keyBindingFn(event: any) {
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

  handleKeyCommand(command: any, editorState: any) {
    const {setEditorState} = this.props

    if (command === "bold") {
      setEditorState(RichUtils.toggleInlineStyle(editorState, "BOLD"))
      return "handled"
    }
    if (command === "ignore_enter") {
      return "handled"
    }
    return "not-handled"
  }

  render() {
    const {editorState, setEditorState} = this.props
    return (
      <Editor
        keyBindingFn={this.keyBindingFn.bind(this)}
        handleKeyCommand={this.handleKeyCommand.bind(this)}
        customStyleMap={styleMap}
        editorState={editorState}
        onChange={(editorState: any) => {
          setEditorState(editorState)
        }}
        stripPastedStyles
      />
    )
  }
}

const PromptCompletionEditor = ({showDialog}) => {
  const {editorContext, setEditorContext} = useContext(EditorContext)
  const {parametersContext} = useContext(ParametersContext)
  const {modelsStateContext} = useContext(ModelsStateContext)
  const {
    historyContext, addHistoryEntry, toggleShowHistory
  } = useContext(HistoryContext)
  const number_of_models_selected = modelsStateContext.filter(({selected}) => selected).length

  const [status, setStatus] = React.useState<string[]>([])
  const [output, setOutput] = React.useState<string[]>([])
  const apiContext = useContext(APIContext)
  const scrollRef = useRef(null)
  const is_mac_os = navigator.platform.toUpperCase().indexOf("MAC") >= 0
  const [_, signalRender] = React.useState(0);

  const [generating, setGenerating] = React.useState<boolean>(false);
  const cancel_callback = React.useRef<any>(null)
  const { toast } = useToast()

  const showProbabilitiesRef = useRef(parametersContext.showProbabilities)
  const highlightModelsRef = useRef(parametersContext.highlightModels)

  useEffect(() => {
    showProbabilitiesRef.current = parametersContext.showProbabilities
    highlightModelsRef.current = parametersContext.highlightModels
  })

  React.useEffect(() => {
    return () => {
      setEditorContext({
        ...editorContext,
        internalState: convertToRaw(editorStateRef.current.getCurrentContent()),
        prompt: editorStateRef.current.getCurrentContent().getPlainText()
      }, true)
    }
  }, []);

  useEffect(() => {
    if (editorContext.internalState) {
      setEditorState(
        EditorState.createWithContent(convertFromRaw(editorContext.internalState),
        createDecorator())
      )
    }
  }, [editorContext.internalState])

  const handleStreamingSubmit = async (
    regenerate = false,
    passedInPrompt = ""
  ) => {
    const prompt  = regenerate ? passedInPrompt : editorState.getCurrentContent().getPlainText();

    setGenerating(true)
    setEditorContext({
      prePrompt: prompt,
      previousInternalState: convertToRaw(editorState.getCurrentContent())
    })

    const _cancel_callback = apiContext.Inference.textCompletionRequest({
      prompt: regenerate ? passedInPrompt : prompt,
      models: modelsStateContext.map((modelState) => {
        if(modelState.selected) {
          return modelState
        }
      }).filter(Boolean)
    })

    cancel_callback.current = _cancel_callback
  }

  useEffect(() => {
    const completionCallback = ({event, data, meta}) => {
      switch (event) {
        case "cancel":
          setGenerating(false)
        break;

        case "close":
          if (!meta.error)
            addHistoryEntry(convertToRaw(editorStateRef.current.getCurrentContent()))
          
            
          setEditorContext({
            prompt: editorStateRef.current.getCurrentContent().getPlainText(),
            internalState: convertToRaw(editorStateRef.current.getCurrentContent()),
          })
          setGenerating(false)
        break;

        case "completion":
          setOutput(data[Object.keys(data)[0]])
          signalRender((x) => x + 1)
        break;

        case "status":
          const {message} = data
          if (message.indexOf("[ERROR] ") === 0) {
            showDialog({
              title: "Model Error",
              message: message.replace("[ERROR] ", ""),
            })
          }
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
                message: "It seems you've reached your daily limit of completions. Please try again tomorrow.",
              })
            break;

            case "Unauthorized":
              showDialog({
                title: "Unauthorized",
                message: "Please log in to use this feature.",
              })
            break;

            default:
              console.log("default error handling?")
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
    
    apiContext.Inference.subscribeTextCompletion(completionCallback)

    return () => {
      apiContext.Inference.unsubscribeTextCompletion(completionCallback);
    };
  }, []);

  const handleSubmit = async (regenerate = false, passedInPrompt = "") => {
    return handleStreamingSubmit(regenerate, passedInPrompt)
  }

  useMetaKeyPress(["Enter"], (event: any) => {
    handleSubmit()
  })

  const abortCompletion = () => {
    if (cancel_callback.current) {
      cancel_callback.current()
    }
  }

  useKeyPress(["Escape"], (event: any) => {
    abortCompletion()
  })

  useMetaKeyPress(["u"], (event: any) => {
    if (editorContext.prePrompt === "") {
      return
    } else {
      handleUndoLast()
    }
  })

  const regenerateKeyPress = (event: any) => {
    event.preventDefault()
    if (editorContext.prePrompt === "") {
      return
    } else {
      handleUndoLast()
      handleSubmit(true, editorContext.prePrompt)
    }
  }

  useMetaKeyPress(["alt", "r"], regenerateKeyPress)
  useMetaKeyPress(["alt", "®"], regenerateKeyPress)

  const Decorated = (props: any) => {
    const children = props.children
    const entity = props.contentState.getEntity(props.entityKey)
    const entityData = entity.getData()
    const style = getDecoratedStyle(entityData.modelProvider, highlightModelsRef.current)
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
    EditorState.moveFocusToEnd(EditorState.createWithContent(
      editorContext.internalState !== null ? convertFromRaw(editorContext.internalState): ContentState.createFromText(editorContext.prompt),
      createDecorator()
    ))
  )

  const editorStateRef = useRef<EditorState>(editorState)
  
  useEffect(() => {
    editorStateRef.current = editorState;
  }, [editorState]);

  useEffect(() => {
    setEditorState(
      EditorState.forceSelection(editorState, editorState.getSelection())
    )
  }, [parametersContext.showProbabilities, parametersContext.highlightModels])

  const resetEditorState = () => {
    setEditorState(
      EditorState.moveFocusToEnd(EditorState.createWithContent(
        ContentState.createFromText(""),
        createDecorator()
      ))
    )
  }

  useEffect(() => {
    let current_editor_state = editorState;
    try {
      for(const output_entry of output) {
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
          current_editor_state,
          textWithInsert,
          "insert-characters"
        )
        const newEditorState = EditorState.moveSelectionToEnd(editorWithInsert)
        const finalEditorState = EditorState.forceSelection(
          newEditorState,
          newEditorState.getSelection()
        )
        current_editor_state = finalEditorState

        if (scrollRef.current) {
          const scrollEl = scrollRef.current
          scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight
        }
      }
    } catch (e) {
      console.log("Error in editor update", e)
    }

    setEditorState(current_editor_state)
    editorStateRef.current = current_editor_state
  }, [output])

  useEffect(() => {
    if (status.message && status.message.indexOf("[QUEUE] ") === 0) {
      toast({
        title: "Inference request queued",
        description: "We're currently experiencing high load, your compeletion request is in a queue and will be compeleted shortly"
      })
      return
    } 
    if (status.message && status.message.indexOf("[ERROR] ") === 0) {
      showDialog({
        title: "An error occured!",
        description: status.message.replace("[ERROR] ", "")
      })
      return
    }
  }, [status])

  const handleUndoLast = () => {
    setEditorState(
      EditorState.moveFocusToEnd(
        EditorState.createWithContent(
          convertFromRaw(editorContext.previousInternalState),
          createDecorator()
        )
      )
    )
    setEditorContext({
      prompt: editorContext.prePrompt,
      prePrompt: "",
      previousInternalState: null,
    })
  }
  
  return (
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
        <EditorWrapper
          editorState = {editorState}
          setEditorState= {setEditorState}
          resetEditorState = {resetEditorState}
        />
      </div>
    
      <div className="flex space-x-2 mb-8">
        {generating && (
          <TooltipProvider>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
              <div>
              <Button
                  type="button"
                  variant="subtle"
                  className="hidden lg:inline-flex md:inline-flex items-center mt-4 text-sm font-medium text-center"
                  onClick={(e) => {
                    e.stopPropagation()
                    abortCompletion()
                  }}
                >
                  {" "}
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancel Generation
                </Button>

                <Button
                  type="button"
                  variant="subtle"
                  className="inline-flex lg:hidden md:hidden items-center mt-4 text-sm font-medium text-center"
                  onClick={(e) => {
                    e.stopPropagation()
                    abortCompletion()
                  }}
                >
                  {" "}
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancel
                </Button>
              </div>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="center"
                className="bg-slate-600 text-white hidden hidden md:block"
              >
                Cancel Generation &nbsp;
                <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Esc
                </kbd>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider>
          {!generating && (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  className="bg-emerald-500 hover:bg-emerald-700 inline-flex items-center mt-4 text-sm font-medium text-center"
                  type="submit"
                  value="submit"
                  disabled={number_of_models_selected === 0}
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
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <div>
                <Button
                  type="button"
                  variant="subtle"
                  className="inline-flex items-center mt-4 text-sm font-medium text-center"
                  onClick={handleUndoLast}
                  disabled={editorContext.prePrompt === ""}
                >
                  Undo
                </Button>
              </div>

            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="center"
              className="bg-slate-600 text-white hidden md:block"
            >
              Undo Last &nbsp;
              <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                {is_mac_os ? "⌘" : "Control"}
              </kbd>
              &nbsp;
              <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                U
              </kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>

            <div>
              <Button
                type="button"
                variant="subtle"
                className="inline-flex items-center mt-4 text-sm font-medium text-center"  
                onClick={(e) => {
                  e.stopPropagation()
                  handleUndoLast()
                  handleSubmit(true, editorContext.prePrompt)
                }}
                disabled={editorContext.prePrompt === ""}
              >
                Regenerate
              </Button>
              </div> 
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="center"
              className="bg-slate-600 text-white hidden md:block"
            >
              Regenerate &nbsp;
              <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                {is_mac_os ? "⌘" : "Control"}
              </kbd>
              &nbsp;
              <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              {is_mac_os ? "Option" : "Alt"}
              </kbd>
              &nbsp;
              <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                R
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
                  toggleShowHistory()
                }}
                disabled={historyContext.entries.length == 0}
              >
                <HistoryIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="center"
              className="bg-slate-600 text-white"
            >
              Show History &nbsp;
              <kbd className="align-top pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-100 bg-slate-100 px-1.5 font-mono text-[10px] font-medium text-slate-600 opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                {is_mac_os ? "⌘" : "Control"}
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
export default function Playground() {
  const apiContext = useContext(APIContext)
  const {historyContext, toggleShowHistory} = useContext(HistoryContext)
  const [openHistorySheet, setOpenHistorySheet] = React.useState<boolean>(false)
  const [openParameterSheet, setSaveOpenParameterSheet] = React.useState<boolean>(false)
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const [deleteHistoryDialog, setDeleteHistoryDialog] = React.useState<boolean>(false)
  const [dialog, showDialog] = React.useState({
    title: "",
    message: ""
  })

  const historySidebar = (<HistorySidePanel />)
  const parameterSidebar = (<ParameterSidePanel showModelDropdown={true} showModelList ={false} />)


  useMetaKeyPress(["h"], (event: any) => {
    event.preventDefault()

    if (historyContext.entries.length > 0 && !isMobile) toggleShowHistory()
  })

  const mobileOpenParametersButton = (
    <Sheet open={openParameterSheet} onOpenChange={setSaveOpenParameterSheet}>
      <SheetTrigger asChild>
        <Button variant="subtle" className="lg:hidden">
          <Settings2 className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[80vw] p-4 pt-8">
        {parameterSidebar}
        </SheetContent>
    </Sheet>
  )

  const mobileOpenHistoryButton = (
    <Sheet open={openHistorySheet} onOpenChange={() => {
        if (historyContext.entries.length == 0) {
          alert("No history to show!")
        } else {
          toggleShowHistory(!openHistorySheet)
        }
      setOpenHistorySheet(!openHistorySheet)
    }}>
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
        <div className="align-middle mt-1">
          <div className="flex basis-full my-2 lg:mb-0 space-x-2">
            {mobileOpenParametersButton}
            {/*(!isMobile) ? mobileOpenHistoryButton : null */}
          </div>
        </div>
      </NavBar>

      <AlertDialog
        open={deleteHistoryDialog}
        onOpenChange={setDeleteHistoryDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Are you sure you want to delete all of your history?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be <b>reversed.</b> Please make sure you have
              saved any important generations before proceeding.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 text-white hover:bg-red-600 dark:hover:bg-red-600"
              asChild
            >
              <Button variant="destructive">
                Delete History
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CustomAlertDialogue dialog = {dialog} />
      <div className="flex flex-grow flex-col font-display min-h-0 min-w-0 ml-5">
        <div className="flex flex-row space-x-4 flex-grow mr-5 min-h-0 min-w-0">
          {
            historyContext.show ? (
            <div className="hidden p-1 grow-0 shrink-0 basis-auto lg:w-[250px] overflow-auto lg:block">
              {historySidebar}
            </div>) : null
          }
          <PromptCompletionEditor showDialog = {showDialog}/>
            <div className="hidden p-1 grow-0 shrink-0 basis-auto lg:w-[250px] overflow-auto lg:block">
              {parameterSidebar}
            </div>
        </div>
      </div>
    </div>
  )
}
