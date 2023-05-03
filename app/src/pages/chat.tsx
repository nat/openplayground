import React, { useContext, useEffect, useRef, useState } from "react"
import Message from "../components/chat/message"
import MessageComposer from "../components/chat/message-composer"
import ScrollContainer from "../components/chat/scroll-container"
import NavBar from "../components/navbar"
import ParameterSidePanel from "../components/parameters-side-panel"
import {
  APIContext,
  EditorContext,
  ModelsStateContext,
  HistoryContext,
} from "../app"
import HistorySidePanel from "../components/ui/history-side-panel"
import { CustomAlertDialogue } from "../components/ui/alert-dialog"

export interface IMessage {
  author: string
  content: string
}

const parameterSidebar = (
  <ParameterSidePanel showModelDropdown={true} showModelList={false} />
)

const initialMessages = [] as IMessage[]

export default function Chat() {
  const {
    historyContext,
    setHistoryContext,
    addHistoryEntry,
    toggleShowHistory,
  } = useContext(HistoryContext)
  const [_, signalRender] = React.useState(0)
  const { modelsStateContext } = useContext(ModelsStateContext)
  const apiContext = useContext(APIContext)
  const [generating, setGenerating] = useState(false)
  const cancel_callback = useRef(null)
  const [dialog, showDialog] = React.useState({
    title: "",
    message: "",
  })

  useEffect(() => {
    historyContext.current = null
  }, [])

  const handleStreamingSubmit = async (content) => {
    setGenerating(true)
    const _cancel_callback = apiContext.Inference.textCompletionRequest({
      prompt: content,
      models: modelsStateContext.filter((modelState => modelState.selected))
    })
    cancel_callback.current = _cancel_callback
  }

  const handleSubmit = async (content) => {
    if (historyContext.current == null) {
      addHistoryEntry([{ author: "me", content }])
      return handleStreamingSubmit(content)
    } else {
      const newMessages = [...historyContext.current.editor.internalState, { author: "me", content }]
      historyContext.current.editor.internalState = newMessages
      setHistoryContext(historyContext)
      const promptContent = newMessages.map((m) => m.content).join("\n")
      return handleStreamingSubmit(promptContent)
    }
  }

  const abortCompletion = () => {
    if (cancel_callback.current) {
      cancel_callback.current()
    }
  }

  useEffect(() => {
    const completionCallback = ({ event, data, meta }) => {
      if (event == "cancel") {
        setGenerating(false)
      } else if (event == "close") {
        setGenerating(false)
      } else if (event == "completion") {
        setHistoryContext((history) => {
          const completions = Object.values(data)[0]
          const completion = completions.map((c) => c.message).join("")
          history.current.editor.internalState.at(-1).content += completion
          return history
        })
        signalRender((x) => x + 1)
      } else if (event == "status") {
        const { message, modelName, modelProvider, modelTag } = data
        if (message === "[INITIALIZING]") {
          setHistoryContext((history) => {
            history.current.editor.internalState.push({ author: modelName, content: "" })
            return history
          })
        } else if (message.startsWith("[ERROR]")) {
          showDialog({
            title: "Model Error",
            message: message.replace("[ERROR] ", ""),
          })
        }
      } else if (event == "error") {
        if (data == "Too many pending requests")
          showDialog({
            title: "Too many pending requests",
            message: "Please wait a few seconds before trying again.",
          })
        else if (data == "Too many daily completions")
          showDialog({
            title: "Daily limit reached",
            message:
              "It seems you've reached your daily limit of completions. Please try again tomorrow.",
          })
        else if (data == "Unauthorized")
          showDialog({
            title: "Unauthorized",
            message: "Please log in to use this feature.",
          })
        else {
          showDialog({
            title: "Error",
            message: data,
          })
        }
      } else {
        console.log("Unknown event", event, data)
      }
    }
    apiContext.Inference.subscribeTextCompletion(completionCallback)
    return () => {
      apiContext.Inference.unsubscribeTextCompletion(completionCallback)
    }
  }, [])
  const messages = historyContext.current?.editor?.internalState || []
  return (
    <div className="flex flex-col h-full">
      <NavBar tab="chat" />
      <div className="flex flex-grow flex-col font-display min-h-0 min-w-0 ml-5">
        <CustomAlertDialogue dialog={dialog} />
        <div className="flex flex-row space-x-4 flex-grow mr-5 min-h-0 min-w-0">
          <div className="hidden p-1 grow-0 shrink-0 basis-auto lg:w-[250px] overflow-auto lg:block">
            <HistorySidePanel />
          </div>
          <div className="flex flex-col grow basis-auto max-w-3xl mx-auto">
            <ScrollContainer>
              {messages.map((message, index) => (
                <div className="p-4" key={index}>
                  <div>
                    <Message message={message} />
                  </div>
                </div>
              ))}
            </ScrollContainer>
            <MessageComposer
              onSubmit={handleSubmit}
              onCancel={abortCompletion}
              disabled={generating}
            />
          </div>
          <div className="hidden p-1 grow-0 shrink-0 basis-auto lg:w-[250px] overflow-auto lg:block">
            {parameterSidebar}
          </div>
        </div>
      </div>
    </div>
  )
}
